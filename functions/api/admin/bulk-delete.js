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
            return new Response(JSON.stringify({ message: 'É necessário fornecer "keys" ou "prefix".' }), { status: 400 });
        }

        let keysToDelete = [];
        let isFolderDelete = !!prefix;

        if (keys && Array.isArray(keys)) {
            keysToDelete.push(...keys);
        }

        if (isFolderDelete && typeof prefix === 'string') {
            let listComplete = false;
            let cursor = undefined;
            const allFolderKeys = [];

            // Paginação para garantir que todas as chaves sejam listadas
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
            keysToDelete.push(`${prefix.replace(/\/$/, '')}/.placeholder`);
        }
        
        const uniqueKeysToDelete = [...new Set(keysToDelete)];

        if (uniqueKeysToDelete.length > 0) {
            // Processa a exclusão em lotes de 1000 (limite da API do R2)
            const MAX_KEYS_PER_DELETE = 1000;
            for (let i = 0; i < uniqueKeysToDelete.length; i += MAX_KEYS_PER_DELETE) {
                const batch = uniqueKeysToDelete.slice(i, i + MAX_KEYS_PER_DELETE);
                await env.ARQUIVOS_TELEGRAM.delete(batch);
            }
        }
        
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