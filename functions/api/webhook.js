// /functions/api/webhook.js

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const data = await request.json();

        // --- LÓGICA DE DETECÇÃO ROBUSTA ---
        // O Telegram pode enviar a mensagem em diferentes campos.
        // data.message: Típico de mensagens de usuários ou posts em grupos.
        // data.channel_post: Típico de posts automáticos em canais.
        const message = data.message || data.channel_post;

        // Se não houver nenhum objeto de mensagem, não há nada a fazer.
        if (!message) {
            return new Response('OK: No message object found.', { status: 200 });
        }
        
        // --- LÓGICA PARA RESPONDER AO PEDIDO DE DOWNLOAD (/start) ---
        if (message.text && message.text.startsWith('/start')) {
            const user_chat_id = message.chat.id;
            const parts = message.text.split(' ');
            
            if (parts.length > 1 && !isNaN(parts[1])) {
                const message_id_to_forward = parseInt(parts[1], 10);
                
                const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/copyMessage`;
                await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: user_chat_id,
                        from_chat_id: env.CHANNEL_ID,
                        message_id: message_id_to_forward
                    })
                });
            } else {
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
            // Após lidar com o /start, encerramos a execução para este evento.
            return new Response('OK: Start command processed.', { status: 200 });
        }
        
        // --- LÓGICA PARA ADICIONAR NOVOS ARQUIVOS AO SITE ---
        // Verifica se a mensagem contém algum tipo de arquivo.
        const fileData = message.document || message.video || message.audio || message.photo;
        
        if (fileData) {
            let file = Array.isArray(fileData) ? fileData.sort((a, b) => b.file_size - a.file_size)[0] : fileData;
            
            // Importante: Precisamos garantir que estamos pegando a message_id da mensagem correta
            // e não de alguma mensagem encaminhada dentro dela.
            const message_id = message.message_id;
            const file_name = file.file_name || `photo_${message_id}.jpg`;
            const file_size = file.file_size || 0;

            const value = JSON.stringify({
                message_id: message_id,
                file_size: file_size
            });

            // Adiciona o arquivo ao KV na pasta "Novos"
            await env.ARQUIVOS_TELEGRAM.put(`Novos/${file_name}`, value);
        }

        // Se chegamos até aqui, tudo correu bem.
        return new Response('OK: Event processed.', { status: 200 });

    } catch (error) {
        // Loga o erro para depuração futura no painel da Cloudflare.
        console.error('Webhook Error:', error.stack);
        return new Response(`Webhook Error: ${error.message}`, { status: 500 });
    }
}