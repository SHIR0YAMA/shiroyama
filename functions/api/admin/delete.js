// /functions/api/admin/delete.js

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const body = await request.json();

        const keyToDelete = body.key;
        const secret = body.secret;

        if (secret !== env.ADMIN_SECRET_KEY) {
            return new Response(JSON.stringify({ success: false, message: 'Acesso não autorizado.' }), { status: 403 });
        }

        if (!keyToDelete) {
            return new Response(JSON.stringify({ success: false, message: 'Chave do arquivo não fornecida.' }), { status: 400 });
        }

        await env.ARQUIVOS_TELEGRAM.delete(keyToDelete);

        return new Response(JSON.stringify({ success: true, message: `Arquivo "${keyToDelete}" deletado com sucesso.` }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}