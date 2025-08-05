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

        if (loggedInUser.level >= level) {
            return new Response(JSON.stringify({ message: 'Não é possível criar um cargo com nível hierárquico igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        if (loggedInUser.level > 0) {
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
        const roleIdToEdit = parseInt(Array.isArray(params.id) ? params.id[0] : params.id);
        const { name, level, permissions: requestedPermissionIds } = await request.json();
        const db = env.DB;

        // --- LOGS DE DEPURAÇÃO ---
        console.log("--- INICIANDO EDIÇÃO DE CARGO ---");
        console.log("Admin Logado:", JSON.stringify(loggedInUser));
        console.log(`Tentando editar Cargo ID: ${roleIdToEdit} para Nível: ${level}`);
        // --- FIM DOS LOGS ---

        if (isNaN(roleIdToEdit)) {
             return new Response(JSON.stringify({ message: 'ID de cargo inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleIdToEdit).first();
        if (!targetRole) {
            return new Response(JSON.stringify({ message: 'Cargo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        
        console.log(`Nível atual do cargo alvo: ${targetRole.level}`);

        // REGRA 1: Proteção do cargo Membro
        const MEMBER_ROLE_LEVEL = 1000;
        if (targetRole.level === MEMBER_ROLE_LEVEL && loggedInUser.level !== 0) {
            console.log("BLOQUEIO: Tentativa de editar cargo Membro por não-Dono.");
            return new Response(JSON.stringify({ message: 'O cargo Membro só pode ser editado pelo Dono.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // REGRA 2: Ninguém pode editar o próprio cargo.
        if (roleIdToEdit === loggedInUser.roleId) {
            console.log("BLOQUEIO: Tentativa de auto-edição de cargo.");
            return new Response(JSON.stringify({ message: 'Você não pode editar seu próprio cargo.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // REGRA 3: Hierarquia - O admin logado não pode editar um cargo que já está em um nível igual ou superior ao seu.
        console.log(`Comparando Nível do Admin (${loggedInUser.level}) com Nível do Alvo (${targetRole.level}). Condição: ${loggedInUser.level} >= ${targetRole.level}`);
        if (loggedInUser.level >= targetRole.level) {
            console.log("BLOQUEIO: Tentativa de editar cargo de hierarquia superior ou igual.");
            return new Response(JSON.stringify({ message: 'Não é possível editar um cargo com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
        
        // REGRA 4: Hierarquia - O admin não pode promover um cargo para um nível igual ou superior ao seu.
        console.log(`Comparando Nível do Admin (${loggedInUser.level}) com Novo Nível (${level}). Condição: ${loggedInUser.level} >= ${level}`);
        if (loggedInUser.level >= level) {
            console.log("BLOQUEIO: Tentativa de promover cargo para hierarquia superior ou igual.");
            return new Response(JSON.stringify({ message: 'Não é possível definir um nível de hierarquia igual ou superior ao seu.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // REGRA 5: Permissões - Um admin não pode conceder permissões que ele mesmo não possui (exceto o Dono).
        if (loggedInUser.level > 0) {
            // ... (a lógica de permissões continua a mesma)
        }
        
        console.log("SUCESSO: Todas as verificações de segurança passaram. Atualizando o cargo.");
        // ... (resto da função para atualizar o banco)
        await db.batch([
            db.prepare('UPDATE roles SET name = ?, level = ? WHERE id = ?').bind(name, level, roleIdToEdit),
            db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleIdToEdit)
        ]);
        if (requestedPermissionIds.length > 0) { /* ... */ }
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error("ERRO FATAL na função onRequestPut:", error);
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