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

async function processNewFile(env, fileData) {
    if (!fileData) {
        console.log("processNewFile foi chamado sem dados de arquivo.");
        return;
    }

    const { file_name, file_size, message_id, chat } = fileData;
    const from_chat_id = chat.id;

    if (from_chat_id.toString() !== env.CHANNEL_ID) {
        console.log(`Arquivo ignorado do chat ${from_chat_id} (não é o canal principal configurado)`);
        return;
    }

    const name = file_name || `arquivo_sem_nome_${message_id}`;
    const key = `Novos/${name}`;
    const value = JSON.stringify({
        message_id: message_id,
        file_size: file_size
    });

    try {
        await env.ARQUIVOS_TELEGRAM.put(key, value);
        console.log(`Arquivo salvo com sucesso no KV com a chave "${key}"`);
    } catch (e) {
        console.error(`Erro ao salvar arquivo no KV ARQUIVOS_TELEGRAM: ${e.message}`);
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const data = await request.json();
        const update = data.message || data.channel_post;

        if (!update) {
            return new Response('OK');
        }

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
                        const successMessage = `✅ **Sucesso!** Sua conta do Telegram foi vinculada ao usuário \`${userToLink.username}\`.`;
                        const replyMarkup = {
                            inline_keyboard: [[
                                { text: "⬅️ Voltar ao Site", url: `https://shiroyama.pages.dev/#/profile` }
                            ]]
                        };
                        await sendMessage(env, chat_id, successMessage, { reply_markup: replyMarkup });
                    } else {
                        await sendMessage(env, chat_id, '❌ **Código Inválido.** Este código não foi encontrado ou já foi usado.');
                    }
                } else {
                    await sendMessage(env, chat_id, `👋 Olá, ${from_user.first_name || 'Usuário'}! Use o site para interagir com seus arquivos.`);
                }
            } else if (text.startsWith('/unlink')) {
                const findUserStmt = env.DB.prepare('SELECT id, username FROM users WHERE telegram_chat_id = ?');
                const userToUnlink = await findUserStmt.bind(chat_id).first();
                if (userToUnlink) {
                    const updateUserStmt = env.DB.prepare('UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL WHERE id = ?');
                    await updateUserStmt.bind(userToUnlink.id).run();
                    await sendMessage(env, chat_id, `✅ Sua conta do Telegram foi desvinculada com sucesso do usuário \`${userToUnlink.username}\`.`);
                } else {
                    await sendMessage(env, chat_id, 'ℹ️ Esta conta do Telegram não está vinculada a nenhum usuário no site.');
                }
            } else if (text.startsWith('/site')) {
                const siteMessage = "Você pode acessar o site através do link abaixo:";
                const replyMarkup = {
                    inline_keyboard: [[
                        { text: "🔗 Abrir Shiroyama Files", url: `https://shiroyama.pages.dev/` }
                    ]]
                };
                await sendMessage(env, chat_id, siteMessage, { reply_markup: replyMarkup });
            }
        } else if (update.document || update.video || update.audio) {
            const file = update.document || update.video || update.audio;
            const fileData = {
                file_name: file.file_name,
                file_size: file.file_size,
                message_id: update.message_id,
                chat: update.chat
            };
            await processNewFile(env, fileData);
        }

        return new Response('OK');
    } catch (error) {
        console.error("Erro Crítico no Webhook:", error.stack);
        return new Response('Erro interno do servidor', { status: 500 });
    }
}