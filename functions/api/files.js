// /functions/api/files.js

export async function onRequestGet(context) {
    const { env, data } = context;
    const loggedInUser = data.user;

    // A verificação de permissão 'can_view_files' é feita aqui
    if (!loggedInUser || !loggedInUser.permissions.includes('can_view_files')) {
        return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para visualizar arquivos.' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const [permsResult, kvListResult, userRolesResult] = await Promise.all([
            env.DB.prepare("SELECT role_id, folder_path FROM folder_permissions").all(),
            env.ARQUIVOS_TELEGRAM.list({ limit: 1000 }), // Adicionar paginação se necessário
            env.DB.prepare("SELECT role_id FROM user_roles WHERE user_id = ?").bind(loggedInUser.userId).all()
        ]);

        const folderPerms = permsResult.results;
        const allKeys = kvListResult.keys;
        const loggedInUserRoleIds = new Set(userRolesResult.results.map(r => r.role_id));

        const permissionMap = new Map();
        folderPerms.forEach(p => {
            if (!permissionMap.has(p.folder_path)) {
                permissionMap.set(p.folder_path, new Set());
            }
            permissionMap.get(p.folder_path).add(p.role_id);
        });

        const isOwner = loggedInUser.level === 0;

        const allExistingFoldersSet = new Set();
        allKeys.forEach(key => {
            const pathParts = key.name.split('/');
            pathParts.pop();
            for (let i = 1; i <= pathParts.length; i++) {
                allExistingFoldersSet.add(pathParts.slice(0, i).join('/'));
            }
        });
        const allExistingFolders = Array.from(allExistingFoldersSet);
        
        const canAccessPath = (path) => {
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
        };

        const memo = {};
        const canTraversePath = (path) => {
            if (isOwner) return true;
            if (!path) return true;
            if (memo[path] !== undefined) return memo[path];

            if (canAccessPath(path)) {
                memo[path] = true;
                return true;
            }

            for (const folder of allExistingFolders) {
                if (folder.startsWith(path + '/') && canAccessPath(folder)) {
                    memo[path] = true;
                    return true;
                }
            }

            memo[path] = false;
            return false;
        };

        const visibleFolders = allExistingFolders.filter(folderPath => canTraversePath(folderPath));

        const accessibleKeys = allKeys.filter(key => {
            const folderPath = key.name.substring(0, key.name.lastIndexOf('/'));
            return canTraversePath(folderPath);
        });
        
        const filePromises = accessibleKeys.map(async (key) => {
            if (key.name.endsWith('/.placeholder')) {
                return { name: key.name, isPlaceholder: true };
            }
            try {
                const value = await env.ARQUIVOS_TELEGRAM.get(key.name);
                if (value) {
                    const metadata = JSON.parse(value);
                    return {
                        name: key.name,
                        file_size: metadata.file_size || 0,
                        message_id: metadata.message_id || null
                    };
                }
            } catch (e) {
                console.error(`Chave '${key.name}' tem valor inválido:`, e);
                return { name: key.name, file_size: 0, message_id: null };
            }
            return null;
        });

        const accessibleFilesWithMetadata = (await Promise.all(filePromises)).filter(Boolean);
        
        const headers = new Headers({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        return new Response(JSON.stringify({ 
            files: accessibleFilesWithMetadata,
            allFolders: visibleFolders
        }), { headers: headers });

    } catch (error) {
        console.error("Erro ao listar arquivos:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao buscar a lista de arquivos." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}