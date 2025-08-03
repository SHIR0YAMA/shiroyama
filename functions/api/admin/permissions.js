// /functions/api/admin/permissions.js

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

// GET /api/admin/permissions -> Lista todas as permissões disponíveis
export async function onRequestGet(context) {
    try {
        await verifyJwtAndPermission(context.request, context.env, 'can_manage_roles');

        const stmt = context.env.DB.prepare('SELECT id, name, description FROM permissions ORDER BY id');
        const { results } = await stmt.all();

        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ message: error.message || 'Erro interno' }), { status: error.status || 500 });
    }
}