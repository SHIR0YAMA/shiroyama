// /functions/api/user/prepare-link-code.js

// --- INÍCIO DA FUNÇÃO verifyJwt COMPLETA ---
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
        if (!isValid) {
            throw new Error('Assinatura do token inválida');
        }
        const decodedPayload = JSON.parse(new TextDecoder().decode(new Uint8Array(atob(encodedPayload.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)))));
        if (decodedPayload.exp < Math.floor(Date.now() / 1000)) {
            throw new Error('Token expirado');
        }
        return decodedPayload; // Retorna o objeto com os dados do usuário
    } catch (error) {
        throw new Error(`Token inválido: ${error.message}`);
    }
}
// --- FIM DA FUNÇÃO verifyJwt COMPLETA ---


export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ message: 'Auth necessária' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        
        // Esta chamada agora funcionará, pois verifyJwt retorna o objeto correto
        const payload = await verifyJwt(token, env.JWT_SECRET);

        const { linkCode } = await request.json();
        if (!linkCode || !linkCode.startsWith('link_')) {
            return new Response(JSON.stringify({ message: 'Código inválido' }), { status: 400 });
        }
        
        // Esta linha não vai mais dar erro, pois payload.userId existirá
        const stmt = env.DB.prepare('UPDATE users SET link_code = ? WHERE id = ?');
        await stmt.bind(linkCode, payload.userId).run();
        
        return new Response(null, { status: 204 });

    } catch (error) {
        console.error("Erro em prepare-link-code:", error.message);
        return new Response(JSON.stringify({ success: false, message: error.message }), { status: 500 });
    }
}