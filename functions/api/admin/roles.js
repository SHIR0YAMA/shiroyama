// /functions/api/admin/roles.js

// --- INÍCIO DAS FUNÇÕES HANDLER ---

async function handleGet(context) {
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

async function handlePost(context) {
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

async function handlePut(context) {
    const { request, env, data, params } = context;
    try {
        console.log("--- EXECUTANDO handlePut EM ROLES.JS - vROTEADOR-INTERNO ---");

        const loggedInUser = data.user;
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;
        
        const roleIdToEdit = parseInt(params.id);
        const adminLevel = parseInt(loggedInUser.level);
        const newRoleLevel = parseInt(level);

        console.log(`[DADOS] Admin Logado: ${JSON.stringify(loggedInUser)}`);
        console.log(`[DADOS] Editando ID: ${roleIdToEdit}, Novo Nível: ${newRoleLevel}`);

        if (isNaN(roleIdToEdit) || isNaN(adminLevel) || isNaN(newRoleLevel)) {
             return new Response(JSON.stringify({ message: 'Dados inválidos (nível ou ID não é um número).' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToEdit).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        const targetRoleLevel = parseInt(targetRole.level);
        console.log(`[DADOS] Nível do Cargo Alvo: ${targetRoleLevel}`);

        console.log(`[VERIFICANDO REGRA 3] Hierarquia: adminLevel (${adminLevel}) >= targetRoleLevel (${targetRoleLevel})? Resultado: ${adminLevel >= targetRoleLevel}`);
        if (adminLevel >= targetRoleLevel) {
            console.log("!!! BLOQUEIO: REGRA 3 ATIVADA (editar cargo superior) !!!");
            return new Response(JSON.stringify({ message: 'Não é possível editar um cargo com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        console.log(`[VERIFICANDO REGRA 4] Promoção: adminLevel (${adminLevel}) >= newRoleLevel (${newRoleLevel})? Resultado: ${adminLevel >= newRoleLevel}`);
        if (adminLevel >= newRoleLevel) {
            console.log("!!! BLOQUEIO: REGRA 4 ATIVADA (promover para nível superior) !!!");
            return new Response(JSON.stringify({ message: 'Não é possível definir um nível de hierarquia igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        // Regra de Permissões
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

// --- ROTEADOR PRINCIPAL ---
export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const basePath = '/api/admin/roles';
    const path = url.pathname;
    
    console.log(`[ROLES.JS ROTEADOR] Rota recebida: ${path}`);
    
    // Expressão regular para capturar o ID numérico no final da URL
    const idMatch = path.match(new RegExp(`^${basePath}/(\\d+)$`));

    if (idMatch) {
        const id = idMatch[1];
        // Adiciona o ID aos parâmetros do contexto para as funções handler usarem
        context.params = { ...context.params, id: id };
        console.log(`[ROLES.JS ROTEADOR] ID detectado: ${id}. Método: ${request.method}`);
        
        switch (request.method) {
            case 'PUT':
                return handlePut(context);
            case 'DELETE':
                return handleDelete(context);
            default:
                return new Response('Método não permitido para rota com ID.', { status: 405 });
        }
    } else if (path === basePath) {
        console.log(`[ROLES.JS ROTEADOR] Rota base detectada. Método: ${request.method}`);
        switch (request.method) {
            case 'GET':
                return handleGet(context);
            case 'POST':
                return handlePost(context);
            default:
                return new Response('Método não permitido para rota sem ID.', { status: 405 });
        }
    }

    // Se a URL for algo como /api/admin/roles/alguma/outra/coisa, retorna 404
    return new Response('Rota de cargos não encontrada.', { status: 404 });
}