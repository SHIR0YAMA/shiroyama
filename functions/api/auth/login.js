// /functions/api/auth/login.js

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createJwt(user, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
        userId: user.id,
        username: user.username,
        role: user.primary_role_name,
        roleId: user.primary_role_id,
        level: user.effective_level,
        permissions: user.permissions,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7) // 7 dias
    };

    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    
    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(dataToSign));
    
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    return `${dataToSign}.${encodedSignature}`;
}

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const { username, password } = await request.json();
        const hashedPassword = await hashPassword(password);
        const db = env.DB;

        const userStmt = db.prepare(`SELECT id, username, password FROM users WHERE username = ?`).bind(username);
        const user = await userStmt.first();

        if (!user || user.password !== hashedPassword) {
            return new Response(JSON.stringify({ success: false, message: 'Nome de usuário ou senha incorretos.' }), { status: 401, headers: { 'Content-Type': 'application/json' }});
        }
        
        const rolesStmt = db.prepare(`
            SELECT r.id, r.name, r.level
            FROM roles r
            JOIN user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = ?
            ORDER BY r.level ASC
        `).bind(user.id);
        const { results: userRoles } = await rolesStmt.all();

        if (!userRoles || userRoles.length === 0) {
            return new Response(JSON.stringify({ success: false, message: 'Usuário não tem um cargo atribuído. Contate um administrador.' }), { status: 403, headers: { 'Content-Type': 'application/json' }});
        }

        user.effective_level = userRoles[0].level;
        user.primary_role_name = userRoles[0].name;
        user.primary_role_id = userRoles[0].id;

        const roleIds = userRoles.map(r => r.id);
        
        const placeholders = roleIds.map(() => '?').join(',');
        const permsStmt = db.prepare(`
            SELECT DISTINCT p.name 
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id IN (${placeholders})
        `).bind(...roleIds);
        const { results: perms } = await permsStmt.all();
        
        user.permissions = perms ? perms.map(p => p.name) : [];

        const token = await createJwt(user, env.JWT_SECRET);

        return new Response(JSON.stringify({ success: true, token }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro no login:", error);
        return new Response(JSON.stringify({ success: false, message: 'Erro no servidor.' }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}