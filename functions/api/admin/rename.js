// /functions/api/admin/rename.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { oldKey, newKey, isFolder, action } = await request.json();
        
        let permissionNeeded;
        if (isFolder) {
            // A ação de mover uma pasta requer a permissão 'can_move_folders'
            permissionNeeded = action === 'move' ? 'can_move_folders' : 'can_rename_folders';
        } else {
            permissionNeeded = 'can_rename_items';
        }
        
        if (!loggedInUser.permissions.includes(permissionNeeded)) {
            return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: ${permissionNeeded}` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        if (!oldKey || !newKey) {
            return new Response(JSON.stringify({ message: 'Nome antigo e novo são obrigatórios.' }), { status: 400 });
        }
        
        if (isFolder) {
            // --- NOVA LÓGICA PARA PERMISSÕES DE PASTAS ---
            // 1. Antes de mover, busca as permissões da pasta original
            const permsStmt = env.DB.prepare("SELECT role_id FROM folder_permissions WHERE folder_path = ?").bind(oldKey);
            const { results: oldPerms } = await permsStmt.all();
            const roleIdsToMigrate = oldPerms.map(p => p.role_id);
            // --- FIM DA BUSCA ---
            
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: oldKey + '/' });
            
            if (list.keys.length === 0) {
                const placeholderValue = await env.ARQUIVOS_TELEGRAM.get(oldKey + '/.placeholder');
                if (placeholderValue) {
                    await env.ARQUIVOS_TELEGRAM.put(newKey + '/.placeholder', placeholderValue);
                    await env.ARQUIVOS_TELEGRAM.delete(oldKey + '/.placeholder');
                } else {
                    return new Response(JSON.stringify({ message: 'Pasta de origem não encontrada.' }), { status: 404 });
                }
            } else {
                const operations = list.keys.map(async (key) => {
                    const originalValue = await env.ARQUIVOS_TELEGRAM.get(key.name);
                    if (originalValue !== null) {
                        const newPath = key.name.replace(oldKey, newKey);
                        await env.ARQUIVOS_TELEGRAM.put(newPath, originalValue);
                        await env.ARQUIVOS_TELEGRAM.delete(key.name);
                    }
                });
                await Promise.all(operations);
            }

            // --- NOVA LÓGICA PARA PERMISSÕES DE PASTAS ---
            // 2. Se existiam permissões, apaga as antigas e cria as novas para o novo caminho
            if (roleIdsToMigrate.length > 0) {
                const deleteOldPermsStmt = env.DB.prepare("DELETE FROM folder_permissions WHERE folder_path = ?").bind(oldKey);
                const insertNewPermsStmts = roleIdsToMigrate.map(roleId => 
                    env.DB.prepare("INSERT INTO folder_permissions (folder_path, role_id) VALUES (?, ?)").bind(newKey, roleId)
                );
                
                await env.DB.batch([deleteOldPermsStmt, ...insertNewPermsStmts]);
            }
            // --- FIM DA ATUALIZAÇÃO ---

            return new Response(JSON.stringify({ success: true, message: 'Pasta movida/renomeada com sucesso.' }));

        } else {
            const value = await env.ARQUIVOS_TELEGRAM.get(oldKey);
            if (value === null) {
                return new Response(JSON.stringify({ message: 'Arquivo de origem não encontrado.' }), { status: 404 });
            }
            await env.ARQUIVOS_TELEGRAM.put(newKey, value);
            await env.ARQUIVOS_TELEGRAM.delete(oldKey);
            return new Response(JSON.stringify({ success: true, message: 'Arquivo renomeado com sucesso.' }));
        }
    } catch (error) {
        console.error("Erro ao renomear/mover:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao renomear/mover." }), { status: 500 });
    }
}