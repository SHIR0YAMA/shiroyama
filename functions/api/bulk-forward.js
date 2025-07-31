// /functions/api/bulk-forward.js

// --- FUNÇÕES AUXILIARES COMPLETAS ---

// Função para verificar o Token JWT
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
        return decodedPayload;
    } catch (error) {
        // Lança um erro para ser pego pela função principal
        throw new Error(`Token inválido: ${error.message}`);
    }
}

// Função para enviar uma mensagem de texto via bot
async function sendMessage(env, chatId, text) {
    const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
    await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text })
    });
}


// --- FUNÇÃO PRINCIPAL DA API ---
export async function onRequestPost(context) {
    try {
        const { request, env } = context;

        // 1. Verifica o token e pega o ID do usuário do nosso site
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ success: false, message: 'Você precisa estar logado.' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET); // Agora esta função está completa e retornará o payload
        const userId = payload.userId;

        // 2. Busca o chat_id do usuário no banco de dados D1
        const stmt = env.DB.prepare('SELECT telegram_chat_id FROM users WHERE id = ?');
        const user = await stmt.bind(userId).first();

        if (!user || !user.telegram_chat_id) {
            return new Response(JSON.stringify({ success: false, message: 'Sua conta não está vinculada ao bot do Telegram. Por favor, acesse sua página de perfil para vincular.' }), { status: 400 });
        }
        const user_chat_id = user.telegram_chat_id;

        // 3. Pega a lista de arquivos a serem enviados
        const { message_ids } = await request.json();
        if (!Array.isArray(message_ids) || message_ids.length === 0) {
            return new Response(JSON.stringify({ success: false, message: 'Nenhum arquivo selecionado.' }), { status: 400 });
        }
        
        await sendMessage(env, user_chat_id, `Iniciando o envio de ${message_ids.length} arquivo(s)...`);

        // 4. Faz o loop e envia cada arquivo
        const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/copyMessage`;
        for (const msgId of message_ids) {
            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: user_chat_id, from_chat_id: env.CHANNEL_ID, message_id: msgId })
            });
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }

        await sendMessage(env, user_chat_id, '✅ Todos os arquivos foram enviados!');
        return new Response(JSON.stringify({ success: true, message: 'Processo de envio iniciado.' }));

    } catch (error) {
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}