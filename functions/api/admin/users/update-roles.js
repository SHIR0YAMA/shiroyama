// /functions/api/admin/users/update-roles.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        // O payload agora espera um array 'newRoleIds'
        const { userId: targetUserId, newRoleIds } = await request.json();
        const db = env.DB;

        if (!loggedInUser.permissions.includes('roles:assign')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para atribuir cargos.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        if (!targetUserId || !Array.isArray(newRoleIds)) {
            return new Response(JSON.stringify({ message: 'Payload inválido. É esperado userId e um array newRoleIds.' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
        }
        
        // --- LÓGICA DE HIERARQUIA ATUALIZADA ---
        // 1. Busca o nível de hierarquia atual do usuário alvo.
        const targetUserRolesStmt = db.prepare(`
            SELECT r.level FROM roles r JOIN user_roles ur ON r.id = ur.role_id 
            WHERE ur.user_id = ? ORDER BY r.level ASC LIMIT 1
        `).bind(targetUserId);
        const targetUser = await targetUserRolesStmt.first();

        if (!targetUser) {
            return new Response(JSON.stringify({ message: 'Usuário alvo não encontrado ou sem cargo.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        
        // 2. Busca os níveis de todos os novos cargos que estão sendo atribuídos.
        const placeholders = newRoleIds.map(() => '?').join(',');
        const newRolesStmt = db.prepare(`SELECT level FROM roles WHERE id IN (${placeholders})`).bind(...newRoleIds);
        const { results: newRoles } = await newRolesStmt.all();

        if (newRoles.length !== newRoleIds.length) {
            return new Response(JSON.stringify({ message: 'Um ou mais cargos de destino são inválidos.' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
        }
        
        const highestNewLevel = Math.min(...newRoles.map(r => r.level));

        // 3. Aplica as regras de hierarquia.
        if (loggedInUser.level >= targetUser.role_level) {
             return new Response(JSON.stringify({ message: 'Não é possível alterar os cargos de um usuário com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (loggedInUser.level >= highestNewLevel) {
            return new Response(JSON.stringify({ message: 'Não é possível atribuir um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        // --- FIM DA LÓGICA DE HIERARQUIA ---

        // Deleta todos os cargos antigos e insere os novos em uma transação
        const deleteStmt = db.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(targetUserId);
        const insertStmts = newRoleIds.map(roleId => 
            db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").bind(targetUserId, roleId)
        );

        await db.batch([deleteStmt, ...insertStmts]);

        // Invalida a sessão do usuário
        await db.prepare("UPDATE users SET token_valid_after = CURRENT_TIMESTAMP WHERE id = ?").bind(targetUserId).run();

        // Log da ação
        const targetUsername = (await db.prepare("SELECT username FROM users WHERE id = ?").bind(targetUserId).first("username")) || "Desconhecido";
        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'update_user_roles', `Usuário: ${targetUsername}, Novos Cargos IDs: ${newRoleIds.join(', ')}`)
            .run();
            
        return new Response(JSON.stringify({ success: true, message: 'Cargos do usuário atualizados.' }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao atualizar cargos do usuário:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao atualizar cargos do usuário." }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}