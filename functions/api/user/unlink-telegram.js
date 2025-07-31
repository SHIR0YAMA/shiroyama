// /functions/api/user/unlink-telegram.js

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
        // 1. Autenticação: Garante que o usuário está logado.
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ success: false, message: 'Autenticação necessária.' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);
        const userId = payload.userId;

        // 2. Ação no Banco de Dados: Define o telegram_chat_id como NULL para o usuário logado.
        const stmt = env.DB.prepare('UPDATE users SET telegram_chat_id = NULL WHERE id = ?');
        await stmt.bind(userId).run();

        // 3. Sucesso: Retorna uma resposta de sucesso.
        return new Response(JSON.stringify({ success: true, message: 'Sua conta do Telegram foi desvinculada com sucesso.' }));

    } catch (error) {
        // Tratamento de erros (token inválido, etc.)
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}