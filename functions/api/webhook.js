// /functions/api/webhook.js

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

async function sendMessage(env, chatId, text) {
    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' }),
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const data = await request.json();
        if (!data.message || !data.message.text) return new Response('OK');

        const message = data.message;
        const chat_id = message.chat.id;
        const from_user = message.from;
        const text = message.text;

        if (text.startsWith('/start')) {
            const token = text.split(' ')[1];

            if (!token) {
                await sendMessage(env, chat_id, `👋 Olá, ${from_user.first_name}! Use o site para interagir com seus arquivos.`);
                return new Response('OK');
            }
            
            try {
                // Tenta validar o token recebido
                const payload = await verifyJwt(token, env.JWT_SECRET);
                const userIdToLink = payload.userId;

                // Vincula a conta
                const stmt = env.DB.prepare('UPDATE users SET telegram_chat_id = ?, telegram_username = ? WHERE id = ?');
                await stmt.bind(chat_id, from_user.username, userIdToLink).run();
                
                await sendMessage(env, chat_id, `✅ **Sucesso!** Sua conta do Telegram foi vinculada ao usuário \`${payload.username}\` no site.`);

            } catch (error) {
                // Se verifyJwt falhar (token expirado, inválido, etc.)
                console.error("Falha ao vincular com token:", error.message);
                await sendMessage(env, chat_id, '❌ **Link Inválido.** Este link de vínculo é inválido ou expirou. Por favor, gere um novo no seu perfil.');
            }
        }
        return new Response('OK');
    } catch (error) {
        console.error("Erro Crítico no Webhook:", error);
        return new Response('Erro interno do servidor.', { status: 500 });
    }
}