// /functions/api/bulk-forward.js

// -- Função de verificação de Token JWT --
async function verifyJwt(token, secret) {
    try {
        const encoder = new TextEncoder();
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
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

// -- Função auxiliar para enviar uma mensagem de texto --
async function sendMessage(env, chatId, text) {
    const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
    await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text })
    });
}

export async function onRequestPost(context) {
    try {
        const { request, env } = context;

        // 1. Verifica o token de autorização
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ success: false, message: 'Você precisa estar logado para usar esta função.' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        await verifyJwt(token, env.JWT_SECRET);

        // 2. Pega os dados da requisição
        const { message_ids, user_chat_id } = await request.json();
        if (!Array.isArray(message_ids) || message_ids.length === 0 || !user_chat_id) {
            return new Response(JSON.stringify({ success: false, message: 'Dados inválidos. Faltam IDs de arquivos ou o ID do chat do usuário.' }), { status: 400 });
        }
        
        // Envia uma mensagem inicial para o usuário
        await sendMessage(env, user_chat_id, `Iniciando o envio de ${message_ids.length} arquivo(s)... Por favor, aguarde.`);

        // 3. Faz um loop e envia cada arquivo
        const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/copyMessage`;
        for (const msgId of message_ids) {
            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: user_chat_id,
                    from_chat_id: env.CHANNEL_ID,
                    message_id: msgId
                })
            });
            // Adiciona uma pequena pausa para não sobrecarregar a API do Telegram
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }

        await sendMessage(env, user_chat_id, '✅ Todos os arquivos foram enviados!');

        return new Response(JSON.stringify({ success: true, message: 'Processo de envio iniciado.' }));

    } catch (error) {
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}