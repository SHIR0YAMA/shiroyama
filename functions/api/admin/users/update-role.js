// /functions/api/admin/users/update-role.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { userId: targetUserId, newRoleId } = await request.json();
        const db = env.DB;

        if (!loggedInUser.permissions.includes('can_manage_roles')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para gerenciar cargos.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
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
        // 1. Não pode agir sobre alguém de nível igual ou superior.
        // 2. Não pode promover alguém para um nível igual ou superior ao seu.
        if (loggedInUser.level >= targetUser.role_level || loggedInUser.level >= newRole.level) {
             return new Response(JSON.stringify({ message: 'Não é possível alterar o cargo para um nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        // CORREÇÃO: A proteção específica do cargo "Membro" foi removida daqui.
        // A regra de hierarquia acima já é suficiente. Se um admin tem nível < 1000, ele pode
        // alterar o cargo de um Membro para outro cargo de nível < que o seu.

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