// /functions/api/webhook.js

async function sendMessage(env, chatId, text) {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' }),
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const data = await request.json();

        if (!data.message || !data.message.text) {
            return new Response('OK', { status: 200 });
        }

        const message = data.message;
        const chat_id = message.chat.id;
        const from_user = message.from; // Pegamos o objeto 'from' completo
        const text = message.text;
        
        if (text.startsWith('/start')) {
            const payload = text.split(' ')[1];

            if (payload && payload.startsWith('link_')) {
                const findUserStmt = env.DB.prepare('SELECT id, username FROM users WHERE link_code = ?');
                const userToLink = await findUserStmt.bind(payload).first();

                if (!userToLink) {
                    await sendMessage(env, chat_id, '❌ **Código Inválido.** Este código de vínculo não foi encontrado. Por favor, gere um novo no seu perfil.');
                    return new Response('OK', { status: 200 });
                }

                const checkExistingLinkStmt = env.DB.prepare('SELECT id, username FROM users WHERE telegram_chat_id = ?');
                const existingUser = await checkExistingLinkStmt.bind(chat_id).first();

                if (existingUser && existingUser.id !== userToLink.id) {
                    await sendMessage(env, chat_id, `❌ **Conta já Vinculada.** Esta conta do Telegram já está associada ao usuário \`${existingUser.username}\`. Desvincule primeiro, se necessário.`);
                    return new Response('OK', { status: 200 });
                }
                
                // ALTERAÇÃO AQUI: Agora salvamos o chat_id E o telegram_username.
                const updateUserStmt = env.DB.prepare(
                    'UPDATE users SET telegram_chat_id = ?, telegram_username = ?, link_code = NULL WHERE id = ?'
                );
                await updateUserStmt.bind(chat_id, from_user.username, userToLink.id).run(); // Adicionamos from_user.username
                
                await sendMessage(env, chat_id, `✅ **Sucesso!** Sua conta do Telegram (@${from_user.username || '?'}) foi vinculada ao usuário \`${userToLink.username}\` no site.`);
            } 
            else {
                const welcomeText = `👋 Olá, ${message.from.first_name}!\n\nEste é o bot auxiliar do Shiroyama Files. Use o site para gerar códigos e gerenciar seus arquivos.`;
                await sendMessage(env, chat_id, welcomeText);
            }
        }
        
        return new Response('OK', { status: 200 });

    } catch (error) {
        console.error("Erro Crítico no Webhook:", error);
        return new Response('Erro interno do servidor.', { status: 500 });
    }
}