// /functions/api/admin/users/update-role.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { userId: targetUserId, newRoleId } = await request.json();
        const db = env.DB;

        // 1. O admin deve ter a permissão de gerenciar cargos para fazer isso.
        if (!loggedInUser.permissions.includes('can_manage_roles')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para gerenciar cargos.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        // 2. Buscar informações do usuário alvo e do novo cargo para verificar a hierarquia.
        const targetUserStmt = db.prepare("SELECT r.level as role_level FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?").bind(targetUserId);
        const newRoleStmt = db.prepare("SELECT level FROM roles WHERE id = ?").bind(newRoleId);
        
        const [targetUser, newRole] = await Promise.all([targetUserStmt.first(), newRoleStmt.first()]);

        if (!targetUser) {
            return new Response(JSON.stringify({ message: 'Usuário alvo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        if (!newRole) {
            return new Response(JSON.stringify({ message: 'Cargo de destino não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // 3. Regras de Hierarquia
        // - Não pode agir sobre alguém de nível igual ou superior.
        // - Não pode promover alguém para um nível igual ou superior ao seu.
        if (loggedInUser.level >= targetUser.role_level || loggedInUser.level >= newRole.level) {
             return new Response(JSON.stringify({ message: 'Não é possível alterar o cargo para um nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        // 4. Proteção do cargo Membro (nível 1000)
        const MEMBER_ROLE_LEVEL = 1000;
        if (targetUser.role_level === MEMBER_ROLE_LEVEL && loggedInUser.level !== 0) {
            return new Response(JSON.stringify({ message: 'Apenas o Dono pode alterar o cargo de um Membro.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        // Se todas as verificações passaram, atualiza o cargo do usuário.
        await db.prepare("UPDATE users SET role_id = ? WHERE id = ?").bind(newRoleId, targetUserId).run();

        // Log da ação
        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'update_user_role', `Usuário ID: ${targetUserId}, Novo Cargo ID: ${newRoleId}`)
            .run();
            
        return new Response(JSON.stringify({ success: true, message: 'Cargo do usuário atualizado.' }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao atualizar cargo do usuário:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao atualizar cargo do usuário." }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}