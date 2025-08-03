// /functions/api/auth/login.js

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// (Função para criar o JWT, que agora inclui permissões)
async function createJwt(user, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
        userId: user.id,
        username: user.username,
        role: user.role_name, // Nome do cargo
        role_level: user.role_level, // Nível de hierarquia
        permissions: user.permissions, // Array de permissões
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

        // --- ALTERAÇÃO PRINCIPAL AQUI ---
        // 1. A query agora busca o usuário e junta com as tabelas de cargos e permissões.
        const userQuery = `
            SELECT 
                u.id, 
                u.username, 
                u.password, 
                r.name as role_name, 
                r.level as role_level, 
                GROUP_CONCAT(p.name) as permissions
            FROM users u
            JOIN roles r ON u.role_id = r.id
            LEFT JOIN role_permissions rp ON r.id = rp.role_id
            LEFT JOIN permissions p ON rp.permission_id = p.id
            WHERE u.username = ?
            GROUP BY u.id, r.id;
        `;
        const userStmt = env.DB.prepare(userQuery).bind(username);
        const user = await userStmt.first();

        if (!user || user.password !== hashedPassword) {
            return new Response(JSON.stringify({ success: false, message: 'Nome de usuário ou senha incorretos.' }), { status: 401 });
        }
        
        // Converte a string de permissões em um array
        user.permissions = user.permissions ? user.permissions.split(',') : [];

        // 2. Cria o token JWT com todas as informações (incluindo permissões).
        const token = await createJwt(user, env.JWT_SECRET);

        return new Response(JSON.stringify({ success: true, token }));

    } catch (error) {
        console.error("Erro no login:", error);
        return new Response(JSON.stringify({ success: false, message: 'Erro no servidor.' }), { status: 500 });
    }
}