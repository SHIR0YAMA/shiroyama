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

// --- FUNÇÃO PRINCIPAL DA API (WEBHOOK) ---
export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const data = await request.json();

        // O evento principal que nos interessa é uma mensagem de texto.
        if (!data.message || !data.message.text) {
            // Se não for uma mensagem de texto, ignoramos e respondemos OK.
            return new Response('OK', { status: 200 });
        }

        const message = data.message;
        const chat_id = message.chat.id;
        const text = message.text;
        
        // --- LÓGICA REESTRUTURADA PARA O COMANDO /start ---
        if (text.startsWith('/start')) {
            const payload = text.split(' ')[1]; // Pega o que vem depois de /start

            // CENÁRIO 1: /start com um payload (código de vínculo)
            if (payload && payload.startsWith('link_')) {
                
                // Passo 1: Encontrar o usuário que tem esse código de vínculo.
                const findUserStmt = env.DB.prepare('SELECT id, username, telegram_chat_id FROM users WHERE link_code = ?');
                const userToLink = await findUserStmt.bind(payload).first();

                // Passo 2: Verificar se encontramos um usuário.
                if (!userToLink) {
                    await sendMessage(env, chat_id, '❌ **Código Inválido.** Este código de vínculo não foi encontrado. Por favor, gere um novo no seu perfil.');
                    return new Response('OK', { status: 200 });
                }

                // Passo 3: Verificar se a conta do Telegram já está vinculada a OUTRO usuário.
                const checkExistingLinkStmt = env.DB.prepare('SELECT id, username FROM users WHERE telegram_chat_id = ?');
                const existingUser = await checkExistingLinkStmt.bind(chat_id).first();

                if (existingUser && existingUser.id !== userToLink.id) {
                    await sendMessage(env, chat_id, `❌ **Conta já Vinculada.** Esta conta do Telegram já está associada ao usuário \`${existingUser.username}\`. Desvincule primeiro, se necessário.`);
                    return new Response('OK', { status: 200 });
                }

                // Passo 4: Se tudo estiver certo, vincular a conta.
                const updateUserStmt = env.DB.prepare('UPDATE users SET telegram_chat_id = ?, link_code = NULL WHERE id = ?');
                await updateUserStmt.bind(chat_id, userToLink.id).run();
                
                await sendMessage(env, chat_id, `✅ **Sucesso!** Sua conta do Telegram foi vinculada ao usuário \`${userToLink.username}\` no site.`);
                
            } 
            // CENÁRIO 2: /start sem payload ou com um payload que não é de vínculo
            else {
                const welcomeText = `👋 Olá, ${message.from.first_name}!\n\nEste é o bot auxiliar do Shiroyama Files. Use o site para gerar códigos e gerenciar seus arquivos.`;
                await sendMessage(env, chat_id, welcomeText);
            }
        }
        
        // Se o comando não for /start, podemos adicionar outras lógicas aqui no futuro.
        // Por enquanto, não fazemos nada.

        return new Response('OK', { status: 200 });

    } catch (error) {
        console.error("Erro Crítico no Webhook:", error);
        // Evita enviar mensagens de erro de sistema para o usuário, mas registra o log para o admin.
        return new Response('Erro interno do servidor.', { status: 500 });
    }
}