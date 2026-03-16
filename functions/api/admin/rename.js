// /functions/api/admin/rename.js

function splitFilePath(fullPath) {
    const normalized = String(fullPath || '').replace(/^\/+|\/+$/g, '');
    const parts = normalized.split('/').filter(Boolean);
    const fileName = parts.pop() || '';
    return { folderPath: parts.join('/'), fileName };
}

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { oldKey, newKey, isFolder, action } = await request.json();

        let permissionNeeded;
        if (isFolder) permissionNeeded = action === 'move' ? 'can_move_folders' : 'can_rename_folders';
        else permissionNeeded = 'can_rename_items';

        if (!loggedInUser.permissions.includes(permissionNeeded)) {
            return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: ${permissionNeeded}` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        if (!oldKey || !newKey) {
            return new Response(JSON.stringify({ message: 'Nome antigo e novo são obrigatórios.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        if (isFolder) {
            const oldPath = String(oldKey).replace(/^\/+|\/+$/g, '');
            const newPath = String(newKey).replace(/^\/+|\/+$/g, '');

            if (!oldPath || !newPath) {
                return new Response(JSON.stringify({ message: 'Caminho de pasta inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }

            const { results: folderRows } = await env.DB.prepare(
                'SELECT id, folder_path FROM folders WHERE folder_path = ? OR folder_path LIKE ?'
            ).bind(oldPath, `${oldPath}/%`).all();

            const { results: fileRows } = await env.DB.prepare(
                'SELECT id, folder_path FROM files WHERE folder_path = ? OR folder_path LIKE ?'
            ).bind(oldPath, `${oldPath}/%`).all();

            if (folderRows.length === 0 && fileRows.length === 0) {
                return new Response(JSON.stringify({ message: 'Pasta de origem não encontrada.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
            }

            const ops = [];
            for (const row of folderRows) {
                const next = row.folder_path === oldPath ? newPath : row.folder_path.replace(`${oldPath}/`, `${newPath}/`);
                ops.push(env.DB.prepare('UPDATE folders SET folder_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next, row.id));
            }
            for (const row of fileRows) {
                const next = row.folder_path === oldPath ? newPath : row.folder_path.replace(`${oldPath}/`, `${newPath}/`);
                ops.push(env.DB.prepare('UPDATE files SET folder_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next, row.id));
            }

            const { results: permRows } = await env.DB.prepare(
                'SELECT folder_path, role_id FROM folder_permissions WHERE folder_path = ? OR folder_path LIKE ?'
            ).bind(oldPath, `${oldPath}/%`).all();
            if (permRows.length > 0) {
                ops.push(env.DB.prepare('DELETE FROM folder_permissions WHERE folder_path = ? OR folder_path LIKE ?').bind(oldPath, `${oldPath}/%`));
                for (const perm of permRows) {
                    const next = perm.folder_path === oldPath ? newPath : perm.folder_path.replace(`${oldPath}/`, `${newPath}/`);
                    ops.push(env.DB.prepare('INSERT INTO folder_permissions (folder_path, role_id) VALUES (?, ?)').bind(next, perm.role_id));
                }
            }

            await env.DB.batch(ops);

            return new Response(JSON.stringify({ success: true, message: 'Pasta movida/renomeada com sucesso.' }), { headers: { 'Content-Type': 'application/json' } });
        }

        const oldParsed = splitFilePath(oldKey);
        const newParsed = splitFilePath(newKey);
        if (!oldParsed.fileName || !newParsed.fileName) {
            return new Response(JSON.stringify({ message: 'Nome de arquivo inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const row = await env.DB.prepare(
            'SELECT id FROM files WHERE folder_path = ? AND file_name = ? LIMIT 1'
        ).bind(oldParsed.folderPath, oldParsed.fileName).first();

        if (!row) {
            return new Response(JSON.stringify({ message: 'Arquivo de origem não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        await env.DB.prepare(
            'UPDATE files SET folder_path = ?, file_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(newParsed.folderPath, newParsed.fileName, row.id).run();

        return new Response(JSON.stringify({ success: true, message: 'Arquivo renomeado com sucesso.' }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error('Erro ao renomear/mover:', error);
        return new Response(JSON.stringify({ message: `Erro interno ao renomear/mover: ${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
