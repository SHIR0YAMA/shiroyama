// /functions/api/admin/folder-permissions.js

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function normalizePath(path) {
    return String(path || '').replace(/^\/+|\/+$/g, '');
}

async function handleGet(context) {
    const { request, env, data } = context;
    const loggedInUser = data.user;
    const url = new URL(request.url);
    const folderPath = normalizePath(url.searchParams.get('path'));

    if (!loggedInUser.permissions.includes('can_manage_folder_permissions')) {
        return json({ message: 'Acesso negado.' }, 403);
    }

    if (!folderPath) {
        return json({ message: 'O caminho da pasta é obrigatório.' }, 400);
    }

    try {
        const stmt = env.DB.prepare('SELECT role_id FROM folder_permissions WHERE folder_path = ?').bind(folderPath);
        const { results } = await stmt.all();
        const allowedRoleIds = results.map(r => r.role_id);
        return json({ allowedRoleIds });
    } catch (error) {
        console.error('Erro ao buscar permissões de pasta:', error);
        return json({ message: 'Erro interno no servidor.' }, 500);
    }
}

async function handlePost(context) {
    const { request, env, data } = context;
    const loggedInUser = data.user;

    if (!loggedInUser.permissions.includes('can_manage_folder_permissions')) {
        return json({ message: 'Acesso negado.' }, 403);
    }

    try {
        const { folderPath: rawFolderPath, roleIds } = await request.json();
        const db = env.DB;
        const folderPath = normalizePath(rawFolderPath);

        if (!folderPath || !Array.isArray(roleIds)) {
            return json({ message: 'Payload inválido.' }, 400);
        }

        const { results: allRoles } = await db.prepare('SELECT id, level FROM roles').all();
        const roleLevelMap = Object.fromEntries(allRoles.map(r => [r.id, r.level]));

        const originalPermsStmt = db.prepare('SELECT role_id FROM folder_permissions WHERE folder_path = ?').bind(folderPath);
        const { results: originalPermsResults } = await originalPermsStmt.all();
        const originalAllowedRoleIds = originalPermsResults.map(p => p.role_id);

        for (const roleId of originalAllowedRoleIds) {
            const isBeingRemoved = !roleIds.includes(roleId);
            if (!isBeingRemoved) continue;

            const targetRoleLevel = roleLevelMap[roleId];
            if (targetRoleLevel < loggedInUser.level || (targetRoleLevel === loggedInUser.level && roleId !== loggedInUser.roleId)) {
                return json({ message: 'Você não pode remover a permissão de um cargo com hierarquia superior ou igual à sua.' }, 403);
            }
        }

        const { results: subtreeFolders } = await db.prepare(
            'SELECT folder_path FROM folders WHERE folder_path = ? OR folder_path LIKE ? ORDER BY folder_path ASC'
        ).bind(folderPath, `${folderPath}/%`).all();

        const impactedPaths = new Set([folderPath, ...subtreeFolders.map(r => r.folder_path)]);
        const ops = [];

        for (const impactedPath of impactedPaths) {
            ops.push(db.prepare('DELETE FROM folder_permissions WHERE folder_path = ?').bind(impactedPath));
            for (const roleId of roleIds) {
                ops.push(db.prepare('INSERT INTO folder_permissions (folder_path, role_id) VALUES (?, ?)').bind(impactedPath, roleId));
            }
        }

        if (ops.length > 0) await db.batch(ops);

        try {
            await env.DB.prepare('INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)')
                .bind(loggedInUser.userId, loggedInUser.username, 'update_folder_perms', `Pasta: ${folderPath}; subpastas: ${impactedPaths.size - 1}`)
                .run();
        } catch (logError) {
            console.warn('Falha ao registrar admin_log update_folder_perms:', logError?.message || logError);
        }

        return json({ success: true, message: 'Permissões da pasta atualizadas com propagação para subpastas.' });
    } catch (error) {
        console.error('Erro ao salvar permissões de pasta:', error);
        return json({ message: 'Erro interno no servidor.' }, 500);
    }
}

export function onRequest(context) {
    switch (context.request.method) {
        case 'GET':
            return handleGet(context);
        case 'POST':
            return handlePost(context);
        default:
            return new Response('Método não permitido.', { status: 405 });
    }
}
