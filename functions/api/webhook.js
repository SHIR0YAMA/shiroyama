// /functions/api/webhook.js

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const data = await request.json();

        // --- LÓGICA PARA RESPONDER AO PEDIDO DE DOWNLOAD DO USUÁRIO ---
        // Isso acontece quando o usuário clica no link do site e aperta "Começar" no Telegram.
        if (data.message && data.message.text && data.message.text.startsWith('/start')) {
            const user_chat_id = data.message.chat.id;
            const parts = data.message.text.split(' ');
            
            // Verifica se o comando /start tem um ID de mensagem junto (ex: "/start 123")
            if (parts.length > 1 && !isNaN(parts[1])) {
                const message_id_to_forward = parseInt(parts[1], 10);
                
                // Usa a API do Telegram para copiar a mensagem do nosso canal para o usuário
                const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/copyMessage`;
                await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: user_chat_id,          // Para quem enviar
                        from_chat_id: env.CHANNEL_ID,   // De onde copiar
                        message_id: message_id_to_forward // O que copiar
                    })
                });
            } else {
                // Se o usuário apenas digitar /start, envia uma mensagem de boas-vindas
                const welcomeApiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
                await fetch(welcomeApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: user_chat_id,
                        text: "Olá! Para receber um arquivo, encontre-o em nosso site e clique no botão 'Receber no Telegram'."
                    })
                });
            }
            return new Response('OK', { status: 200 });
        }
        
        // --- LÓGICA PARA ADICIONAR NOVOS ARQUIVOS AO SITE (a lógica antiga) ---
        // Isso acontece quando um novo arquivo é postado no nosso canal privado.
        const message = data.channel_post;
        if (message && (message.document || message.video || message.audio || message.photo)) {
            let file = message.document || message.video || message.audio || message.photo;
            if (Array.isArray(file)) {
                file = file.sort((a, b) => b.file_size - a.file_size)[0];
            }
            const file_name = file.file_name || `photo_${message.message_id}.jpg`;
            const value = JSON.stringify({
                message_id: message.message_id,
                file_size: file.file_size || 0
            });
            await env.ARQUIVOS_TELEGRAM.put(`Novos/${file_name}`, value);
        }

        return new Response('OK', { status: 200 });

    } catch (error) {
        console.error('Webhook Error:', error);
        return new Response(`Webhook Error: ${error.message}`, { status: 500 });
    }
}