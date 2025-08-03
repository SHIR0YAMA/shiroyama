// /functions/api/user/status.js

async function verifyJwt(token, secret) {
    try {
        const encoder = new TextEncoder();
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
        if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Formato do token inválido');
        const dataToSign = `${encodedHeader}.${encodedPayload}`;
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const signature = new Uint8Array(atob(encodedSignature.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));
        const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(dataToSign));
        if (!isValid) throw new Error('Assinatura do token inválida');
        const decodedPayload = JSON.parse(new TextDecoder().decode(new Uint8Array(atob(encodedPayload.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)))));
        if (decodedPayload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expirado');
        return decodedPayload;
    } catch (error) {
        throw new Error(`Token inválido: ${error.message}`);
    }
}

export async function onRequestGet(context) {
    const { request, env } = context;
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ message: 'Auth requerida' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);
        
        // --- ALTERAÇÃO CRÍTICA AQUI ---
        // A query agora junta a tabela 'users' com a 'roles' para pegar o nome do cargo (role_name)
        // em vez da coluna 'role' que não existe mais.
        const query = `
            SELECT 
                u.id, 
                u.username, 
                r.name as role_name, 
                u.telegram_chat_id, 
                u.telegram_username 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE u.id = ?
        `;
        const stmt = env.DB.prepare(query).bind(payload.userId);
        const user = await stmt.first();

        if (!user) {
            return new Response(JSON.stringify({ message: 'Usuário não encontrado' }), { status: 404 });
        }
        
        return new Response(JSON.stringify(user));

    } catch (error) {
        console.error("Erro em /api/user/status:", error.stack);
        return new Response(JSON.stringify({ message: error.message }), { status: 500 });
    }
}