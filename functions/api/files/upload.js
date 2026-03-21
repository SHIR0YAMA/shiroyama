import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { uploadTelegramMedia } from '../../../server/telegram-account.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { data, env, request } = context;
  const loggedInUser = data.user;

  if (!loggedInUser || (!loggedInUser.permissions.includes('can_upload_files') && loggedInUser.level !== 0)) {
    return json({ message: 'Acesso negado para upload.' }, 403);
  }

  let tempPath;
  try {
    const form = await request.formData();
    const file = form.get('file');
    const folderPath = String(form.get('folder_path') || '').trim();
    const telegramChatId = String(form.get('telegram_chat_id') || '').trim();

    if (!file || typeof file === 'string') return json({ message: 'Arquivo não enviado.' }, 400);
    if (!telegramChatId) return json({ message: 'telegram_chat_id é obrigatório.' }, 400);

    const fileName = file.name || `upload-${Date.now()}`;
    tempPath = path.join(os.tmpdir(), `upload-${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`);

    await pipeline(Readable.fromWeb(file.stream()), fs.createWriteStream(tempPath));

    const uploaded = await uploadTelegramMedia({
      apiId: env.TELEGRAM_API_ID,
      apiHash: env.TELEGRAM_API_HASH,
      session: env.TELEGRAM_SESSION,
      chatId: telegramChatId,
      filePath: tempPath,
      fileName,
      caption: String(form.get('caption') || ''),
      mockDir: env.TELEGRAM_MOCK_DIR,
      useMock: env.TELEGRAM_USE_MOCK
    });

    const { meta } = await env.DB.prepare(`
      INSERT INTO files (
        folder_path, file_name, mime_type, file_size, telegram_chat_id, telegram_message_id,
        telegram_file_ref, metadata_json, origin, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'profile_upload', 'active')
    `).bind(
      folderPath,
      fileName,
      file.type || 'application/octet-stream',
      file.size || 0,
      uploaded.chatId,
      uploaded.messageId,
      uploaded.fileRef,
      JSON.stringify({ upload_caption: String(form.get('caption') || '') })
    ).run();

    await env.DB.prepare(
      'INSERT INTO upload_jobs (user_id, file_id, status) VALUES (?, ?, ?)'
    ).bind(loggedInUser.userId, meta.last_row_id, 'completed').run();

    return json({ success: true, file_id: meta.last_row_id }, 201);
  } catch (error) {
    console.error('Erro no upload:', error);
    return json({ message: `Falha no upload: ${error.message}` }, 500);
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
}
