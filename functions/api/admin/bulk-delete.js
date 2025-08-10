// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { keys, prefix } = await request.json();

        // VERIFICAÇÃO ÚNICA E SIMPLES
        if (!loggedInUser.permissions.includes('can_delete_items')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para excluir itens.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        if ((!keys || keys.length === 0) && !prefix) {
            return new Response(JSON.stringify({ message: 'É necessário fornecer "keys" ou "prefix".' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        let keysToDelete = [];
        if (keys && Array.isArray(keys)) {
            keysToDelete.push(...keys);
        }

        if (prefix && typeof prefix === 'string') {
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix });
            const folderKeys = list.keys.map(k => k.name);
            keysToDelete.push(...folderKeys);
            keysToDelete.push(`${prefix.replace(/\/$/, '')}/.placeholder`);
        }
        
        const uniqueKeysToDelete = [...new Set(keysToDelete)];

        if (uniqueKeysToDelete.length > 0) {
            await Promise.all(uniqueKeysToDelete.map(key => env.ARQUIVOS_TELEGRAM.delete(key)));
        }
        
        const logAction = prefix ? 'delete_folder' : 'delete_files';
        const logTarget = prefix ? `Prefixo: ${prefix}` : `Chaves: ${uniqueKeysToDelete.length} itens`;
        await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, logAction, logTarget)
            .run();

        return new Response(JSON.stringify({ success: true, message: `Exclusão concluída com sucesso.` }), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error("Erro ao excluir itens:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao excluir itens." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}