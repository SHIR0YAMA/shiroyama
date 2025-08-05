// /functions/api/admin/delete-user.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { userId: targetUserId } = await request.json();
        const db = env.DB;

        // O _middleware já garante que o usuário tem 'can_manage_users'
        
        if (typeof targetUserId !== 'number') {
            return new Response(JSON.stringify({ message: 'ID de usuário inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        if (loggedInUser.userId === targetUserId) {
            return new Response(JSON.stringify({ message: 'Você não pode deletar sua própria conta.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // --- CORREÇÃO CRÍTICA DE HIERARQUIA ---
        // Busca o nível do cargo do usuário alvo para comparação
        const targetUser = await db.prepare("SELECT r.level as role_level FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?").bind(targetUserId).first();

        if (!targetUser) {
            return new Response(JSON.stringify({ message: 'Usuário alvo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // Ação só é permitida se o nível do admin logado for MENOR (mais poder) que o do alvo
        if (loggedInUser.level >= targetUser.role_level) {
            return new Response(JSON.stringify({ message: 'Não é possível excluir um usuário com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        // --- FIM DA CORREÇÃO ---

        const stmt = env.DB.prepare('DELETE FROM users WHERE id = ?');
        const info = await stmt.bind(targetUserId).run();

        if (info.changes === 0) {
            // Isso não deve acontecer por causa da verificação acima, mas é uma segurança extra.
            return new Response(JSON.stringify({ message: 'Usuário não encontrado para exclusão.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // Log da ação
        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'delete_user', `Usuário ID: ${targetUserId}`)
            .run();

        return new Response(JSON.stringify({ success: true, message: 'Usuário deletado com sucesso!' }));

    } catch (error) {
        console.error("Erro ao deletar usuário:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao deletar usuário." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}