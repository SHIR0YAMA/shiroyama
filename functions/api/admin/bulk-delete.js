// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { keys, prefix } = await request.json();
        const isFolderDelete = !!prefix;

        if (isFolderDelete) {
            if (!loggedInUser.permissions.includes('items:delete_folders')) {
                return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: items:delete_folders` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        } else { // Se não for exclusão de pasta, é de arquivos
            if (!loggedInUser.permissions.includes('items:delete_files')) {
                return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: items:delete_files` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
        }

        let keysToDelete = [];
        if (keys && Array.isArray(keys)) {
            keysToDelete.push(...keys);
        }

        if (isFolderDelete && typeof prefix === 'string') {
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix });
            const folderKeys = list.keys.map(k => k.name);

            if (folderKeys.length > 0 && !loggedInUser.permissions.includes('items:delete_files')) {
                return new Response(JSON.stringify({ message: 'A pasta contém arquivos. Você também precisa da permissão "Excluir Arquivos".' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
            keysToDelete.push(...folderKeys);
            keysToDelete.push(`${prefix.replace(/\/$/, '')}/.placeholder`);
        }
        
        const uniqueKeysToDelete = [...new Set(keysToDelete)];
        if (uniqueKeysToDelete.length > 0) {
            await Promise.all(uniqueKeysToDelete.map(key => env.ARQUIVOS_TELEGRAM.delete(key)));
        } else if (isFolderDelete) {
             await env.ARQUIVOS_TELEGRAM.delete(`${prefix.replace(/\/$/, '')}/.placeholder`);
        }
        
        // Lógica de Log
        const logAction = isFolderDelete ? 'delete_folder' : 'delete_files';
        const logTarget = isFolderDelete ? `Prefixo: ${prefix}` : `Chaves: ${uniqueKeysToDelete.length} itens`;
        await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, logAction, logTarget)
            .run();

        return new Response(JSON.stringify({ success: true, message: `Exclusão concluída.` }));
    } catch (error) {
        console.error("Erro ao excluir itens:", error);
        return new Response(JSON.stringify({ message: "Erro interno." }), { status: 500 });
    }
}