import { downloadTelegramMedia } from '../../../server/telegram-account.js';
import { Readable } from 'node:stream';

function canAccessPath(path, isOwner, permissionMap, loggedInUserRoleIds) {
    if (isOwner) return true;
    if (!path) return true;

    const pathParts = path.split('/');
    for (let i = pathParts.length; i > 0; i--) {
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

function logDownloadDecision(reason, details) {
    console.log('[download-auth]', { reason, ...details });
}

export async function onRequestGet(context) {
    const { params, env, data } = context;
    const loggedInUser = data.user;

    const parts = params.catchall || [];
    if (parts.length !== 2 || parts[1] !== 'download') {
        return new Response(JSON.stringify({ message: 'Rota não encontrada.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    if (!loggedInUser || !loggedInUser.permissions.includes('can_view_files')) {
        logDownloadDecision('missing_permission_can_view_files', { fileId: Number(parts[0] || 0), userId: loggedInUser?.userId || null, username: loggedInUser?.username || null, role: loggedInUser?.role || null, level: loggedInUser?.level ?? null });
        return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    const fileId = Number(parts[0]);
    if (!Number.isInteger(fileId) || fileId <= 0) {
        return new Response(JSON.stringify({ message: 'ID de arquivo inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    let media = null;
    try {
        const [file, permsResult, userRolesResult] = await Promise.all([
            env.DB.prepare(`
                SELECT id, folder_path, file_name, mime_type, file_size, telegram_chat_id, telegram_message_id
                FROM files
                WHERE id = ?
            `).bind(fileId).first(),
            env.DB.prepare('SELECT role_id, folder_path FROM folder_permissions').all(),
            env.DB.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').bind(loggedInUser.userId).all()
        ]);

        if (!file) {
            logDownloadDecision('file_not_found', { fileId, userId: loggedInUser.userId, username: loggedInUser.username || null, role: loggedInUser.role || null, level: loggedInUser.level ?? null });
            return new Response(JSON.stringify({ message: 'Arquivo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const permissionMap = new Map();
        permsResult.results.forEach((p) => {
            if (!permissionMap.has(p.folder_path)) {
                permissionMap.set(p.folder_path, new Set());
            }
            permissionMap.get(p.folder_path).add(p.role_id);
        });

        const loggedInUserRoleIds = new Set((userRolesResult.results || []).map((r) => r.role_id));
        const isOwner = loggedInUser.level === 0;
        if (!canAccessPath(file.folder_path || '', isOwner, permissionMap, loggedInUserRoleIds)) {
            logDownloadDecision('folder_permission_denied', {
                fileId: file.id,
                folderPath: file.folder_path || '',
                userId: loggedInUser.userId,
                username: loggedInUser.username || null,
                role: loggedInUser.role || null,
                level: loggedInUser.level ?? null,
                roleIds: Array.from(loggedInUserRoleIds)
            });
            return new Response(JSON.stringify({ message: 'Sem acesso a este arquivo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        logDownloadDecision('download_granted', { fileId: file.id, folderPath: file.folder_path || '', userId: loggedInUser.userId, username: loggedInUser.username || null, role: loggedInUser.role || null, level: loggedInUser.level ?? null });

        media = await downloadTelegramMedia({
            apiId: env.TELEGRAM_API_ID,
            apiHash: env.TELEGRAM_API_HASH,
            session: env.TELEGRAM_SESSION,
            chatId: file.telegram_chat_id,
            messageId: file.telegram_message_id,
            mockDir: env.TELEGRAM_MOCK_DIR,
            useMock: env.TELEGRAM_USE_MOCK
        });

        const headers = new Headers();
        headers.set('Content-Type', file.mime_type || 'application/octet-stream');
        headers.set('Content-Disposition', `attachment; filename="${sanitizeFilename(file.file_name)}"`);
        if (media.contentLength) headers.set('Content-Length', String(media.contentLength));
        else if (file.file_size) headers.set('Content-Length', String(file.file_size));

        let cleanedUp = false;
        const cleanup = async () => {
            if (cleanedUp) return;
            cleanedUp = true;
            if (media?.cleanup) {
                await media.cleanup();
            }
        };

        media.stream.once('end', () => { cleanup().catch(() => {}); });
        media.stream.once('close', () => { cleanup().catch(() => {}); });
        media.stream.once('error', () => { cleanup().catch(() => {}); });

        const body = Readable.toWeb(media.stream);
        return new Response(body, { status: 200, headers });
    } catch (error) {
        if (media?.cleanup) {
            await media.cleanup().catch(() => {});
        }
        console.error('Erro ao baixar arquivo:', error);
        return new Response(JSON.stringify({ message: `Falha no download: ${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
