// /functions/api/admin/[[roles]].js

async function handleGet(context) {
    console.log("[[roles]].js - handleGet: Iniciando busca de cargos.");
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
        console.log("[[roles]].js - handleGet: Busca concluída com sucesso.");
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
        console.error("[[roles]].js - handleGet: ERRO:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao buscar cargos." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

async function handlePost(context) {
    console.log("[[roles]].js - handlePost: Iniciando criação de cargo.");
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;

        console.log(`[handlePost DADOS] Admin: ${JSON.stringify(loggedInUser)}, Novo Cargo: { nome: ${name}, nivel: ${level} }`);

        if (!name || typeof level !== 'number' || !Array.isArray(requestedPermissionIds)) {
            return new Response(JSON.stringify({ message: 'Dados inválidos.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const adminLevel = parseInt(loggedInUser.level);
        const newRoleLevel = parseInt(level);

        console.log(`[handlePost CHECK] Verificando hierarquia: adminLevel (${adminLevel}) >= newRoleLevel (${newRoleLevel})?`);
        if (adminLevel >= newRoleLevel) {
            console.log("[[roles]].js - handlePost: BLOQUEIO por hierarquia.");
            return new Response(JSON.stringify({ message: 'Não é possível criar um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        if (adminLevel > 0) {
            console.log("[handlePost CHECK] Verificando permissões do admin...");
            const userPermissionsStmt = db.prepare(`SELECT p.id FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?`).bind(loggedInUser.roleId);
            const { results: userPermissionResults } = await userPermissionsStmt.all();
            const userPermissionIds = userPermissionResults.map(p => p.id);

            for (const permId of requestedPermissionIds) {
                if (!userPermissionIds.includes(parseInt(permId))) {
                    console.log(`[[roles]].js - handlePost: BLOQUEIO por falta de permissão (ID: ${permId}).`);
                    return new Response(JSON.stringify({ message: `Você não pode conceder a permissão ID ${permId}, pois você não a possui.` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
                }
            }
        }
        
        console.log("[[roles]].js - handlePost: Todas as verificações passaram. Inserindo no banco.");
        const roleInsertStmt = db.prepare('INSERT INTO roles (name, level) VALUES (?, ?)').bind(name, newRoleLevel);
        const { meta } = await roleInsertStmt.run();
        const newRoleId = meta.last_row_id;
        
        if (requestedPermissionIds.length > 0) {
            const permissionStmts = requestedPermissionIds.map(permId => 
                db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').bind(newRoleId, permId)
            );
            await db.batch(permissionStmts);
        }
        
        console.log(`[[roles]].js - handlePost: Cargo criado com sucesso (ID: ${newRoleId}).`);
        return new Response(JSON.stringify({ success: true, id: newRoleId }), { status: 201, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Um cargo com este nome ou nível de hierarquia já existe.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        console.error("[[roles]].js - handlePost: ERRO:", error);
        return new Response(JSON.stringify({ message: error ? error.message : 'Erro interno' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

async function handlePut(context) {
    console.log("[[roles]].js - handlePut: Iniciando atualização de cargo.");
    const { request, env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;
        
        const roleIdToEdit = parseInt(Array.isArray(params.id) ? params.id[0] : params.id);
        const adminLevel = parseInt(loggedInUser.level);
        const newRoleLevel = parseInt(level);

        console.log(`[handlePut DADOS] Admin: ${JSON.stringify(loggedInUser)}`);
        console.log(`[handlePut DADOS] Editando ID: ${roleIdToEdit}, Novo Nível: ${newRoleLevel}`);

        if (isNaN(roleIdToEdit) || isNaN(adminLevel) || isNaN(newRoleLevel)) {
             return new Response(JSON.stringify({ message: 'Dados inválidos (nível ou ID não é um número).' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToEdit).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        const targetRoleLevel = parseInt(targetRole.level);
        console.log(`[handlePut DADOS] Nível do Cargo Alvo: ${targetRoleLevel}`);

        const MEMBER_ROLE_LEVEL = 1000;
        if (targetRoleLevel === MEMBER_ROLE_LEVEL && adminLevel !== 0) {
            console.log("[[roles]].js - handlePut: BLOQUEIO - Tentativa de editar cargo Membro por não-Dono.");
            return new Response(JSON.stringify({ message: 'O cargo Membro só pode ser editado pelo Dono.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        if (roleIdToEdit === loggedInUser.roleId) {
            console.log("[[roles]].js - handlePut: BLOQUEIO - Tentativa de auto-edição de cargo.");
            return new Response(JSON.stringify({ message: 'Você não pode editar seu próprio cargo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        console.log(`[handlePut CHECK] Hierarquia: adminLevel (${adminLevel}) >= targetRoleLevel (${targetRoleLevel})? Resultado: ${adminLevel >= targetRoleLevel}`);
        if (adminLevel >= targetRoleLevel) {
            console.log("[[roles]].js - handlePut: BLOQUEIO por hierarquia (editar cargo superior).");
            return new Response(JSON.stringify({ message: 'Não é possível editar um cargo com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        console.log(`[handlePut CHECK] Promoção: adminLevel (${adminLevel}) >= newRoleLevel (${newRoleLevel})? Resultado: ${adminLevel >= newRoleLevel}`);
        if (adminLevel >= newRoleLevel) {
            console.log("[[roles]].js - handlePut: BLOQUEIO por hierarquia (promover para nível superior).");
            return new Response(JSON.stringify({ message: 'Não é possível definir um nível de hierarquia igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        console.log(`[handlePut CHECK] Permissões: adminLevel (${adminLevel}) > 0? Resultado: ${adminLevel > 0}`);
        if (adminLevel > 0) {
            const userPermissionsStmt = db.prepare(`SELECT p.id FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?`).bind(loggedInUser.roleId);
            const { results: userPermissionResults } = await userPermissionsStmt.all();
            const userPermissionIds = userPermissionResults.map(p => p.id);
            console.log(`[handlePut DADOS] Permissões do Admin (IDs): [${userPermissionIds.join(', ')}]`);
            console.log(`[handlePut DADOS] Permissões Requisitadas (IDs): [${requestedPermissionIds.join(', ')}]`);
            
            for (const permId of requestedPermissionIds) {
                const pId = parseInt(permId);
                console.log(`[handlePut CHECK] Admin possui permissão ${pId}? Resultado: ${userPermissionIds.includes(pId)}`);
                if (!userPermissionIds.includes(pId)) {
                    console.log(`[[roles]].js - handlePut: BLOQUEIO por falta de permissão (ID: ${pId}).`);
                    return new Response(JSON.stringify({ message: `Você não pode conceder a permissão ID ${pId}, pois você não a possui.` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
                }
            }
        }
        
        console.log("[[roles]].js - handlePut: Todas as verificações passaram. Atualizando banco.");
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
        console.log(`[[roles]].js - handlePut: Cargo ID ${roleIdToEdit} atualizado com sucesso.`);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
         if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Um cargo com este nome ou nível de hierarquia já existe.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        console.error("[[roles]].js - handlePut: ERRO:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao atualizar cargo." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

async function handleDelete(context) {
    console.log("[[roles]].js - handleDelete: Iniciando exclusão de cargo.");
    const { env, data, params } = context;
    try {
        const loggedInUser = data.user;
        const roleIdToDelete = parseInt(Array.isArray(params.id) ? params.id[0] : params.id);
        const db = env.DB;
        
        console.log(`[handleDelete DADOS] Admin: ${JSON.stringify(loggedInUser)}, Tentando deletar ID: ${roleIdToDelete}`);

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
        console.error("[[roles]].js - handleDelete: ERRO:", e);
        return new Response(JSON.stringify({ message: "Erro interno ao deletar cargo." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

export async function onRequest(context) {
    const { request, params } = context;
    const pathSegments = params.roles || [];

    if (pathSegments[0] !== 'roles') {
        return new Response('Rota não encontrada', { status: 404 });
    }

    const hasId = pathSegments.length > 1;

    if (hasId) {
        context.params.id = pathSegments[1];
        switch (request.method) {
            case 'PUT': return handlePut(context);
            case 'DELETE': return handleDelete(context);
            default: return new Response('Método não permitido para rota com ID.', { status: 405 });
        }
    } else {
        switch (request.method) {
            case 'GET': return handleGet(context);
            case 'POST': return handlePost(context);
            default: return new Response('Método não permitido para rota sem ID.', { status: 405 });
        }
    }
}