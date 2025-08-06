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
    // ... (Esta função está funcionando, vamos mantê-la como está)
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;
        if (!name || typeof level !== 'number' || !Array.isArray(requestedPermissionIds)) {
            return new Response(JSON.stringify({ message: 'Dados inválidos.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const adminLevel = parseInt(loggedInUser.level);
        const newRoleLevel = parseInt(level);
        if (adminLevel >= newRoleLevel) {
            return new Response(JSON.stringify({ message: 'Não é possível criar um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
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
        const roleInsertStmt = db.prepare('INSERT INTO roles (name, level) VALUES (?, ?)').bind(name, newRoleLevel);
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
        // FINGERPRINT: Se este log não aparecer, o deploy não funcionou.
        console.log("--- EXECUTANDO ROLES.JS vDEBUG ---");

        const loggedInUser = data.user;
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;
        
        const roleIdToEdit = parseInt(Array.isArray(params.id) ? params.id[0] : params.id);
        const adminLevel = parseInt(loggedInUser.level);
        const newRoleLevel = parseInt(level);

        console.log(`Dados Recebidos: adminLevel=${adminLevel} (tipo: ${typeof adminLevel}), newRoleLevel=${newRoleLevel} (tipo: ${typeof newRoleLevel})`);

        if (isNaN(roleIdToEdit) || isNaN(adminLevel) || isNaN(newRoleLevel)) {
             return new Response(JSON.stringify({ message: 'Dados inválidos (nível ou ID não é um número).' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToEdit).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        const targetRoleLevel = parseInt(targetRole.level);
        console.log(`Nível do Cargo Alvo: targetRoleLevel=${targetRoleLevel} (tipo: ${typeof targetRoleLevel})`);

        // REGRA 3: Hierarquia - O admin logado não pode editar um cargo que já está em um nível igual ou superior ao seu.
        console.log(`VERIFICANDO REGRA 3: adminLevel (${adminLevel}) >= targetRoleLevel (${targetRoleLevel}) ?`);
        if (adminLevel >= targetRoleLevel) {
            console.log("!!! BLOQUEIO REGRA 3 ATIVADO !!!");
            return new Response(JSON.stringify({ message: 'Não é possível editar um cargo com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        // REGRA 4: Hierarquia - O admin não pode promover um cargo para um nível igual ou superior ao seu.
        console.log(`VERIFICANDO REGRA 4: adminLevel (${adminLevel}) >= newRoleLevel (${newRoleLevel}) ?`);
        if (adminLevel >= newRoleLevel) {
            console.log("!!! BLOQUEIO REGRA 4 ATIVADO !!!");
            return new Response(JSON.stringify({ message: 'Não é possível definir um nível de hierarquia igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        console.log("PASSOU NAS VERIFICAÇÕES DE HIERARQUIA. CONTINUANDO...");

        // ... (O resto da função continua igual, mas com logs adicionais se necessário)
        
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
        console.error("Erro ao atualizar cargo:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao atualizar cargo." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// DELETE /api/admin/roles/[id] -> Deleta um cargo
export async function onRequestDelete(context) {
    const { env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const roleIdToDelete = parseInt(Array.isArray(params.id) ? params.id[0] : params.id);
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
    const { request, params } = context;
    if (params && params.id && params.id.length > 0) {
        switch (request.method) {
            case 'PUT': return onRequestPut(context);
            case 'DELETE': return onRequestDelete(context);
        }
    } else {
        switch (request.method) {
            case 'GET': return onRequestGet(context);
            case 'POST': return onRequestPost(context);
        }
    }
    return new Response('Método não permitido.', { status: 405 });
}