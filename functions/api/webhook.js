// /functions/api/webhook.js

// --- FUNÇÕES AUXILIARES ---

/**
 * Envia uma mensagem de texto simples para um chat do Telegram.
 * @param {object} env - As variáveis de ambiente (contém BOT_TOKEN).
 * @param {string|number} chatId - O ID do chat para onde enviar a mensagem.
 * @param {string} text - O texto a ser enviado.
 */
async function sendMessage(env, chatId, text) {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text }),
    });
}

/**
 * Copia uma mensagem (arquivo) de um canal para um chat do Telegram.
 * @param {object} env - As variáveis de ambiente (contém BOT_TOKEN e CHANNEL_ID).
 * @param {string|number} chatId - O ID do chat de destino.
 * @param {string|number} fromChatId - O ID do chat de origem (seu canal).
 * @param {string|number} messageId - O ID da mensagem a ser copiada.
 */
async function copyMessage(env, chatId, fromChatId, messageId) {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/copyMessage`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            from_chat_id: fromChatId,
            message_id: messageId,
        }),
    });
    // Opcional: Log de erros caso a API do Telegram falhe.
    if (!response.ok) {
        const errorResult = await response.json();
        console.error(`Falha ao encaminhar a mensagem ${messageId} para o chat ${chatId}:`, errorResult.description);
    }
}


// --- FUNÇÃO PRINCIPAL DA API (WEBHOOK) ---

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const data = await request.json();

        // Checamos se a atualização tem uma mensagem e se essa mensagem tem texto.
        if (data.message && data.message.text) {
            const message = data.message;
            const from = message.from;
            const chat_id = from.id;

            // Lógica para o comando /start
            if (message.text.startsWith('/start')) {
                const payload = message.text.split(' ')[1];

                // Cenário 1: Payload existe. Pode ser um código de vínculo ou de arquivo.
                if (payload) {
                    // Cenário 1.1: O payload é para VINCULAR A CONTA de um usuário.
                    if (payload.startsWith('link_')) {
                        const findUserStmt = env.DB.prepare('SELECT id FROM users WHERE link_code = ?');
                        const user = await findUserStmt.bind(payload).first();

                        if (user) {
                            const updateUserStmt = env.DB.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?');
                            await updateUserStmt.bind(chat_id, user.id).run();
                            await sendMessage(env, chat_id, '✅ Ótimo! Sua conta do Telegram foi vinculada com sucesso ao site.');
                        } else {
                            await sendMessage(env, chat_id, '❌ Código de vínculo inválido ou já utilizado. Por favor, gere um novo código no seu perfil do site.');
                        }
                    
                    // Cenário 1.2: O payload é o ID de um ARQUIVO para ser enviado.
                    } else {
                        await sendMessage(env, chat_id, '⏳ Um momento, estou buscando seu arquivo...');
                        
                        const fileStmt = env.DB.prepare('SELECT message_id FROM files WHERE unique_id = ?');
                        const file = await fileStmt.bind(payload).first();

                        if (file) {
                            // Encontramos o arquivo, agora vamos copiá-lo para o usuário.
                            await copyMessage(env, chat_id, env.CHANNEL_ID, file.message_id);
                            // Opcional: enviar mensagem de confirmação após o envio do arquivo.
                            // await sendMessage(env, chat_id, '✅ Arquivo enviado!'); 
                        } else {
                            // Não encontramos o arquivo no banco de dados.
                            await sendMessage(env, chat_id, '❌ Arquivo não encontrado. Ele pode ter sido removido ou o link é inválido.');
                        }
                    }

                // Cenário 2: Comando /start simples, sem payload.
                } else {
                    const welcomeText = `👋 Olá, ${from.first_name}!\n\nEste é o bot do seu Drive pessoal. Use o site para ver e gerenciar seus arquivos.`;
                    await sendMessage(env, chat_id, welcomeText);
                }
            } 
            // Você pode adicionar mais `else if` aqui para outros comandos no futuro (ex: /help)
        }
        
        // Responde OK para a API do Telegram para confirmar o recebimento do webhook.
        return new Response('OK', { status: 200 });

    } catch (error) {
        // Em caso de um erro inesperado no nosso código, registramos no log.
        console.error("Erro no processamento do webhook:", error);
        // Retornamos um erro 500 para indicar que algo falhou do nosso lado.
        return new Response('Erro interno do servidor.', { status: 500 });
    }
}