// /functions/api/bulk-forward.js

// -- Função para verificar o Token JWT (necessária para saber quem pediu) --
async function verifyJwt(token, secret) { /* ... cole a função verifyJwt completa aqui ... */ }

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

        // 1. Verifica se o usuário está logado
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ message: 'Você precisa estar logado para usar esta função.' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);
        
        // Precisamos do ID do chat do usuário. A melhor forma é pedir para ele iniciar o bot.
        // Por agora, vamos assumir que o bot conhece o chat_id do usuário (ver nota abaixo).
        // A API do Telegram não nos dá o chat_id do usuário a partir do user_id facilmente.
        
        // --- Simplificação por agora: o frontend precisa enviar o chat_id ---
        // Vamos modificar o frontend para pedir o ID do chat do bot ao usuário.
        
        const { message_ids, user_chat_id } = await request.json();

        if (!Array.isArray(message_ids) || message_ids.length === 0 || !user_chat_id) {
            return new Response(JSON.stringify({ message: 'Dados inválidos.' }), { status: 400 });
        }
        
        // Envia uma mensagem inicial
        await sendMessage(env, user_chat_id, `Iniciando o envio de ${message_ids.length} arquivo(s)...`);

        // 2. Faz um loop e envia cada arquivo
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

        await sendMessage(env, user_chat_id, 'Todos os arquivos foram enviados!');

        return new Response(JSON.stringify({ success: true, message: 'Envio iniciado.' }));

    } catch (error) {
        return new Response(JSON.stringify({ message: `Erro: ${error.message}` }), { status: 500 });
    }
}