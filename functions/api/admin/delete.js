// /functions/api/admin/delete.js

export async function onRequestPost(context) {
    try {
        // O _middleware.js já verificou a permissão 'can_delete_items'.
        const { request, env } = context;
        const body = await request.json();
        const keyToDelete = body.key;

        if (!keyToDelete) {
            return new Response(JSON.stringify({ success: false, message: 'Chave do arquivo não fornecida.' }), { status: 400 });
        }

        await env.ARQUIVOS_TELEGRAM.delete(keyToDelete);

        return new Response(JSON.stringify({ success: true, message: `Item "${keyToDelete}" deletado com sucesso.` }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error("Erro ao deletar item:", error);
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}