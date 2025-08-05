// /functions/api/admin/unlink-user-telegram.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { userId: targetUserId } = await request.json();
        const db = env.DB;

        if (!loggedInUser.permissions.includes('can_manage_users')) {
            return new Response(JSON.stringify({ message: 'Acesso negado: Requer permissão para gerenciar usuários.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        const targetUser = await db.prepare("SELECT u.id, u.username, r.level as role_level FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?").bind(targetUserId).first();

        if (!targetUser) {
            return new Response(JSON.stringify({ message: 'Usuário alvo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // Regra de Hierarquia
        if (loggedInUser.level >= targetUser.role_level) {
            return new Response(JSON.stringify({ message: 'Não é possível desvincular o Telegram de um usuário com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        await db.prepare("UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL WHERE id = ?").bind(targetUserId).run();

        // Log da ação
        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'unlink_telegram', `Usuário: ${targetUser.username} (ID: ${targetUserId})`)
            .run();

        return new Response(JSON.stringify({ success: true, message: 'Conta do Telegram desvinculada com sucesso.' }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao desvincular Telegram:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao desvincular conta do Telegram." }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}