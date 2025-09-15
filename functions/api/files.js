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
        // Busca todas as informações necessárias em paralelo
        const [permsResult, kvListResult, userRolesResult, groupsResult, groupItemsResult] = await Promise.all([
            env.DB.prepare("SELECT role_id, folder_path FROM folder_permissions").all(),
            env.ARQUIVOS_TELEGRAM.list({ limit: 1000 }), // Adicionar paginação se necessário
            env.DB.prepare("SELECT role_id FROM user_roles WHERE user_id = ?").bind(loggedInUser.userId).all(),
            env.DB.prepare("SELECT id, name, folder_path FROM file_groups").all(),
            env.DB.prepare("SELECT group_id, file_key, part_number FROM group_items ORDER BY part_number ASC").all()
        ]);

        const folderPerms = permsResult.results;
        const allKeys = kvListResult.keys;
        const loggedInUserRoleIds = new Set(userRolesResult.results.map(r => r.role_id));
        const allGroups = groupsResult.results;
        const allGroupItems = groupItemsResult.results;
        
        const groupItemsMap = new Map();
        allGroupItems.forEach(item => {
            if (!groupItemsMap.has(item.group_id)) {
                groupItemsMap.set(item.group_id, []);
            }
            groupItemsMap.get(item.group_id).push(item.file_key);
        });
        
        const keysInGroups = new Set(allGroupItems.map(item => item.file_key));
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
        allGroups.forEach(group => {
            if(group.folder_path) allExistingFoldersSet.add(group.folder_path);
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

        // --- MONTAGEM DA LISTA FINAL DE ARQUIVOS E GRUPOS ---
        const filePromises = allKeys.map(async (key) => {
            if (keysInGroups.has(key.name)) return null;
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
                        message_id: metadata.message_id || null,
                        group_id: metadata.group_id || null, // Passa o group_id se existir
                        part_number: metadata.part_number || null // Passa o part_number se existir
                    };
                }
            } catch (e) {
                console.error(`Chave '${key.name}' tem valor inválido:`, e);
                return { name: key.name, file_size: 0, message_id: null };
            }
            return null;
        });

        const individualFiles = (await Promise.all(filePromises)).filter(Boolean);

        const groupPromises = allGroups.map(async (group) => {
            const itemKeys = groupItemsMap.get(group.id) || [];
            if (itemKeys.length === 0) return null;

            const itemMetadatas = await Promise.all(
                itemKeys.map(key => env.ARQUIVOS_TELEGRAM.get(key).then(val => val ? JSON.parse(val) : null))
            );
            
            const validItems = itemMetadatas.filter(Boolean);
            const totalSize = validItems.reduce((sum, item) => sum + (item.file_size || 0), 0);
            const messageIds = validItems.map(item => item.message_id);

            return {
                name: `${group.folder_path ? group.folder_path + '/' : ''}${group.name}`,
                file_size: totalSize,
                message_ids: messageIds,
                isGroup: true,
                groupId: group.id,
                groupItems: itemKeys
            };
        });

        const virtualGroupFiles = (await Promise.all(groupPromises)).filter(Boolean);
        
        const combinedFiles = [...individualFiles, ...virtualGroupFiles];
        
        const accessibleItems = combinedFiles.filter(item => {
            const folderPath = item.name.substring(0, item.name.lastIndexOf('/'));
            return canTraversePath(folderPath);
        });
        
        const visibleFolders = allExistingFolders.filter(folderPath => canTraversePath(folderPath));

        const headers = new Headers({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });

        return new Response(JSON.stringify({ 
            files: accessibleItems,
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