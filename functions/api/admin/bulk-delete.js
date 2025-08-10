// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { keys, prefix } = await request.json();

        if (!loggedInUser.permissions.includes('can_delete_items')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para excluir itens.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        if (prefix) {
            // Lógica para Pastas
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: prefix });
            let keysToDelete = list.keys.map(k => k.name);
            
            // Adiciona o placeholder da pasta para garantir que ela suma
            keysToDelete.push(`${prefix.replace(/\/$/, "")}/.placeholder`);
            const uniqueKeys = [...new Set(keysToDelete)];

            if (uniqueKeys.length > 0) {
                // Para KV, precisamos deletar um por um.
                const deletePromises = uniqueKeys.map(key => env.ARQUIVOS_TELEGRAM.delete(key));
                await Promise.all(deletePromises);
            }

            return new Response(JSON.stringify({ success: true, message: `Pasta e conteúdo excluídos.` }));

        } else if (keys && keys.length > 0) {
            // Lógica para Arquivos
            const deletePromises = keys.map(key => env.ARQUIVOS_TELEGRAM.delete(key));
            await Promise.all(deletePromises);
            return new Response(JSON.stringify({ success: true, message: `${keys.length} arquivo(s) excluído(s).` }));

        } else {
            return new Response(JSON.stringify({ message: 'Nenhuma chave ou prefixo fornecido.' }), { status: 400 });
        }

    } catch (error) {
        console.error("Erro em bulk-delete:", error);
        return new Response(JSON.stringify({ message: "Erro interno no servidor." }), { status: 500 });
    }
}