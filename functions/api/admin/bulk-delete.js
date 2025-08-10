// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { keys, prefix } = await request.json();

        if ((!keys || keys.length === 0) && !prefix) {
            return new Response(JSON.stringify({ message: 'É necessário fornecer "keys" ou "prefix".' }), { status: 400 });
        }
        
        // --- LÓGICA DE PERMISSÃO CORRIGIDA ---
        const isFolderDelete = !!prefix;
        if (isFolderDelete && !loggedInUser.permissions.includes('items:delete_folders')) {
            return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: items:delete_folders` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (!isFolderDelete && !loggedInUser.permissions.includes('items:delete_files')) {
            return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: items:delete_files` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        // --- FIM DA CORREÇÃO ---

        let keysToDelete = [];
        if (keys && Array.isArray(keys)) {
            keysToDelete.push(...keys);
        }

        if (isFolderDelete && typeof prefix === 'string') {
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: prefix });
            const folderKeys = list.keys.map(k => k.name);
            keysToDelete.push(`${prefix.replace(/\/$/, '')}/.placeholder`);
            
            if (folderKeys.length > 0 && !loggedInUser.permissions.includes('items:delete_files')) {
                return new Response(JSON.stringify({ message: 'A pasta contém arquivos. Você precisa da permissão "Excluir Arquivos" para apagar a pasta e seu conteúdo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
            keysToDelete.push(...folderKeys);
        }
        
        const uniqueKeysToDelete = [...new Set(keysToDelete)];
        if (uniqueKeysToDelete.length === 0) {
            return new Response(JSON.stringify({ success: true, message: 'Nenhum item para excluir.' }));
        }

        const deletePromises = uniqueKeysToDelete.map(key => env.ARQUIVOS_TELEGRAM.delete(key));
        await Promise.all(deletePromises);

        const logAction = isFolderDelete ? 'delete_folder' : 'delete_files';
        const logTarget = isFolderDelete ? `Prefixo: ${prefix}` : `Chaves: ${uniqueKeysToDelete.slice(0, 3).join(', ')}... (${uniqueKeysToDelete.length} total)`;
        await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, logAction, logTarget)
            .run();

        return new Response(JSON.stringify({ success: true, message: `${uniqueKeysToDelete.length} item(ns) excluído(s) com sucesso.` }));

    } catch (error) {
        console.error("Erro ao excluir itens:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao excluir itens." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}