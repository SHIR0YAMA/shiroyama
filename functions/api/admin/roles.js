// /functions/api/admin/roles.js

// GET /api/admin/roles -> Lista todos os cargos e suas permissões
export async function onRequestGet(context) {
    try {
        const stmt = context.env.DB.prepare(`
            SELECT r.id, r.name, r.level, GROUP_CONCAT(p.name) as permissions
            FROM roles r
            LEFT JOIN role_permissions rp ON r.id = rp.role_id
            LEFT JOIN permissions p ON rp.permission_id = p.id
            GROUP BY r.id
            ORDER BY r.level ASC, r.name ASC
        `);
        const { results } = await stmt.all();

        results.forEach(role => {
            role.permissions = role.permissions ? role.permissions.split(',') : [];
        });

        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error("Erro ao buscar cargos:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao buscar cargos." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// POST /api/admin/roles -> Cria um novo cargo
export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;

        if (!name || typeof level !== 'number' || !Array.isArray(requestedPermissionIds)) {
            return new Response(JSON.stringify({ message: 'Dados inválidos.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // 1. Nível de hierarquia: não pode criar cargo com nível igual ou superior (menor número)
        if (loggedInUser.level >= level) {
            return new Response(JSON.stringify({ message: 'Não é possível criar um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        // 2. Permissões: não pode conceder permissões que não possui
        // Esta verificação só roda para admins que não são o Dono.
        if (loggedInUser.level > 0) { // Se o nível é 0 (Dono), ele pode conceder qualquer permissão
            const userPermissionsStmt = db.prepare(`SELECT p.id FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?`).bind(loggedInUser.roleId);
            const { results: userPermissionResults } = await userPermissionsStmt.all();
            const userPermissionIds = userPermissionResults.map(p => p.id);

            for (const permId of requestedPermissionIds) {
                if (!userPermissionIds.includes(permId)) {
                    return new Response(JSON.stringify({ message: `Você não pode conceder a permissão ID ${permId}, pois você não a possui.` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
                }
            }
        }
        
        const roleInsertStmt = db.prepare('INSERT INTO roles (name, level) VALUES (?, ?)').bind(name, level);
        const { meta } = await roleInsertStmt.run();
        const newRoleId = meta.last_row_id;
        
        if (requestedPermissionIds.length > 0) {
            const permissionStmts = requestedPermissionIds.map(permId => 
                db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').bind(newRoleId, permId)
            );
            await db.batch(permissionStmts);
        }
        
        return new Response(JSON.stringify({ success: true, id: newRoleId }), { status: 201, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Um cargo com este nome ou nível de hierarquia já existe.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        console.error("Erro ao criar cargo:", error);
        return new Response(JSON.stringify({ message: error ? error.message : 'Erro interno' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// PUT /api/admin/roles/[id] -> Atualiza um cargo
export async function onRequestPut(context) {
    const { request, env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const roleIdToEdit = parseInt(params.id);
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;

        if (isNaN(roleIdToEdit)) {
             return new Response(JSON.stringify({ message: 'ID de cargo inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToEdit).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const MEMBER_ROLE_LEVEL = 1000;
        // Proteção do cargo Membro: só Dono (nível 0) pode editar
        if (targetRole.level === MEMBER_ROLE_LEVEL && loggedInUser.level !== 0) { // Alterado para checkar level 0
             return new Response(JSON.stringify({ message: 'O cargo Membro só pode ser editado pelo Dono.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        // Proteção: usuário não pode editar seu próprio cargo (por ID)
        if (roleIdToEdit === loggedInUser.roleId) {
             return new Response(JSON.stringify({ message: 'Você não pode editar seu próprio cargo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // Proteção de Hierarquia: não pode editar para um nível igual ou superior ao seu
        // ou editar um cargo que já tem um nível igual ou superior ao seu
        if (loggedInUser.level >= level || loggedInUser.level >= targetRole.level) {
             return new Response(JSON.stringify({ message: 'Não é possível editar para um cargo com nível hierárquico igual ou superior ao seu, ou editar um cargo de nível igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // Proteção de Permissões: não pode conceder permissões que não possui
        if (loggedInUser.level > 0) { // Se o nível é 0 (Dono), ele pode conceder qualquer permissão
            const userPermissionsStmt = db.prepare(`SELECT p.id FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?`).bind(loggedInUser.roleId);
            const { results: userPermissionResults } = await userPermissionsStmt.all();
            const userPermissionIds = userPermissionResults.map(p => p.id);
            for (const permId of requestedPermissionIds) {
                if (!userPermissionIds.includes(permId)) {
                    return new Response(JSON.stringify({ message: `Você não pode conceder a permissão ID ${permId}, pois você não a possui.` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
                }
            }
        }

        await db.batch([
            db.prepare('UPDATE roles SET name = ?, level = ? WHERE id = ?').bind(name, level, roleIdToEdit),
            db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleIdToEdit)
        ]);

        if (requestedPermissionIds.length > 0) {
            const permissionStmts = requestedPermissionIds.map(permId =>
                db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').bind(roleIdToEdit, permId)
            );
            await db.batch(permissionStmts);
        }

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
         if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Um cargo com este nome ou nível de hierarquia já existe.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        console.error("Erro ao atualizar cargo:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao atualizar cargo." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// DELETE /api/admin/roles/[id] -> Deleta um cargo
export async function onRequestDelete(context) {
    const { env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const roleIdToDelete = parseInt(params.id);
        const db = env.DB;
        
        if (isNaN(roleIdToDelete)) {
             return new Response(JSON.stringify({ message: 'ID de cargo inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToDelete).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const MEMBER_ROLE_LEVEL = 1000;
        // Proteção do cargo Membro: só Dono (nível 0) pode deletar
        if (targetRole.level === MEMBER_ROLE_LEVEL && loggedInUser.level !== 0) { // Alterado para checkar level 0
             return new Response(JSON.stringify({ message: 'O cargo Membro só pode ser excluído pelo Dono.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // Proteção de Hierarquia: não pode excluir um cargo que tem nível igual ou superior ao seu
        if (loggedInUser.level >= targetRole.level) {
             return new Response(JSON.stringify({ message: 'Não é possível excluir um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        const usersWithRole = await db.prepare('SELECT COUNT(*) as count FROM users WHERE role_id = ?').bind(roleIdToDelete).first('count');
        if (usersWithRole > 0) {
            return new Response(JSON.stringify({ message: 'Não é possível excluir este cargo, pois existem usuários associados a ele.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        await db.prepare('DELETE FROM roles WHERE id = ?').bind(roleIdToDelete).run();

        return new Response(null, { status: 204 });
    } catch(e) {
        console.error("Erro ao deletar cargo:", e);
        return new Response(JSON.stringify({ message: "Erro interno ao deletar cargo." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

export async function onRequest(context) {
    const { request, params } = context;

    if (params && params.id) { // Assume que a rota é /api/admin/roles/:id
        switch (request.method) {
            case 'PUT':
                return onRequestPut(context);
            case 'DELETE':
                return onRequestDelete(context);
            default:
                return new Response('Método não permitido para esta rota com ID.', { status: 405, headers: { 'Content-Type': 'application/json' } });
        }
    } else { // Assume que a rota é /api/admin/roles (sem ID)
        switch (request.method) {
            case 'GET':
                return onRequestGet(context);
            case 'POST':
                return onRequestPost(context);
            default:
                return new Response('Método não permitido para esta rota sem ID.', { status: 405, headers: { 'Content-Type': 'application/json' } });
        }
    }
}