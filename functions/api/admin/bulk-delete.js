// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { keys, prefix } = await request.json();

        // Verificação de permissão unificada
        if (!loggedInUser.permissions.includes('can_delete_items')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para excluir itens.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        if ((!keys || keys.length === 0) && !prefix) {
            return new Response(JSON.stringify({ message: 'É necessário fornecer "keys" ou "prefix".' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        let keysToDelete = [];
        const isFolderDelete = !!prefix;

        // Coleta chaves de arquivos individuais
        if (keys && Array.isArray(keys)) {
            keysToDelete.push(...keys);
        }

        // Coleta chaves de uma pasta inteira
        if (isFolderDelete && typeof prefix === 'string') {
            let listComplete = false;
            let cursor = undefined;
            const allFolderKeys = [];

            // Loop com paginação para garantir que TODAS as chaves sejam encontradas
            while(!listComplete) {
                const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: prefix, cursor: cursor, limit: 1000 });
                const batchKeys = list.keys.map(k => k.name);
                allFolderKeys.push(...batchKeys);
                
                if (list.truncated) {
                    cursor = list.cursor;
                } else {
                    listComplete = true;
                }
            }
            
            keysToDelete.push(...allFolderKeys);
            // Garante que o placeholder da própria pasta seja incluído na lista
            const placeholderKey = `${prefix.replace(/\/$/, '')}/.placeholder`;
            keysToDelete.push(placeholderKey);
        }
        
        const uniqueKeysToDelete = [...new Set(keysToDelete)];

        if (uniqueKeysToDelete.length > 0) {
            // CORREÇÃO DEFINITIVA: Executa uma operação de delete para cada chave.
            // Promise.all garante que todas as operações sejam tentadas em paralelo.
            const deletePromises = uniqueKeysToDelete.map(key => env.ARQUIVOS_TELEGRAM.delete(key));
            await Promise.all(deletePromises);
        }
        
        // Log da ação
        const logAction = isFolderDelete ? 'delete_folder' : 'delete_files';
        const logTarget = isFolderDelete ? `Prefixo: ${prefix}` : `Chaves: ${uniqueKeysToDelete.length} itens`;
        await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, logAction, logTarget)
            .run();

        return new Response(JSON.stringify({ success: true, message: `Exclusão concluída. ${uniqueKeysToDelete.length} itens processados.` }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao excluir itens:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao excluir itens." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}