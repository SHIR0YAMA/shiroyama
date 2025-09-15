// /functions/api/admin/delete-user.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { userId: targetUserId } = await request.json();
        const db = env.DB;

        if (!loggedInUser.permissions.includes('users:delete')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão: users:delete' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        if (typeof targetUserId !== 'number') {
            return new Response(JSON.stringify({ message: 'ID de usuário inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        if (loggedInUser.userId === targetUserId) {
            return new Response(JSON.stringify({ message: 'Você não pode deletar sua própria conta.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // CORREÇÃO: Busca o nível do cargo do usuário alvo a partir da tabela user_roles
        const targetUserStmt = db.prepare(`
            SELECT u.id, u.username, MIN(r.level) as role_level 
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            WHERE u.id = ?
            GROUP BY u.id
        `).bind(targetUserId);
        const targetUser = await targetUserStmt.first();

        if (!targetUser) {
            return new Response(JSON.stringify({ message: 'Usuário alvo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        if (loggedInUser.level >= targetUser.role_level) {
            return new Response(JSON.stringify({ message: 'Não é possível excluir um usuário com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // A chave estrangeira com ON DELETE CASCADE cuidará de limpar a tabela user_roles
        const stmt = env.DB.prepare('DELETE FROM users WHERE id = ?');
        await stmt.bind(targetUserId).run();

        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'delete_user', `Usuário: ${targetUser.username} (ID: ${targetUserId})`)
            .run();

        return new Response(JSON.stringify({ success: true, message: 'Usuário deletado com sucesso!' }));

    } catch (error) {
        console.error("Erro ao deletar usuário:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao deletar usuário." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}