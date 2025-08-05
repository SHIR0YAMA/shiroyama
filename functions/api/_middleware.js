// /functions/api/_middleware.js

async function decodeJwt(token, secret) {
    try {
        const [header, payload, signature] = token.split('.');
        if (!header || !payload || !signature) return null;
        
        const textToSign = `${header}.${payload}`;
        const decodedSignature = new Uint8Array(atob(signature.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));
        const key = await crypto.subtle.importKey( 'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'] );
        const valid = await crypto.subtle.verify('HMAC', key, decodedSignature, new TextEncoder().encode(textToSign));
        if (!valid) return null;

        const decodedPayload = JSON.parse(atob(payload.replace(/_/g, '/').replace(/-/g, '+')));
        
        if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        
        return decodedPayload;
    } catch (e) {
        return null;
    }
}

async function authMiddleware(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);

    const publicRoutes = ['/api/auth/login', '/api/auth/register'];
    if (publicRoutes.includes(url.pathname)) {
        return next();
    }

    const authorization = request.headers.get('Authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
        if (url.pathname.startsWith('/api/admin/')) {
            return new Response(JSON.stringify({ message: 'Token de autenticação não fornecido.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        return next();
    }

    const token = authorization.substring(7);
    const userData = await decodeJwt(token, env.JWT_SECRET);

    if (!userData) {
        return new Response(JSON.stringify({ message: 'Token inválido ou expirado.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (!context.data) context.data = {};
    context.data.user = userData;

    // Lógica especial para a rota /api/admin/rename
    if (url.pathname.startsWith('/api/admin/rename')) {
        try {
            const body = await request.clone().json();
            const permissionNeeded = body.isFolder ? 'can_rename_folders' : 'can_rename_items';
            if (!userData.permissions || !userData.permissions.includes(permissionNeeded)) {
                return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: ${permissionNeeded}` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }
            return next();
        } catch (e) {
            return new Response(JSON.stringify({ message: 'Payload inválido para a requisição de renomear.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
    }

    // Mapa de permissões para outras rotas
    const requiredPermissions = {
		'/api/admin/users/update-role': 'can_manage_roles',
        '/api/admin/users': 'can_manage_users',
        '/api/admin/roles': 'can_manage_roles',
        '/api/admin/permissions': 'can_manage_roles',
        '/api/admin/delete-user': 'can_manage_users',
        '/api/admin/unlink-user-telegram': 'can_manage_users', // Adicionado
        '/api/admin/reset-password': 'can_manage_users', // Adicionado
        '/api/admin/bulk-delete': 'can_delete_items',
        '/api/admin/bulk-move': 'can_move_items',
        '/api/admin/create-folder': 'can_create_folders',
        '/api/admin/move-file': 'can_move_items',
        '/api/admin/delete': 'can_delete_items',
        '/api/single-forward': 'can_receive_files',
        '/api/bulk-forward': 'can_receive_files'
    };

    const matchingRoute = Object.keys(requiredPermissions).find(route => url.pathname.startsWith(route));
    if (matchingRoute) {
        const permissionNeeded = requiredPermissions[matchingRoute];
        if (!userData.permissions || !userData.permissions.includes(permissionNeeded)) {
            return new Response(JSON.stringify({ message: `Acesso negado. Requer permissão: ${permissionNeeded}` }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }
    }
    
    return next();
}

export const onRequest = [authMiddleware];