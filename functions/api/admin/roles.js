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
        const userPermissionsStmt = db.prepare(`SELECT p.id FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?`).bind(loggedInUser.roleId);
        const { results: userPermissionResults } = await userPermissionsStmt.all();
        const userPermissionIds = userPermissionResults.map(p => p.id);

        for (const permId of requestedPermissionIds) {
            if (!userPermissionIds.includes(permId)) {
                return new Response(JSON.stringify({ message: `Você não pode conceder a permissão ID ${permId}, pois você não a possui.` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
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
        if (error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Um cargo com este nome ou nível de hierarquia já existe.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        console.error("Erro ao criar cargo:", error);
        return new Response(JSON.stringify({ message: error.message || 'Erro interno' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
        
        // Proteção do cargo Membro (nível 1000) e do próprio cargo
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToEdit).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        const MEMBER_ROLE_LEVEL = 1000;
        if (targetRole.level === MEMBER_ROLE_LEVEL && loggedInUser.role !== 'Dono') {
             return new Response(JSON.stringify({ message: 'O cargo Membro não pode ser editado.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (roleIdToEdit === loggedInUser.roleId) {
             return new Response(JSON.stringify({ message: 'Você não pode editar seu próprio cargo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        if (loggedInUser.level >= level || loggedInUser.level >= targetRole.level) {
             return new Response(JSON.stringify({ message: 'Não é possível editar para um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // Lógica de verificação de permissões (igual à de criação)
        const userPermissionsStmt = db.prepare(`SELECT p.id FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?`).bind(loggedInUser.roleId);
        const { results: userPermissionResults } = await userPermissionsStmt.all();
        const userPermissionIds = userPermissionResults.map(p => p.id);
        for (const permId of requestedPermissionIds) {
            if (!userPermissionIds.includes(permId)) {
                return new Response(JSON.stringify({ message: `Você não pode conceder a permissão ID ${permId}, pois você não a possui.` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
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
         if (error.message.includes('UNIQUE constraint failed')) {
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
        if (targetRole.level === MEMBER_ROLE_LEVEL) {
             return new Response(JSON.stringify({ message: 'O cargo Membro não pode ser excluído.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

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

// Para que PUT e DELETE funcionem, o Cloudflare Pages precisa de uma rota catch-all.
// O arquivo deve se chamar [[id]].js se você quiser usar params.id.
// Se seu arquivo se chama apenas roles.js, você precisa criar handlers separados para cada método.
// A forma mais fácil é ter um único onRequest que verifica context.request.method.
export async function onRequest(context) {
    switch (context.request.method) {
        case 'GET':
            return onRequestGet(context);
        case 'POST':
            return onRequestPost(context);
        case 'PUT':
            // Isso assume que a rota é /api/admin/roles/:id e o arquivo é [[id]].js
            // Se o arquivo for apenas roles.js, você precisará de uma rota separada.
            return onRequestPut(context);
        case 'DELETE':
            return onRequestDelete(context);
        default:
            return new Response('Método não permitido', { status: 405 });
    }
}