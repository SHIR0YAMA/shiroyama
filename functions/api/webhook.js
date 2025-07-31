// /functions/api/webhook.js

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const data = await request.json();
        const message = data.message || data.channel_post;

        if (!message) { return new Response('OK: No message object found.', { status: 200 }); }
        
        // --- LÓGICA DE VINCULAÇÃO DE CONTA ---
        if (message.text && message.text.startsWith('/link')) {
            const code = message.text.split(' ')[1];
            const chatId = message.chat.id;
            const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
            let responseText = "Ocorreu um erro ao vincular sua conta.";

            if (code && chatId) {
                const stmt = env.DB.prepare('UPDATE users SET telegram_chat_id = ?, link_code = NULL WHERE link_code = ?');
                const result = await stmt.bind(chatId, code).run();

                if (result.meta.changes > 0) {
                    responseText = "✅ Conta vinculada com sucesso! Agora você pode receber múltiplos arquivos pelo site.";
                } else {
                    responseText = "❌ Código de vinculação inválido ou expirado. Por favor, gere um novo código no seu perfil.";
                }
            }
            
            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: responseText })
            });

            return new Response('OK: Link command processed.', { status: 200 });
        }
        
        // --- LÓGICA PARA ADICIONAR NOVOS ARQUIVOS AO SITE ---
        const channelMessage = data.channel_post;
        if (channelMessage && (channelMessage.document || channelMessage.video || channelMessage.audio || channelMessage.photo)) {
            let file = channelMessage.document || channelMessage.video || channelMessage.audio || channelMessage.photo;
            if (Array.isArray(file)) {
                file = file.sort((a, b) => b.file_size - a.file_size)[0];
            }
            const file_name = file.file_name || `photo_${channelMessage.message_id}.jpg`;
            const value = JSON.stringify({
                message_id: channelMessage.message_id,
                file_size: file.file_size || 0
            });
            await env.ARQUIVOS_TELEGRAM.put(`Novos/${file_name}`, value);
        }

        return new Response('OK: Event processed.', { status: 200 });
    } catch (error) {
        console.error('Webhook Error:', error.stack);
        return new Response(`Webhook Error: ${error.message}`, { status: 500 });
    }
}