// /functions/api/webhook.js

// --- FUNÇÕES AUXILIARES ---

async function sendMessage(env, chatId, text) {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' }),
    });
}

async function copyMessage(env, chatId, fromChatId, messageId) {
    if (!fromChatId) {
        console.error("Erro Crítico: A variável de ambiente CHANNEL_ID não foi configurada.");
        await sendMessage(env, chatId, "❌ *Erro de Configuração do Administrador:*\nO `CHANNEL_ID` de origem não foi definido no servidor.");
        return;
    }
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
    if (!response.ok) {
        const errorResult = await response.json();
        const errorMessage = errorResult.description || 'Erro desconhecido da API do Telegram.';
        console.error(`Falha ao encaminhar a mensagem ${messageId} para o chat ${chatId}:`, errorMessage);
        await sendMessage(env, chatId, `❌ *Ocorreu um erro ao tentar enviar o arquivo.*\n\n*Motivo:* ${errorMessage}`);
    }
}


// --- FUNÇÃO PRINCIPAL DA API (WEBHOOK) ---

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const data = await request.json();

        // A estrutura `data.message.text` é a correta, como vimos no log.
        if (data.message && data.message.text) {
            const message = data.message;
            const from = message.from;
            const chat_id = from.id;

            if (message.text.startsWith('/start')) {
                const payload = message.text.split(' ')[1];

                if (payload) {
                    // Cenário 1: Vincular conta
                    if (payload.startsWith('link_')) {
                        const findUserStmt = env.DB.prepare('SELECT id FROM users WHERE link_code = ?');
                        const user = await findUserStmt.bind(payload).first();

                        if (user) {
                            const updateUserStmt = env.DB.prepare('UPDATE users SET telegram_chat_id = ? WHERE id = ?');
                            await updateUserStmt.bind(chat_id, user.id).run();
                            await sendMessage(env, chat_id, '✅ Ótimo! Sua conta do Telegram foi vinculada com sucesso ao site.');
                        } else {
                            await sendMessage(env, chat_id, '❌ Código de vínculo inválido ou já utilizado.');
                        }
                    
                    // Cenário 2: Enviar arquivo
                    } else {
                        const fileStmt = env.DB.prepare('SELECT message_id FROM files WHERE unique_id = ?');
                        const file = await fileStmt.bind(payload).first();

                        // SE O ARQUIVO FOR ENCONTRADO, ENVIE-O.
                        if (file) {
                            await copyMessage(env, chat_id, env.CHANNEL_ID, file.message_id);
                        
                        // SE NÃO FOR ENCONTRADO, AVISE O USUÁRIO. (ESTA PARTE FALTAVA)
                        } else {
                            await sendMessage(env, chat_id, `❌ Arquivo não encontrado.\n\nNão foi possível localizar um arquivo com o ID \`${payload}\` no banco de dados.`);
                        }
                    }

                // Cenário 3: /start sem payload
                } else {
                    const welcomeText = `👋 Olá, ${from.first_name}!\n\nEste é o bot do seu Drive pessoal. Use o site para ver e gerenciar seus arquivos.`;
                    await sendMessage(env, chat_id, welcomeText);
                }
            }
        }
        
        return new Response('OK', { status: 200 });

    } catch (error) {
        console.error("Erro no processamento do webhook:", error);
        return new Response('Erro interno do servidor.', { status: 500 });
    }
}