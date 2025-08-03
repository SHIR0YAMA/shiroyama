// /functions/api/admin/roles.js

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

// GET /api/admin/roles -> Lista todos os cargos e suas permissões
export async function onRequestGet(context) {
    try {
        await verifyJwtAndPermission(context.request, context.env, 'can_manage_roles');

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
        return new Response(JSON.stringify({ message: error.message || 'Erro interno' }), { status: error.status || 500 });
    }
}

// POST /api/admin/roles -> Cria um novo cargo
export async function onRequestPost(context) {
    try {
        const payload = await verifyJwtAndPermission(context.request, context.env, 'can_manage_roles');
        const { name, level, permissions } = await context.request.json();
        const db = context.env.DB;

        if (!name || typeof level !== 'number' || !Array.isArray(permissions)) {
            return new Response(JSON.stringify({ message: 'Dados inválidos.' }), { status: 400 });
        }

        if (payload.role_level >= level) {
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
        return new Response(JSON.stringify({ message: error.message || 'Erro interno' }), { status: error.status || 500 });
    }
}