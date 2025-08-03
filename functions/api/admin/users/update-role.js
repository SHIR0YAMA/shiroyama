// /functions/api/admin/users/update-role.js

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

export async function onRequestPost(context) {
    try {
        const payload = await verifyJwtAndPermission(context.request, context.env, 'can_manage_users');
        const { userId, newRoleId } = await context.request.json();
        const db = context.env.DB;

        // Pega o nível de hierarquia tanto do admin quanto do usuário alvo
        const targetUserStmt = db.prepare(`
            SELECT r.level FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?
        `).bind(userId);
        const targetUser = await targetUserStmt.first();

        const newRoleStmt = db.prepare('SELECT level FROM roles WHERE id = ?').bind(newRoleId);
        const newRole = await newRoleStmt.first();

        if (!targetUser || !newRole) {
            return new Response(JSON.stringify({ message: 'Usuário ou cargo não encontrado.' }), { status: 404 });
        }

        // Regra de segurança: Impede que um admin promova outro usuário para seu nível ou superior,
        // ou rebaixe um usuário que já está em um nível superior.
        if (payload.role_level >= targetUser.level || payload.role_level >= newRole.level) {
            return new Response(JSON.stringify({ message: 'Hierarquia insuficiente para realizar esta alteração.' }), { status: 403 });
        }
        
        await db.prepare('UPDATE users SET role_id = ? WHERE id = ?').bind(newRoleId, userId).run();

        return new Response(JSON.stringify({ success: true, message: 'Cargo do usuário atualizado.' }));
    } catch (error) {
        return new Response(JSON.stringify({ message: error.message || 'Erro interno' }), { status: error.status || 500 });
    }
}