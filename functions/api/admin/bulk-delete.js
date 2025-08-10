// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const body = await request.json();
        const { keys, prefix } = body;

        const isFolderDelete = !!prefix;

        if (isFolderDelete) {
            if (!loggedInUser.permissions.includes('items:delete_folders')) {
                return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: items:delete_folders` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix });
            const folderKeys = list.keys.map(k => k.name);

            if (folderKeys.length > 0 && !loggedInUser.permissions.includes('items:delete_files')) {
                return new Response(JSON.stringify({ message: 'A pasta contém arquivos. Você também precisa da permissão "Excluir Arquivos" para apagar a pasta e seu conteúdo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            let keysToDelete = [...folderKeys, `${prefix.replace(/\/$/, '')}/.placeholder`];
            const uniqueKeysToDelete = [...new Set(keysToDelete)];

            if (uniqueKeysToDelete.length > 0) {
                await Promise.all(uniqueKeysToDelete.map(key => env.ARQUIVOS_TELEGRAM.delete(key)));
            }

            await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
                .bind(loggedInUser.userId, loggedInUser.username, 'delete_folder', `Prefixo: ${prefix}`)
                .run();
                
            return new Response(JSON.stringify({ success: true, message: `Pasta e seu conteúdo excluídos.` }), { headers: { 'Content-Type': 'application/json' } });

        } 
        else if (keys && Array.isArray(keys)) {
            if (!loggedInUser.permissions.includes('items:delete_files')) {
                return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: items:delete_files` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
            
            await Promise.all(keys.map(key => env.ARQUIVOS_TELEGRAM.delete(key)));
            
            const logTarget = `Chaves: ${keys.slice(0, 3).join(', ')}... (${keys.length} total)`;
            await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
                .bind(loggedInUser.userId, loggedInUser.username, 'delete_files', logTarget)
                .run();

            return new Response(JSON.stringify({ success: true, message: `${keys.length} arquivo(s) excluído(s).` }), { headers: { 'Content-Type': 'application/json' } });
        }
        
        return new Response(JSON.stringify({ message: 'Payload inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error("Erro ao excluir itens:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao excluir itens." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}