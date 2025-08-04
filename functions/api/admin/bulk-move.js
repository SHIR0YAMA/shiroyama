// /functions/api/admin/bulk-move.js

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        // O _middleware.js já verificou a permissão 'can_move_items'

        const { oldKeys, destinationPath } = await request.json();

        if (!Array.isArray(oldKeys) || oldKeys.length === 0 || typeof destinationPath !== 'string') {
            return new Response(JSON.stringify({ message: 'Payload inválido. É necessário "oldKeys" (array) e "destinationPath" (string).' }), { status: 400 });
        }
        
        const moveOperations = oldKeys.map(async (oldKey) => {
            const value = await env.ARQUIVOS_TELEGRAM.get(oldKey);

            if (value !== null) {
                const fileName = oldKey.split('/').pop();
                const newKey = destinationPath ? `${destinationPath}/${fileName}` : fileName;

                if (oldKey !== newKey) {
                    await env.ARQUIVOS_TELEGRAM.put(newKey, value);
                    await env.ARQUIVOS_TELEGRAM.delete(oldKey);
                }
            }
        });

        await Promise.all(moveOperations);

        return new Response(JSON.stringify({ success: true, message: `${oldKeys.length} arquivo(s) movido(s) com sucesso.` }));

    } catch (error) {
        console.error("Erro ao mover arquivos em massa:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao mover arquivos." }), { status: 500 });
    }
}