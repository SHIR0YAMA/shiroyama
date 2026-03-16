import { downloadTelegramMedia } from '../../../server/telegram-account.js';
import fs from 'node:fs';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_REDIRECT_MIB = 2000;
const MAX_STREAM_MIB = 4000;
const MIB = 1024 * 1024;

function canAccessPath(path, isOwner, permissionMap, loggedInUserRoleIds) {
  if (isOwner) return true;
  if (!path) return true;

  const pathParts = path.split('/');
  for (let i = pathParts.length; i > 0; i -= 1) {
    const currentPath = pathParts.slice(0, i).join('/');
    if (permissionMap.has(currentPath)) {
      const allowedRoles = permissionMap.get(currentPath);
      for (const userRoleId of loggedInUserRoleIds) {
        if (allowedRoles.has(userRoleId)) return true;
      }
      return false;
    }
  }
  return true;
}

function sanitizeFilename(name) {
  return String(name || 'download.bin').replace(/[\\/:*?"<>|]/g, '_');
}

function logDownloadAuth(reason, details) {
  console.log('[download-auth]', { reason, ...details });
}

function logDownload(details) {
  console.log('[download]', details);
}

function fileSizeToMiB(fileSize) {
  const bytes = Number(fileSize || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return bytes / MIB;
}

async function openBotApiFileStream({ baseUrl, token, fileId }) {
  const getFileUrl = new URL(`/bot${token}/getFile`, baseUrl);
  getFileUrl.searchParams.set('file_id', fileId);

  const metaResponse = await fetch(getFileUrl.toString(), { method: 'GET' });
  const metaPayload = await metaResponse.json().catch(() => null);
  if (!metaResponse.ok || !metaPayload?.ok || !metaPayload?.result?.file_path) {
    throw new Error(metaPayload?.description || 'Falha ao consultar arquivo no Bot API local.');
  }

  const returnedFilePath = String(metaPayload.result.file_path || '');
  const absoluteBase = '/var/lib/telegram-bot-api/';

  if (returnedFilePath.startsWith(absoluteBase)) {
    try {
      const stat = fs.statSync(returnedFilePath);
      if (!stat.isFile()) throw new Error('file_path absoluto não aponta para arquivo regular.');

      return {
        stream: fs.createReadStream(returnedFilePath),
        contentType: null,
        contentLength: stat.size,
        resolvedMode: 'bot_api_local_file_stream',
        filePath: returnedFilePath,
        openedBy: 'filesystem_local',
        cleanup: async () => {}
      };
    } catch (error) {
      console.warn('[download] bot_api_local_file_stream_failed', {
        fileId,
        filePath: returnedFilePath,
        error: error?.message || String(error),
        fallback: 'bot_api_http_stream'
      });
    }
  }

  const normalizedPath = returnedFilePath.replace(/^\/+/, '');
  const fileUrl = new URL(`/file/bot${token}/${normalizedPath}`, baseUrl);
  const fileResponse = await fetch(fileUrl.toString(), { method: 'GET' });
  if (!fileResponse.ok || !fileResponse.body) {
    throw new Error(`Falha ao abrir stream do Bot API local (HTTP ${fileResponse.status}).`);
  }

  return {
    stream: Readable.fromWeb(fileResponse.body),
    contentType: fileResponse.headers.get('content-type') || null,
    contentLength: Number(fileResponse.headers.get('content-length') || 0) || null,
    resolvedMode: 'bot_api_http_stream',
    filePath: returnedFilePath,
    openedBy: 'bot_api_http',
    cleanup: async () => {}
  };
}

export async function onRequestGet(context) {
  const { params, env, data } = context;
  const loggedInUser = data.user;

  const parts = params.catchall || [];
  if (parts.length !== 2 || parts[1] !== 'download') {
    return new Response(JSON.stringify({ message: 'Rota não encontrada.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const fileId = Number(parts[0]);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return new Response(JSON.stringify({ message: 'ID de arquivo inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!loggedInUser || !loggedInUser.permissions.includes('can_view_files')) {
    logDownloadAuth('denied_missing_permission_can_view_files', {
      fileId,
      user: loggedInUser?.username || null,
      role: loggedInUser?.role || null
    });
    return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  let media = null;
  try {
    const [file, permsResult, userRolesResult] = await Promise.all([
      env.DB.prepare(`
        SELECT id, folder_path, file_name, mime_type, file_size, telegram_chat_id, telegram_message_id, telegram_file_id, telegram_file_ref
        FROM files
        WHERE id = ?
      `).bind(fileId).first(),
      env.DB.prepare('SELECT role_id, folder_path FROM folder_permissions').all(),
      env.DB.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').bind(loggedInUser.userId).all()
    ]);

    if (!file) {
      return new Response(JSON.stringify({ message: 'Arquivo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const permissionMap = new Map();
    (permsResult.results || []).forEach((p) => {
      if (!permissionMap.has(p.folder_path)) permissionMap.set(p.folder_path, new Set());
      permissionMap.get(p.folder_path).add(p.role_id);
    });

    const loggedInUserRoleIds = new Set((userRolesResult.results || []).map((r) => r.role_id));
    const isOwner = loggedInUser.level === 0;
    if (!canAccessPath(file.folder_path || '', isOwner, permissionMap, loggedInUserRoleIds)) {
      logDownloadAuth('denied_folder_permission', {
        fileId: file.id,
        folderPath: file.folder_path || '',
        user: loggedInUser.username || null,
        role: loggedInUser.role || null,
        roleIds: Array.from(loggedInUserRoleIds)
      });
      return new Response(JSON.stringify({ message: 'Sem acesso a este arquivo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const sizeMiB = fileSizeToMiB(file.file_size);
    logDownload({ fileId: file.id, sizeMiB: Number(sizeMiB.toFixed(2)), folderPath: file.folder_path || '' });

    if (sizeMiB > MAX_STREAM_MIB) {
      logDownload({ fileId: file.id, rejected: true, sizeMiB: Number(sizeMiB.toFixed(2)) });
      return new Response(JSON.stringify({ message: 'Arquivo excede limite máximo de download (4000 MiB)' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (sizeMiB <= MAX_REDIRECT_MIB) {
      if (file.telegram_file_id) {
        const botToken = String(env.TELEGRAM_BOT_TOKEN || env.DOWNLOAD_BOT_TOKEN || '').trim();
        const botApiBase = String(env.BOT_API_BASE || 'http://127.0.0.1:8081').trim();
        if (!botToken) {
          throw new Error('TELEGRAM_BOT_TOKEN não configurado para modo bot_api_stream.');
        }

        try {
          const botApiMedia = await openBotApiFileStream({ baseUrl: botApiBase, token: botToken, fileId: file.telegram_file_id });
          media = botApiMedia;
          logDownload({
            fileId: file.id,
            mode: botApiMedia.resolvedMode || 'bot_api_stream',
            sizeMiB: Number(sizeMiB.toFixed(2)),
            folderPath: file.folder_path || '',
            filePath: botApiMedia.filePath,
            openedBy: botApiMedia.openedBy
          });
        } catch (botApiError) {
          logDownload({
            fileId: file.id,
            mode: 'bot_api_stream_failed',
            sizeMiB: Number(sizeMiB.toFixed(2)),
            folderPath: file.folder_path || '',
            error: botApiError?.message || String(botApiError),
            fallback: 'mtproto_stream'
          });

          media = await downloadTelegramMedia({
            apiId: env.TELEGRAM_API_ID,
            apiHash: env.TELEGRAM_API_HASH,
            session: env.TELEGRAM_SESSION,
            chatId: file.telegram_chat_id,
            messageId: file.telegram_message_id,
            mockDir: env.TELEGRAM_MOCK_DIR,
            useMock: env.TELEGRAM_USE_MOCK,
            chunkSize: 1024 * 1024
          });
          logDownload({ fileId: file.id, mode: 'mtproto_stream', fallback: 'bot_api_stream_failed' });
        }
      } else {
        logDownload({ fileId: file.id, mode: 'mtproto_stream', fallback: 'mtproto_missing_file_id' });
        media = await downloadTelegramMedia({
          apiId: env.TELEGRAM_API_ID,
          apiHash: env.TELEGRAM_API_HASH,
          session: env.TELEGRAM_SESSION,
          chatId: file.telegram_chat_id,
          messageId: file.telegram_message_id,
          mockDir: env.TELEGRAM_MOCK_DIR,
          useMock: env.TELEGRAM_USE_MOCK,
          chunkSize: 1024 * 1024
        });
      }
    } else {
      logDownload({ fileId: file.id, mode: 'mtproto_stream' });
      media = await downloadTelegramMedia({
        apiId: env.TELEGRAM_API_ID,
        apiHash: env.TELEGRAM_API_HASH,
        session: env.TELEGRAM_SESSION,
        chatId: file.telegram_chat_id,
        messageId: file.telegram_message_id,
        mockDir: env.TELEGRAM_MOCK_DIR,
        useMock: env.TELEGRAM_USE_MOCK,
        chunkSize: 1024 * 1024
      });
    }

    if (media?.stream) {
      const streamMode = media.resolvedMode || (sizeMiB <= MAX_REDIRECT_MIB && file.telegram_file_id ? 'bot_api_stream' : 'mtproto_stream');
      media.stream.once('end', () => logDownload({ fileId: file.id, mode: streamMode, status: 'completed' }));
      media.stream.once('error', (streamErr) => logDownload({ fileId: file.id, mode: streamMode, status: 'stream_error', error: streamErr?.message || String(streamErr) }));
    }

    const headers = new Headers();
    headers.set('Content-Type', media.contentType || file.mime_type || 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename="${sanitizeFilename(file.file_name)}"`);
    if (media.contentLength) headers.set('Content-Length', String(media.contentLength));
    else if (file.file_size) headers.set('Content-Length', String(file.file_size));

    const pass = new PassThrough();
    pipeline(media.stream, pass)
      .catch((streamErr) => console.error('[download] stream pipeline error', { fileId: file.id, error: streamErr?.message || String(streamErr) }))
      .finally(async () => {
        if (media?.cleanup) await media.cleanup().catch(() => {});
      });

    return new Response(Readable.toWeb(pass), { status: 200, headers });
  } catch (error) {
    if (media?.cleanup) await media.cleanup().catch(() => {});
    console.error('Erro ao baixar arquivo:', error);
    return new Response(JSON.stringify({ message: `Falha no download: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
