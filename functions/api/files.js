// /functions/api/files.js

export async function onRequestGet(context) {
    const { env, data } = context;
    const loggedInUser = data.user;

    if (!loggedInUser || !loggedInUser.permissions.includes('can_view_files')) {
        return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403 });
    }

    try {
        const [permsResult, kvListResult] = await Promise.all([
            env.DB.prepare("SELECT role_id, folder_path FROM folder_permissions").all(),
            env.ARQUIVOS_TELEGRAM.list({ limit: 1000 })
        ]);

        const folderPerms = permsResult.results;
        const allKeys = kvListResult.keys;

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

        // --- LÓGICA DE PERMISSÃO EM CASCATA ---
        const canAccessPath = (path) => {
            if (isOwner) return true;
            if (!path) return true;

            const pathParts = path.split('/');
            for (let i = pathParts.length; i > 0; i--) {
                const currentPath = pathParts.slice(0, i).join('/');
                if (permissionMap.has(currentPath)) {
                    return permissionMap.get(currentPath).has(loggedInUser.roleId);
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
                return { name: key.name, file_size: 0, message_id: null };
            }
            return null;
        });

        const accessibleFilesWithMetadata = (await Promise.all(filePromises)).filter(Boolean);

        const headers = new Headers({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });

        return new Response(JSON.stringify({
            files: accessibleFilesWithMetadata,
            allFolders: visibleFolders
        }), { headers });

    } catch (error) {
        console.error("Erro ao listar arquivos:", error);
        return new Response(JSON.stringify({ message: "Erro interno." }), { status: 500 });
    }
}