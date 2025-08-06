// /functions/api/admin/roles/[[id]].js

async function handlePut(context) {
    const { request, env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;
        
        const roleIdToEdit = parseInt(params.id[0]);
        const adminLevel = parseInt(loggedInUser.level);
        const newRoleLevel = parseInt(level);

        if (isNaN(roleIdToEdit) || isNaN(adminLevel) || isNaN(newRoleLevel)) {
             return new Response(JSON.stringify({ message: 'Dados inválidos (nível ou ID não é um número).' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToEdit).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        const targetRoleLevel = parseInt(targetRole.level);

        const MEMBER_ROLE_LEVEL = 1000;
        if (targetRoleLevel === MEMBER_ROLE_LEVEL && adminLevel !== 0) {
             return new Response(JSON.stringify({ message: 'O cargo Membro só pode ser editado pelo Dono.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (roleIdToEdit === loggedInUser.roleId) {
             return new Response(JSON.stringify({ message: 'Você não pode editar seu próprio cargo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (adminLevel >= targetRoleLevel) {
             return new Response(JSON.stringify({ message: 'Não é possível editar um cargo com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (adminLevel >= newRoleLevel) {
             return new Response(JSON.stringify({ message: 'Não é possível definir um nível de hierarquia igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (adminLevel > 0) {
            const userPermissionsStmt = db.prepare(`SELECT p.id FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?`).bind(loggedInUser.roleId);
            const { results: userPermissionResults } = await userPermissionsStmt.all();
            const userPermissionIds = userPermissionResults.map(p => p.id);
            for (const permId of requestedPermissionIds) {
                if (!userPermissionIds.includes(parseInt(permId))) {
                    return new Response(JSON.stringify({ message: `Você não pode conceder a permissão ID ${permId}, pois você não a possui.` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
                }
            }
        }
        
        await db.batch([
            db.prepare('UPDATE roles SET name = ?, level = ? WHERE id = ?').bind(name, newRoleLevel, roleIdToEdit),
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

async function handleDelete(context) {
    const { env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const roleIdToDelete = parseInt(params.id[0]);
        const db = env.DB;
        
        if (isNaN(roleIdToDelete)) {
             return new Response(JSON.stringify({ message: 'ID de cargo inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToDelete).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        const MEMBER_ROLE_LEVEL = 1000;
        if (targetRole.level === MEMBER_ROLE_LEVEL && loggedInUser.level !== 0) {
             return new Response(JSON.stringify({ message: 'O cargo Membro só pode ser excluído pelo Dono.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (loggedInUser.level >= targetRole.level) {
             return new Response(JSON.stringify({ message: 'Não é possível excluir um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        const usersWithRole = await db.prepare('SELECT COUNT(*) as count FROM users WHERE role_id = ?').bind(roleIdToDelete).first('count');
        if (usersWithRole > 0) {
            return new Response(JSON.stringify({ message: 'Não é possível excluir este cargo, pois existem usuários associados a ele.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        await db.prepare('DELETE FROM roles WHERE id = ?').bind(roleIdToDelete).run();
        await db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleIdToDelete).run();
        return new Response(null, { status: 204 });
    } catch(e) {
        console.error("Erro ao deletar cargo:", e);
        return new Response(JSON.stringify({ message: "Erro interno ao deletar cargo." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

export async function onRequest(context) {
    switch (context.request.method) {
        case 'PUT': return handlePut(context);
        case 'DELETE': return handleDelete(context);
        default:
            return new Response(JSON.stringify({ message: 'Método não permitido.' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }
}