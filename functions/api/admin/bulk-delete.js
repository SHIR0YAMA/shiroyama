// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { keys, prefix } = await request.json();

        if (!loggedInUser.permissions.includes('can_delete_items')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para excluir itens.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        if ((!keys || keys.length === 0) && !prefix) {
            return new Response(JSON.stringify({ message: 'É necessário fornecer "keys" ou "prefix".' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        let keysToDelete = [];
        let isFolderDelete = !!prefix;

        if (keys && Array.isArray(keys)) {
            keysToDelete.push(...keys);
        }

        if (isFolderDelete && typeof prefix === 'string') {
            const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/';
            
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: normalizedPrefix });
            const folderContentKeys = list.keys.map(k => k.name);
            keysToDelete.push(...folderContentKeys);

            // Adiciona explicitamente o placeholder da pasta PAI à lista
            const placeholderKey = `${normalizedPrefix.slice(0, -1)}/.placeholder`;
            keysToDelete.push(placeholderKey);
        }
        
        const uniqueKeysToDelete = [...new Set(keysToDelete.filter(Boolean))];

        if (uniqueKeysToDelete.length > 0) {
            const deletePromises = uniqueKeysToDelete.map(key => env.ARQUIVOS_TELEGRAM.delete(key));
            await Promise.all(deletePromises);
        }
        
        const logAction = isFolderDelete ? 'delete_folder' : 'delete_files';
        const logTarget = isFolderDelete ? `Prefixo: ${prefix}` : `Chaves: uniqueKeysToDelete.length} itens`;
        await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, logAction, logTarget)
            .run();

        return new Response(JSON.stringify({ success: true, message: `Exclusão concluída com sucesso.` }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error("Erro ao excluir itens:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao excluir itens." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}