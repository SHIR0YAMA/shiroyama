// /functions/api/user/generate-link-code.js

// --- FUNÇÃO AUXILIAR PARA VERIFICAR TOKEN JWT ---
async function verifyJwt(token, secret) {
    try {
        const encoder = new TextEncoder();
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
        if (!encodedHeader || !encodedPayload || !encodedSignature) {
            throw new Error('Formato do token inválido');
        }
        const dataToSign = `${encodedHeader}.${encodedPayload}`;
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const signature = new Uint8Array(atob(encodedSignature.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));
        const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(dataToSign));
        if (!isValid) throw new Error('Assinatura do token inválida');

        const decodedPayload = JSON.parse(new TextDecoder().decode(new Uint8Array(atob(encodedPayload.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)))));
        if (decodedPayload.exp < Math.floor(Date.now() / 1000)) {
            throw new Error('Token expirado');
        }
        return decodedPayload;
    } catch (error) {
        throw new Error(`Token inválido: ${error.message}`);
    }
}

// --- FUNÇÃO PRINCIPAL DA API ---
export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ message: 'Autenticação necessária' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);
        
        // Gera um código aleatório simples
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // --- ALTERAÇÃO CRÍTICA AQUI ---
        // Adicionamos o prefixo "link_" para que o webhook possa identificá-lo.
        const linkCode = `link_${code}`;

        // Salva o código com prefixo no banco de dados
        const stmt = env.DB.prepare('UPDATE users SET link_code = ? WHERE id = ?');
        await stmt.bind(linkCode, payload.userId).run();

        // Retorna o CÓDIGO COM PREFIXO para o frontend
        return new Response(JSON.stringify({ success: true, code: linkCode }));
        
    } catch (error) {
        return new Response(JSON.stringify({ success: false, message: error.message }), { status: 500 });
    }
}