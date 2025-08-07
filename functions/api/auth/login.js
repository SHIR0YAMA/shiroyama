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
        role: user.role_name,
        roleId: user.role_id,
        level: user.role_level,
        permissions: user.permissions,
        exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // Expira em 24 horas
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

        // Passo 1: Encontra o usuário e o cargo base.
        const userStmt = env.DB.prepare(`
            SELECT u.id, u.username, u.password, u.role_id, r.name as role_name, r.level as role_level
            FROM users u
            JOIN roles r ON u.role_id = r.id
            WHERE u.username = ?
        `).bind(username);
        const user = await userStmt.first();

        if (!user || user.password !== hashedPassword) {
            return new Response(JSON.stringify({ success: false, message: 'Nome de usuário ou senha incorretos.' }), { status: 401, headers: { 'Content-Type': 'application/json' }});
        }
        
        // Passo 2: Busca TODAS as permissões associadas àquele cargo.
        const permsStmt = env.DB.prepare(`
            SELECT p.name FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id = ?
        `).bind(user.role_id);
        const { results: perms } = await permsStmt.all();
        
        // Adiciona as permissões ao objeto do usuário
        user.permissions = perms ? perms.map(p => p.name) : [];

        // Passo 3: Cria o token com todos os dados.
        const token = await createJwt(user, env.JWT_SECRET);

        return new Response(JSON.stringify({ success: true, token }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro no login:", error);
        return new Response(JSON.stringify({ success: false, message: 'Erro no servidor.' }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}