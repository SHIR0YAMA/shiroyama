// /functions/api/admin/roles/[id]/index.js

async function verifyJwtAndPermission(request, env, requiredPermission) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw { message: 'Token não fornecido ou malformado.', status: 401 };
    }
    const token = authHeader.split(' ')[1];
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.permissions || !payload.permissions.includes(requiredPermission)) {
        throw { message: 'Acesso negado: permissão necessária.', status: 403 };
    }
    const encoder = new TextEncoder();
    const dataToSign = `${token.split('.')[0]}.${token.split('.')[1]}`;
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signature = new Uint8Array(atob(token.split('.')[2].replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));
    const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(dataToSign));
    if (!isValid || payload.exp < Math.floor(Date.now() / 1000)) {
        throw { message: 'Token inválido ou expirado.', status: 401 };
    }
    return payload;
}

// PUT /api/admin/roles/:id -> Atualiza um cargo
export async function onRequestPut(context) {
    try {
        const payload = await verifyJwtAndPermission(context.request, context.env, 'can_manage_roles');
        const roleId = context.params.id;
        const { name, level, permissions } = await context.request.json();
        const db = context.env.DB;
        
        const targetRole = await db.prepare('SELECT level FROM roles WHERE id = ?').bind(roleId).first();
        if (!targetRole || payload.role_level >= targetRole.level || (level && payload.role_level >= level)) {
             return new Response(JSON.stringify({ message: 'Hierarquia insuficiente para modificar este cargo.' }), { status: 403 });
        }

        const updateRoleStmt = db.prepare('UPDATE roles SET name = ?, level = ? WHERE id = ?').bind(name, level, roleId);
        const clearPermsStmt = db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(roleId);
        
        let batch = [updateRoleStmt, clearPermsStmt];

        if (permissions && permissions.length > 0) {
            const newPermsStmts = permissions.map(permId => 
                db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').bind(roleId, permId)
            );
            batch = batch.concat(newPermsStmts);
        }

        await db.batch(batch);

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
        
        const targetRole = await db.prepare('SELECT level, name FROM roles WHERE id = ?').bind(roleId).first();
        if (targetRole.name === 'Owner') {
             return new Response(JSON.stringify({ message: 'O cargo "Owner" não pode ser excluído.' }), { status: 403 });
        }
        if (!targetRole || payload.role_level >= targetRole.level) {
             return new Response(JSON.stringify({ message: 'Hierarquia insuficiente para excluir este cargo.' }), { status: 403 });
        }
        
        const userCheck = await db.prepare('SELECT COUNT(*) as count FROM users WHERE role_id = ?').bind(roleId).first();
        if (userCheck.count > 0) {
            return new Response(JSON.stringify({ message: 'Não é possível excluir um cargo que está em uso.' }), { status: 409 });
        }

        await db.prepare('DELETE FROM roles WHERE id = ?').bind(roleId).run();
        return new Response(null, { status: 204 });

    } catch (error) {
        return new Response(JSON.stringify({ message: error.message || 'Erro interno' }), { status: error.status || 500 });
    }
}