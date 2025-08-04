// /functions/api/admin/bulk-delete.js

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        // O _middleware.js já verificou a permissão 'can_delete_items'
        const { keys, prefix } = await request.json();

        if (!keys && !prefix) {
            return new Response(JSON.stringify({ message: 'É necessário fornecer "keys" ou "prefix".' }), { status: 400 });
        }

        let keysToDelete = [];

        if (keys && Array.isArray(keys)) {
            keysToDelete.push(...keys);
        }

        if (prefix && typeof prefix === 'string') {
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: prefix });
            const folderKeys = list.keys.map(k => k.name);
            keysToDelete.push(...folderKeys);
        }
        
        if (keysToDelete.length === 0) {
            return new Response(JSON.stringify({ success: true, message: 'Nenhum arquivo para excluir.' }));
        }

        // Usando o bulk delete do R2, que é mais eficiente que o do KV
        const MAX_KEYS_PER_DELETE = 1000;
        for (let i = 0; i < keysToDelete.length; i += MAX_KEYS_PER_DELETE) {
            const batch = keysToDelete.slice(i, i + MAX_KEYS_PER_DELETE);
            await env.ARQUIVOS_TELEGRAM.delete(batch);
        }

        return new Response(JSON.stringify({ success: true, message: `${keysToDelete.length} item(ns) excluído(s) com sucesso.` }));

    } catch (error) {
        console.error("Erro ao excluir arquivos/pastas:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao excluir itens." }), { status: 500 });
    }
}