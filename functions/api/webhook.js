// /functions/api/webhook.js

async function sendMessage(env, chatId, text) { /* ... Cole a função sendMessage completa aqui ... */ }

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const data = await request.json();
        if (!data.message || !data.message.text) return new Response('OK');

        const message = data.message;
        const chat_id = message.chat.id;
        const from_user = message.from;
        const text = message.text;
        
        if (text.startsWith('/start')) {
            const payload = text.split(' ')[1];
            
            if (payload && payload.startsWith('link_')) {
                const findUserStmt = env.DB.prepare('SELECT id, username FROM users WHERE link_code = ?');
                const userToLink = await findUserStmt.bind(payload).first();

                if (!userToLink) {
                    await sendMessage(env, chat_id, '❌ **Código Inválido.** Este código não foi encontrado ou já foi usado. Gere um novo no seu perfil.');
                    return new Response('OK');
                }
                
                const updateUserStmt = env.DB.prepare('UPDATE users SET telegram_chat_id = ?, telegram_username = ?, link_code = NULL WHERE id = ?');
                await updateUserStmt.bind(chat_id, from_user.username, userToLink.id).run();
                
                await sendMessage(env, chat_id, `✅ **Sucesso!** Sua conta do Telegram foi vinculada ao usuário \`${userToLink.username}\`.`);
            } else {
                await sendMessage(env, chat_id, `👋 Olá, ${from_user.first_name}! Use o site para interagir.`);
            }
        }
        return new Response('OK');
    } catch (error) {
        console.error("Erro Crítico no Webhook:", error);
        return new Response('Erro interno do servidor', { status: 500 });
    }
}