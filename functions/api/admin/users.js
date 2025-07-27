// /functions/api/admin/users.js

// -- Função de verificação de Token JWT (copiada para cá) --
async function verifyJwt(token, secret) {
    try {
        const encoder = new TextEncoder();
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
        
        const dataToSign = `${encodedHeader}.${encodedPayload}`;
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        
        const signature = new Uint8Array(atob(encodedSignature.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));

        const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(dataToSign));

        if (!isValid) {
            throw new Error('Assinatura do token inválida');
        }

        const decodedPayload = JSON.parse(new TextDecoder().decode(new Uint8Array(atob(encodedPayload.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)))));

        if (decodedPayload.exp < Math.floor(Date.now() / 1000)) {
            throw new Error('Token expirado');
        }

        return decodedPayload;
    } catch (error) {
        throw new Error('Token inválido ou malformado');
    }
}

export async function onRequestGet(context) {
    try {
        const { request, env } = context;
        
        // 1. Verifica o token de autorização
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ success: false, message: 'Acesso negado.' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);

        // 2. Garante que apenas o 'owner' pode listar usuários
        if (payload.role !== 'owner') {
            return new Response(JSON.stringify({ success: false, message: 'Apenas o dono pode ver a lista de usuários.' }), { status: 403 });
        }

        // 3. Busca todos os usuários no banco de dados D1
        const stmt = env.DB.prepare('SELECT id, username, role, created_at FROM users ORDER BY username ASC');
        const { results } = await stmt.all();

        return new Response(JSON.stringify({ success: true, users: results }));

    } catch (error) {
        return new Response(JSON.stringify({ success: false, message: `Erro: ${error.message}` }), { status: 401 });
    }
}