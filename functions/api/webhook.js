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

// --- FUNÇÃO DE PROCESSAMENTO CORRIGIDA PARA O FORMATO KV ---
async function processNewFile(env, fileData) {
    if (!fileData) {
        console.log("processNewFile foi chamado sem dados de arquivo.");
        return;
    }

    const { file_name, file_size, message_id, chat } = fileData;
    const from_chat_id = chat.id;

    // Garante que o bot só salve arquivos do canal configurado (env.CHANNEL_ID)
    if (from_chat_id.toString() !== env.CHANNEL_ID) {
        console.log(`Arquivo ignorado do chat ${from_chat_id} (não é o canal principal configurado)`);
        return;
    }

    const name = file_name || `arquivo_sem_nome_${message_id}`; // Fallback para nome
    
    // A chave no KV será "Novos/Nome do Arquivo"
    // Isso garante que o arquivo seja categorizado na pasta "Novos" e tenha o nome correto
    const key = `Novos/${name}`;

    // O valor será um JSON contendo message_id e file_size, conforme a estrutura esperada pelo frontend
    const value = JSON.stringify({
        message_id: message_id,
        file_size: file_size
    });

    try {
        // Usa o método .put() para salvar no KV
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

        // Para depuração, sempre logamos o evento completo
        console.log("================ INÍCIO DO EVENTO DO TELEGRAM ================");
        console.log(JSON.stringify(data, null, 2));
        console.log("================= FIM DO EVENTO DO TELEGRAM =================");

        // Tenta pegar a atualização de uma mensagem normal ou de um post de canal
        const update = data.message || data.channel_post;

        if (!update) {
            console.log("Evento recebido, mas não contém 'message' ou 'channel_post'. Ignorando.");
            return new Response('OK'); // Não é um evento que nos interessa
        }

        // Lógica para comandos de texto (como /start ou /unlink)
        if (update.text) {
            const text = update.text;
            const chat_id = update.chat.id;
            const from_user = update.from; // Objeto de onde a mensagem veio (para pegar username)

            if (text.startsWith('/start')) {
                const payload = text.split(' ')[1]; // Pega o que vem depois de /start
                if (payload && payload.startsWith('link_')) {
                    const findUserStmt = env.DB.prepare('SELECT id, username FROM users WHERE link_code = ?');
                    const userToLink = await findUserStmt.bind(payload).first();

                    if (!userToLink) {
                        await sendMessage(env, chat_id, '❌ **Código Inválido.** Este código não foi encontrado ou já foi usado. Gere um novo no seu perfil.');
                    } else {
                        // Vincula o usuário e limpa o código de uso único
                        const updateUserStmt = env.DB.prepare('UPDATE users SET telegram_chat_id = ?, telegram_username = ?, link_code = NULL WHERE id = ?');
                        await updateUserStmt.bind(chat_id, from_user.username, userToLink.id).run();
                        
                        const successMessage = `✅ **Sucesso!** Sua conta do Telegram foi vinculada ao usuário \`${userToLink.username}\`.`;
                        const replyMarkup = {
                            inline_keyboard: [[
                                { text: "⬅️ Voltar ao Site", url: `https://shiroyama.pages.dev/#/profile` }
                            ]]
                        };
                        await sendMessage(env, chat_id, successMessage, { reply_markup: replyMarkup });
                    }
                } else {
                    // Resposta para um /start sem payload ou com payload não reconhecido
                    await sendMessage(env, chat_id, `👋 Olá, ${from_user.first_name || 'Usuário'}! Use o site para interagir com seus arquivos.`);
                }
            } else if (text.startsWith('/unlink')) {
                // Lógica para desvincular a conta
                const findUserStmt = env.DB.prepare('SELECT id, username FROM users WHERE telegram_chat_id = ?');
                const userToUnlink = await findUserStmt.bind(chat_id).first();

                if (userToUnlink) {
                    const updateUserStmt = env.DB.prepare('UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL WHERE id = ?');
                    await updateUserStmt.bind(userToUnlink.id).run();
                    await sendMessage(env, chat_id, `✅ Sua conta do Telegram foi desvinculada com sucesso do usuário \`${userToUnlink.username}\`.`);
                } else {
                    await sendMessage(env, chat_id, 'ℹ️ Esta conta do Telegram não está vinculada a nenhum usuário no site.');
                }
            }
        } 
        // Lógica para processar arquivos (documentos, vídeos, áudios)
        else if (update.document || update.video || update.audio) {
            console.log("Evento de arquivo detectado. Processando...");
            const file = update.document || update.video || update.audio;
            const fileData = {
                file_name: file.file_name,
                file_size: file.file_size,
                message_id: update.message_id, // ID da mensagem no Telegram
                chat: update.chat // Objeto do chat de origem
            };
            await processNewFile(env, fileData);
        } else {
            console.log("Evento recebido, mas não é um comando de texto nem um arquivo reconhecido. Ignorando ação.");
        }

        // Sempre responde OK para o Telegram para evitar reenvios do webhook
        return new Response('OK');
    } catch (error) {
        // Loga erros críticos do nosso código
        console.error("Erro Crítico no Webhook:", error.stack);
        // Retorna um erro 500, mas sem detalhes sensíveis ao Telegram
        return new Response('Erro interno do servidor', { status: 500 });
    }
}