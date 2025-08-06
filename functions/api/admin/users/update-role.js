// /functions/api/admin/users/update-role.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { userId: targetUserId, newRoleId } = await request.json();
        const db = env.DB;

        // --- CORREÇÃO AQUI ---
        // A permissão correta para atribuir cargos é 'roles:assign'
        if (!loggedInUser.permissions.includes('roles:assign')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para atribuir cargos.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        const targetUserStmt = db.prepare("SELECT u.username, r.level as role_level FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?").bind(targetUserId);
        const newRoleStmt = db.prepare("SELECT level FROM roles WHERE id = ?").bind(newRoleId);
        
        const [targetUser, newRole] = await Promise.all([targetUserStmt.first(), newRoleStmt.first()]);

        if (!targetUser) {
            return new Response(JSON.stringify({ message: 'Usuário alvo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        if (!newRole) {
            return new Response(JSON.stringify({ message: 'Cargo de destino não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // Regras de Hierarquia
        if (loggedInUser.level >= targetUser.role_level) {
             return new Response(JSON.stringify({ message: 'Não é possível alterar o cargo de um usuário com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (loggedInUser.level >= newRole.level) {
             return new Response(JSON.stringify({ message: 'Não é possível promover um usuário para um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        await db.prepare("UPDATE users SET role_id = ? WHERE id = ?").bind(newRoleId, targetUserId).run();

        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'update_user_role', `Usuário: ${targetUser.username}, Novo Cargo ID: ${newRoleId}`)
            .run();
            
        return new Response(JSON.stringify({ success: true, message: 'Cargo do usuário atualizado.' }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao atualizar cargo do usuário:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao atualizar cargo do usuário." }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}