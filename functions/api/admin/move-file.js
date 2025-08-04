// /functions/api/admin/move-file.js

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        // O _middleware.js já cuidou da autenticação e permissão.
        // A permissão necessária seria 'can_move_items'.

        const { oldKey, newKey } = await request.json();

        if (!oldKey || !newKey) {
            return new Response(JSON.stringify({ message: 'Chave antiga e nova são obrigatórias.' }), { status: 400 });
        }
        
        const value = await env.ARQUIVOS_TELEGRAM.get(oldKey);
        
        if (value === null) {
            return new Response(JSON.stringify({ message: 'Arquivo de origem não encontrado.' }), { status: 404 });
        }

        await env.ARQUIVOS_TELEGRAM.put(newKey, value);
        await env.ARQUIVOS_TELEGRAM.delete(oldKey);

        return new Response(JSON.stringify({ success: true, message: 'Arquivo movido com sucesso.' }));

    } catch (error) {
        console.error("Erro ao mover arquivo:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao mover arquivo." }), { status: 500 });
    }
}