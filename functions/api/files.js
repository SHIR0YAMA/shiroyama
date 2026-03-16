// /functions/api/files.js

export async function onRequestGet(context) {
    const { env, data } = context;
    const loggedInUser = data.user;

    if (!loggedInUser || !loggedInUser.permissions.includes('can_view_files')) {
        return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para visualizar arquivos.' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const [permsResult, userRolesResult, filesResult, foldersResult] = await Promise.all([
            env.DB.prepare('SELECT role_id, folder_path FROM folder_permissions').all(),
            env.DB.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').bind(loggedInUser.userId).all(),
            env.DB.prepare(`
                SELECT id, folder_path, file_name, mime_type, file_size, origin, status, updated_at
                FROM files
                ORDER BY folder_path ASC, file_name ASC
            `).all(),
            env.DB.prepare('SELECT folder_path FROM folders ORDER BY folder_path ASC').all()
        ]);

        const permissionMap = new Map();
        (permsResult.results || []).forEach((p) => {
            if (!permissionMap.has(p.folder_path)) permissionMap.set(p.folder_path, new Set());
            permissionMap.get(p.folder_path).add(p.role_id);
        });

        const loggedInUserRoleIds = new Set((userRolesResult.results || []).map((r) => r.role_id));
        const isOwner = loggedInUser.level === 0;

        const canAccessPath = (path) => {
            if (isOwner) return true;
            if (!path) return true;
            const parts = path.split('/');
            for (let i = parts.length; i > 0; i--) {
                const current = parts.slice(0, i).join('/');
                if (permissionMap.has(current)) {
                    const allowed = permissionMap.get(current);
                    for (const roleId of loggedInUserRoleIds) {
                        if (allowed.has(roleId)) return true;
                    }
                    return false;
                }
            }
            return true;
        };

        const allFilesRows = filesResult.results || [];
        const accessibleFiles = allFilesRows
            .filter((file) => canAccessPath(file.folder_path || ''))
            .map((file) => ({
                id: file.id,
                name: `${file.folder_path ? `${file.folder_path}/` : ''}${file.file_name}`,
                file_size: file.file_size || 0,
                mime_type: file.mime_type || 'application/octet-stream',
                origin: file.origin || 'bot_sync',
                status: file.status || 'active',
                updated_at: file.updated_at || null,
                isGroup: false
            }));

        const folderSet = new Set();
        (foldersResult.results || []).forEach((f) => {
            if (f.folder_path) folderSet.add(f.folder_path);
        });
        allFilesRows.forEach((file) => {
            const fp = file.folder_path || '';
            if (!fp) return;
            const parts = fp.split('/');
            for (let i = 1; i <= parts.length; i++) folderSet.add(parts.slice(0, i).join('/'));
        });

        const visibleFolders = Array.from(folderSet).filter((folderPath) => canAccessPath(folderPath));

        return new Response(JSON.stringify({ files: accessibleFiles, allFolders: visibleFolders }), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        });
    } catch (error) {
        console.error('Erro ao listar arquivos:', error);
        return new Response(JSON.stringify({ message: 'Erro interno ao buscar a lista de arquivos.' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
