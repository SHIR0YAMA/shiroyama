// /functions/api/admin/roles.js

// GET /api/admin/roles -> Lista todos os cargos
export async function onRequestGet(context) {
    try {
        // O _middleware.js já verificou a permissão 'can_manage_roles'
        const stmt = context.env.DB.prepare(`
            SELECT r.id, r.name, r.level, GROUP_CONCAT(p.name) as permissions
            FROM roles r
            LEFT JOIN role_permissions rp ON r.id = rp.role_id
            LEFT JOIN permissions p ON rp.permission_id = p.id
            GROUP BY r.id
            ORDER BY r.level ASC
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

// POST /api/admin/roles -> Cria um novo cargo
export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        // O _middleware.js já verificou a permissão 'can_manage_roles'
        const loggedInUser = data.user;
        const { name, level, permissions } = await request.json();
        const db = env.DB;

        if (!name || typeof level !== 'number' || !Array.isArray(permissions)) {
            return new Response(JSON.stringify({ message: 'Dados inválidos.' }), { status: 400 });
        }
        
        // Verifica se o usuário tentando criar tem um nível hierárquico menor (mais poder)
        if (loggedInUser.level >= level) {
            return new Response(JSON.stringify({ message: 'Não é possível criar um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403 });
        }

        const roleInsertStmt = db.prepare('INSERT INTO roles (name, level) VALUES (?, ?)').bind(name, level);
        const { meta } = await roleInsertStmt.run();
        const newRoleId = meta.last_row_id;
        
        if (permissions.length > 0) {
            const permissionStmts = permissions.map(permId => 
                db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').bind(newRoleId, permId)
            );
            await db.batch(permissionStmts);
        }
        
        return new Response(JSON.stringify({ success: true, id: newRoleId }), { status: 201 });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Um cargo com este nome ou nível de hierarquia já existe.' }), { status: 409 });
        }
        console.error("Erro ao criar cargo:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao criar cargo." }), { status: 500 });
    }
}

// PUT /api/admin/roles/[id] -> Atualiza um cargo
export async function onRequestPut(context) {
    const { request, env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const roleId = parseInt(params.id);
        const { name, level, permissions } = await request.json();
        const db = env.DB;

        if (loggedInUser.level >= level) {
             return new Response(JSON.stringify({ message: 'Não é possível editar para um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403 });
        }

        await db.batch([
            db.prepare('UPDATE roles SET name = ?, level = ? WHERE id = ?').bind(name, level, roleId),
            db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleId)
        ]);

        if (permissions.length > 0) {
            const permissionStmts = permissions.map(permId =>
                db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').bind(roleId, permId)
            );
            await db.batch(permissionStmts);
        }

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (error) {
         if (error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Um cargo com este nome ou nível de hierarquia já existe.' }), { status: 409 });
        }
        console.error("Erro ao atualizar cargo:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao atualizar cargo." }), { status: 500 });
    }
}

// DELETE /api/admin/roles/[id] -> Deleta um cargo
export async function onRequestDelete(context) {
    const { env, params } = context;
    try {
        const roleId = parseInt(params.id);
        
        const usersWithRole = await env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE role_id = ?').bind(roleId).first('count');

        if (usersWithRole > 0) {
            return new Response(JSON.stringify({ message: 'Não é possível excluir este cargo, pois existem usuários associados a ele.' }), { status: 400 });
        }

        await env.DB.prepare('DELETE FROM roles WHERE id = ?').bind(roleId).run();

        return new Response(null, { status: 204 });
    } catch(e) {
        console.error("Erro ao deletar cargo:", e);
        return new Response(JSON.stringify({ message: "Erro interno ao deletar cargo." }), { status: 500 });
    }
}