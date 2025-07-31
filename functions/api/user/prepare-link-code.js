// /functions/api/user/prepare-link-code.js

async function verifyJwt(token, secret) { /* ... Cole a função verifyJwt completa aqui ... */ }

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) return new Response(JSON.stringify({ message: 'Auth necessária' }), { status: 401 });
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);

        const { linkCode } = await request.json();
        if (!linkCode || !linkCode.startsWith('link_')) {
            return new Response(JSON.stringify({ message: 'Código inválido' }), { status: 400 });
        }
        
        const stmt = env.DB.prepare('UPDATE users SET link_code = ? WHERE id = ?');
        await stmt.bind(linkCode, payload.userId).run();
        
        return new Response(null, { status: 204 });
    } catch (error) {
        console.error("Erro em prepare-link-code:", error.message);
        return new Response(JSON.stringify({ success: false, message: error.message }), { status: 500 });
    }
}