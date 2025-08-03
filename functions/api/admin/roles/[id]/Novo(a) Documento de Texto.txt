// /functions/api/admin/roles/[id]/index.js

// (Você pode copiar a mesma função verifyJwtAndPermission do arquivo anterior aqui)
async function verifyJwtAndPermission(request, env, requiredPermission) { /* ... Cole a função completa aqui ... */ }


// PUT /api/admin/roles/:id -> Atualiza um cargo
export async function onRequestPut(context) {
    try {
        const payload = await verifyJwtAndPermission(context.request, context.env, 'can_manage_roles');
        const roleId = context.params.id;
        const { name, level, permissions } = await context.request.json();
        const db = context.env.DB;
        
        // Verifica a hierarquia para impedir auto-promoção ou edição de cargos superiores
        const targetRoleStmt = db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleId);
        const targetRole = await targetRoleStmt.first();
        if (!targetRole || payload.role_level >= targetRole.level || (level && payload.role_level >= level)) {
             return new Response(JSON.stringify({ message: 'Hierarquia insuficiente para modificar este cargo.' }), { status: 403 });
        }

        // Transação para atualizar o cargo
        await db.batch([
            db.prepare('UPDATE roles SET name = ?, level = ? WHERE id = ?').bind(name, level, roleId),
            db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleId)
        ]);

        if (permissions.length > 0) {
            const permissionPlaceholders = permissions.map(() => '(?, ?)').join(',');
            const permissionBindings = permissions.reduce((acc, permId) => [...acc, roleId, permId], []);
            await db.prepare(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${permissionPlaceholders}`).bind(...permissionBindings).run();
        }

        return new Response(JSON.stringify({ success: true }));
    } catch (error) {
        return new Response(JSON.stringify({ message: error.message || 'Erro interno' }), { status: error.status || 500 });
    }
}


// DELETE /api/admin/roles/:id -> Exclui um cargo
export async function onRequestDelete(context) {
     try {
        const payload = await verifyJwtAndPermission(context.request, context.env, 'can_manage_roles');
        const roleId = context.params.id;
        const db = context.env.DB;
        
        // Validação de hierarquia
        const targetRoleStmt = db.prepare('SELECT level, name FROM roles WHERE id = ?').bind(roleId);
        const targetRole = await targetRoleStmt.first();
        if (targetRole.name === 'Owner') {
             return new Response(JSON.stringify({ message: 'O cargo "Owner" não pode ser excluído.' }), { status: 403 });
        }
        if (!targetRole || payload.role_level >= targetRole.level) {
             return new Response(JSON.stringify({ message: 'Hierarquia insuficiente para excluir este cargo.' }), { status: 403 });
        }
        
        // Verifica se há usuários com este cargo
        const userCheckStmt = db.prepare('SELECT COUNT(*) as count FROM users WHERE role_id = ?').bind(roleId);
        const { count } = await userCheckStmt.first();
        if (count > 0) {
            return new Response(JSON.stringify({ message: 'Não é possível excluir um cargo que está em uso por usuários.' }), { status: 409 });
        }

        await db.prepare('DELETE FROM roles WHERE id = ?').bind(roleId).run();
        return new Response(null, { status: 204 });

    } catch (error) {
        return new Response(JSON.stringify({ message: error.message || 'Erro interno' }), { status: error.status || 500 });
    }
}