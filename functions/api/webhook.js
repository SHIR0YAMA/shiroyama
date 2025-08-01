// /functions/api/webhook.js

async function sendMessage(env, chatId, text, extra_params = {}) {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            ...extra_params
        }),
    });
}

// --- FUNÇÃO DE PROCESSAMENTO DE ARQUIVOS (REUTILIZÁVEL) ---
async function processNewFile(env, fileData) {
    if (!fileData) return;

    const { file_id, file_unique_id, file_name, file_size, message_id, chat } = fileData;
    const from_chat_id = chat.id;

    if (from_chat_id.toString() !== env.CHANNEL_ID) {
        // Ignora arquivos que não vêm do canal configurado
        console.log(`Arquivo ignorado do chat ${from_chat_id} (não é o canal principal)`);
        return;
    }

    const name = file_name || `arquivo_${file_unique_id}`;

    try {
        const stmt = env.DB.prepare(
            'INSERT INTO files (name, file_id, unique_id, file_size, message_id) VALUES (?, ?, ?, ?, ?)'
        );
        await stmt.bind(name, file_id, file_unique_id, file_size, message_id).run();
        console.log(`Arquivo salvo com sucesso: ${name}`);
    } catch (e) {
        console.error(`Erro ao salvar arquivo no banco de dados: ${e.message}`);
    }
}


export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const data = await request.json();

        // --- ALTERAÇÃO CRÍTICA AQUI ---
        // Unifica o tratamento de 'message' (grupos) e 'channel_post' (canais)
        const update = data.message || data.channel_post;

        if (!update) {
            return new Response('OK'); // Nenhum evento relevante
        }

        // Se for um comando de texto (como /start ou /unlink)
        if (update.text) {
            const text = update.text;
            const chat_id = update.chat.id;
            const from_user = update.from;

            if (text.startsWith('/start')) {
                const payload = text.split(' ')[1];
                if (payload && payload.startsWith('link_')) {
                    const findUserStmt = env.DB.prepare('SELECT id, username FROM users WHERE link_code = ?');
                    const userToLink = await findUserStmt.bind(payload).first();
                    if (userToLink) {
                        const updateUserStmt = env.DB.prepare('UPDATE users SET telegram_chat_id = ?, telegram_username = ?, link_code = NULL WHERE id = ?');
                        await updateUserStmt.bind(chat_id, from_user.username, userToLink.id).run();
                        const successMessage = `✅ **Sucesso!** Sua conta foi vinculada ao usuário \`${userToLink.username}\`.`;
                        const replyMarkup = { inline_keyboard: [[{ text: "⬅️ Voltar ao Site", url: `https://shiroyama.pages.dev/#/profile` }]] };
                        await sendMessage(env, chat_id, successMessage, { reply_markup: replyMarkup });
                    } else {
                        await sendMessage(env, chat_id, '❌ **Código Inválido.**');
                    }
                } else {
                    await sendMessage(env, chat_id, `👋 Olá, ${from_user.first_name}! Use o site para interagir.`);
                }
            } else if (text.startsWith('/unlink')) {
                const findUserStmt = env.DB.prepare('SELECT id, username FROM users WHERE telegram_chat_id = ?');
                const userToUnlink = await findUserStmt.bind(chat_id).first();
                if (userToUnlink) {
                    const updateUserStmt = env.DB.prepare('UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL WHERE id = ?');
                    await updateUserStmt.bind(userToUnlink.id).run();
                    await sendMessage(env, chat_id, `✅ Sua conta foi desvinculada do usuário \`${userToUnlink.username}\`.`);
                } else {
                    await sendMessage(env, chat_id, 'ℹ️ Esta conta não está vinculada a nenhum usuário.');
                }
            }
        }
        
        // Se a mensagem contiver um arquivo (documento, vídeo ou áudio)
        else if (update.document || update.video || update.audio) {
            const file = update.document || update.video || update.audio;
            const fileData = {
                file_id: file.file_id,
                file_unique_id: file.file_unique_id,
                file_name: file.file_name,
                file_size: file.file_size,
                message_id: update.message_id,
                chat: update.chat
            };
            await processNewFile(env, fileData);
        }

        return new Response('OK');
    } catch (error) {
        console.error("Erro Crítico no Webhook:", error);
        return new Response('Erro interno do servidor', { status: 500 });
    }
}