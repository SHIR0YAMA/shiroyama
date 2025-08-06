// /functions/api/admin/roles.js

async function handleGet(context) {
    try {
        const stmt = context.env.DB.prepare(`
            SELECT r.id, r.name, r.level, GROUP_CONCAT(p.name) as permissions
            FROM roles r
            LEFT JOIN role_permissions rp ON r.id = rp.role_id
            LEFT JOIN permissions p ON rp.permission_id = p.id
            GROUP BY r.id ORDER BY r.level ASC, r.name ASC
        `);
        const { results } = await stmt.all();
        results.forEach(role => {
            role.permissions = role.permissions ? role.permissions.split(',') : [];
        });
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error("Erro ao buscar cargos:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao buscar cargos." }), { status: 500 });
    }
}

async function handlePost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;
        if (!name || typeof level !== 'number' || !Array.isArray(requestedPermissionIds)) {
            return new Response(JSON.stringify({ message: 'Dados inválidos.' }), { status: 400 });
        }
        if (loggedInUser.level >= level) {
            return new Response(JSON.stringify({ message: 'Não é possível criar um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403 });
        }
        if (loggedInUser.level > 0) {
            const userPermissionsStmt = db.prepare(`SELECT p.id FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?`).bind(loggedInUser.roleId);
            const { results: userPermissionResults } = await userPermissionsStmt.all();
            const userPermissionIds = userPermissionResults.map(p => p.id);
            for (const permId of requestedPermissionIds) {
                if (!userPermissionIds.includes(permId)) {
                    return new Response(JSON.stringify({ message: `Você não pode conceder a permissão ID ${permId}, pois você não a possui.` }), { status: 403 });
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
        return new Response(JSON.stringify({ success: true, id: newRoleId }), { status: 201 });
    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Um cargo com este nome ou nível de hierarquia já existe.' }), { status: 409 });
        }
        console.error("Erro ao criar cargo:", error);
        return new Response(JSON.stringify({ message: error.message || 'Erro interno' }), { status: 500 });
    }
}

async function handlePut(context) {
    const { request, env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const roleIdToEdit = parseInt(params.id);
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;
        if (isNaN(roleIdToEdit)) {
            return new Response(JSON.stringify({ message: 'ID de cargo inválido.' }), { status: 400 });
        }
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToEdit).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404 });
        }
        const MEMBER_ROLE_LEVEL = 1000;
        if (targetRole.level === MEMBER_ROLE_LEVEL && loggedInUser.level !== 0) {
            return new Response(JSON.stringify({ message: 'O cargo Membro só pode ser editado pelo Dono.' }), { status: 403 });
        }
        if (roleIdToEdit === loggedInUser.roleId) {
            return new Response(JSON.stringify({ message: 'Você não pode editar seu próprio cargo.' }), { status: 403 });
        }
        if (loggedInUser.level >= targetRole.level) {
            return new Response(JSON.stringify({ message: 'Não é possível editar um cargo com hierarquia igual ou superior à sua.' }), { status: 403 });
        }
        if (loggedInUser.level >= level) {
            return new Response(JSON.stringify({ message: 'Não é possível definir um nível de hierarquia igual ou superior ao seu.' }), { status: 403 });
        }
        if (loggedInUser.level > 0) {
            const userPermissionsStmt = db.prepare(`SELECT p.id FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?`).bind(loggedInUser.roleId);
            const { results: userPermissionResults } = await userPermissionsStmt.all();
            const userPermissionIds = userPermissionResults.map(p => p.id);
            for (const permId of requestedPermissionIds) {
                if (!userPermissionIds.includes(parseInt(permId))) {
                    return new Response(JSON.stringify({ message: `Você não pode conceder a permissão ID ${permId}, pois você não a possui.` }), { status: 403 });
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
        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Um cargo com este nome ou nível de hierarquia já existe.' }), { status: 409 });
        }
        console.error("Erro ao atualizar cargo:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao atualizar cargo." }), { status: 500 });
    }
}

async function handleDelete(context) {
    const { env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const roleIdToDelete = parseInt(params.id);
        const db = env.DB;
        if (isNaN(roleIdToDelete)) {
            return new Response(JSON.stringify({ message: 'ID de cargo inválido.' }), { status: 400 });
        }
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToDelete).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404 });
        }
        const MEMBER_ROLE_LEVEL = 1000;
        if (targetRole.level === MEMBER_ROLE_LEVEL && loggedInUser.level !== 0) {
            return new Response(JSON.stringify({ message: 'O cargo Membro só pode ser excluído pelo Dono.' }), { status: 403 });
        }
        if (loggedInUser.level >= targetRole.level) {
            return new Response(JSON.stringify({ message: 'Não é possível excluir um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403 });
        }
        const usersWithRole = await db.prepare('SELECT COUNT(*) as count FROM users WHERE role_id = ?').bind(roleIdToDelete).first('count');
        if (usersWithRole > 0) {
            return new Response(JSON.stringify({ message: 'Não é possível excluir este cargo, pois existem usuários associados a ele.' }), { status: 400 });
        }
        await db.prepare('DELETE FROM roles WHERE id = ?').bind(roleIdToDelete).run();
        await db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleIdToDelete).run();
        return new Response(null, { status: 204 });
    } catch(e) {
        console.error("Erro ao deletar cargo:", e);
        return new Response(JSON.stringify({ message: "Erro interno ao deletar cargo." }), { status: 500 });
    }
}

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(p => p);

    // Verifica se a rota é /api/admin/roles/ seguido de um número (ID)
    const isRouteWithId = pathParts.length === 4 && pathParts[2] === 'roles' && !isNaN(parseInt(pathParts[3]));
    // Verifica se a rota é exatamente /api/admin/roles
    const isRouteWithoutId = pathParts.length === 3 && pathParts[2] === 'roles';

    if (isRouteWithId) {
        // Adiciona o ID aos parâmetros do contexto para as funções handle usarem
        context.params = { id: pathParts[3] }; 

        switch (request.method) {
            case 'PUT':
                return handlePut(context);
            case 'DELETE':
                return handleDelete(context);
            default:
                // Se o método for GET, POST, etc. para uma rota com ID, é um erro
                return new Response(`Método ${request.method} não permitido para a rota com ID.`, { status: 405 });
        }
    } else if (isRouteWithoutId) {
        switch (request.method) {
            case 'GET':
                return handleGet(context);
            case 'POST':
                return handlePost(context);
            default:
                // Se o método for PUT, DELETE, etc. para uma rota sem ID, é um erro
                return new Response(`Método ${request.method} não permitido para a rota sem ID.`, { status: 405 });
        }
    }

    // Se a URL não corresponder a nenhum padrão conhecido
    return new Response('Rota não encontrada.', { status: 404 });
}