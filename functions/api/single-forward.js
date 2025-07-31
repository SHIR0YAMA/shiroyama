// /functions/api/single-forward.js

// --- FUNÇÃO AUXILIAR PARA VERIFICAR TOKEN JWT ---
// No futuro, podemos mover isso para um middleware para não repetir o código.
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

        // 2. Validação: Verifica se o usuário tem um chat do Telegram vinculado.
        const stmt = env.DB.prepare('SELECT telegram_chat_id FROM users WHERE id = ?');
        const user = await stmt.bind(userId).first();

        if (!user || !user.telegram_chat_id) {
            return new Response(JSON.stringify({ success: false, message: 'Sua conta não está vinculada ao bot do Telegram. Vincule no seu perfil.' }), { status: 403 });
        }
        const user_chat_id = user.telegram_chat_id;

        // 3. Obtenção do ID do arquivo: Pega o message_id do corpo da requisição.
        const { message_id } = await request.json();
        if (!message_id) {
            return new Response(JSON.stringify({ success: false, message: 'Nenhum arquivo especificado.' }), { status: 400 });
        }
        
        // 4. Envio: Copia a mensagem/arquivo do canal para o chat do usuário.
        await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/copyMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: user_chat_id,
                from_chat_id: env.CHANNEL_ID,
                message_id: message_id 
            })
        });

        // 5. Sucesso: Retorna uma resposta de sucesso.
        return new Response(JSON.stringify({ success: true, message: 'Arquivo enviado para o seu Telegram!' }));

    } catch (error) {
        // Tratamento de erros (token inválido, etc.)
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}