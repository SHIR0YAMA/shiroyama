// /functions/api/bulk-forward.js

async function verifyJwt(token, secret) { /* ... cole a mesma função verifyJwt completa do arquivo 1 ... */ }
async function sendMessage(env, chatId, text) { const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`; await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: text }) }); }

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ message: 'Você precisa estar logado.' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);
        
        const stmt = env.DB.prepare('SELECT telegram_chat_id FROM users WHERE id = ?');
        const user = await stmt.bind(payload.userId).first();

        if (!user || !user.telegram_chat_id) {
            return new Response(JSON.stringify({ message: 'Sua conta não está vinculada ao bot do Telegram. Por favor, acesse sua página de perfil para vincular.' }), { status: 400 });
        }
        const user_chat_id = user.telegram_chat_id;

        const { message_ids } = await request.json();
        if (!Array.isArray(message_ids) || message_ids.length === 0) {
            return new Response(JSON.stringify({ message: 'Nenhum arquivo selecionado.' }), { status: 400 });
        }
        
        await sendMessage(env, user_chat_id, `Iniciando o envio de ${message_ids.length} arquivo(s)...`);

        const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/copyMessage`;
        for (const msgId of message_ids) {
            await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: user_chat_id, from_chat_id: env.CHANNEL_ID, message_id: msgId })
            });
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }

        await sendMessage(env, user_chat_id, '✅ Todos os arquivos foram enviados!');
        return new Response(JSON.stringify({ success: true, message: 'Processo de envio iniciado.' }));
    } catch (error) {
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}