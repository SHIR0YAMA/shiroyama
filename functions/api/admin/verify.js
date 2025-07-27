// /functions/api/admin/verify.js

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const body = await request.json();
        const secret = body.secret;

        // Compara a senha enviada com a senha secreta no ambiente
        if (secret && secret === env.ADMIN_SECRET_KEY) {
            // Se a senha for correta, retorna sucesso
            return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' },
            });
        } else {
            // Se a senha for incorreta, retorna falha
            return new Response(JSON.stringify({ success: false }), {
                status: 401, // 401 Unauthorized
                headers: { 'Content-Type': 'application/json' },
            });
        }
    } catch (error) {
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}