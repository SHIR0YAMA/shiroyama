// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const body = await request.json();
        const { keys, prefix } = body;

        // Se o prefixo foi enviado, a intenção é deletar uma pasta.
        if (prefix) {
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

            await env.DB.prepare("INSERT INTO admin_logs...").bind(...).run(); // Log
            return new Response(JSON.stringify({ success: true, message: `Pasta e seu conteúdo excluídos.` }));

        } 
        // Se `keys` foi enviado, a intenção é deletar arquivos.
        else if (keys && Array.isArray(keys)) {
            if (!loggedInUser.permissions.includes('items:delete_files')) {
                return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: items:delete_files` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
            
            await Promise.all(keys.map(key => env.ARQUIVOS_TELEGRAM.delete(key)));

            await env.DB.prepare("INSERT INTO admin_logs...").bind(...).run(); // Log
            return new Response(JSON.stringify({ success: true, message: `${keys.length} arquivo(s) excluído(s).` }));
        }
        
        return new Response(JSON.stringify({ message: 'Payload inválido.' }), { status: 400 });

    } catch (error) {
        console.error("Erro ao excluir itens:", error);
        return new Response(JSON.stringify({ message: "Erro interno." }), { status: 500 });
    }
}