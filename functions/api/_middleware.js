// /functions/api/_middleware.js

// Função para decodificar o token JWT
async function decodeJwt(token, secret) {
    try {
        const [header, payload, signature] = token.split('.');
        if (!header || !payload || !signature) return null;
        
        const textToSign = `${header}.${payload}`;

        const decodedSignature = new Uint8Array(atob(signature.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const valid = await crypto.subtle.verify('HMAC', key, decodedSignature, new TextEncoder().encode(textToSign));
        if (!valid) return null;

        const decodedPayload = JSON.parse(atob(payload.replace(/_/g, '/').replace(/-/g, '+')));
        
        // Verifica a expiração do token
        if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
            console.log("Token expirado.");
            return null;
        }
        
        return decodedPayload;
    } catch (e) {
        console.error("Erro ao decodificar JWT:", e.message);
        return null;
    }
}


// Função de Middleware Principal
async function authMiddleware(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);

    // Rotas públicas que não precisam de autenticação
    const publicRoutes = [
        '/api/auth/login',
        '/api/auth/register'
    ];

    if (publicRoutes.includes(url.pathname)) {
        return next();
    }

    const authorization = request.headers.get('Authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
        // Se a rota não for pública e não houver token, negue o acesso (exceto para /api/files que tem sua própria lógica)
        if (url.pathname.startsWith('/api/admin/')) {
            return new Response('Token de autenticação não fornecido.', { status: 401 });
        }
        return next();
    }

    const token = authorization.substring(7);
    const userData = await decodeJwt(token, env.JWT_SECRET);

    if (!userData) {
        return new Response('Token inválido ou expirado.', { status: 401 });
    }

    // Anexa os dados do usuário ao contexto para que as próximas funções possam usá-los
    // Assegura que context.data exista
    if (!context.data) {
        context.data = {};
    }
    context.data.user = userData;

    // ----- Verificação de Permissões para Rotas -----
    const requiredPermissions = {
        // Rotas Admin
        '/api/admin/users': 'can_manage_users',
        '/api/admin/roles': 'can_manage_roles',
        '/api/admin/permissions': 'can_manage_roles',
        '/api/admin/delete-user': 'can_manage_users',
        '/api/admin/bulk-delete': 'can_delete_items',
        '/api/admin/bulk-move': 'can_move_items',
        '/api/admin/create-folder': 'can_create_folders',
        '/api/admin/rename': 'can_rename_items',
        '/api/admin/move-file': 'can_move_items',
        '/api/admin/delete': 'can_delete_items', // <-- ROTA ADICIONADA AQUI

        // Outras rotas que requerem permissões específicas
        '/api/single-forward': 'can_receive_files',
        '/api/bulk-forward': 'can_receive_files'
    };

    // Encontra a rota correspondente no mapa de permissões
    const matchingRoute = Object.keys(requiredPermissions).find(route => url.pathname.startsWith(route));

    if (matchingRoute) {
        const permissionNeeded = requiredPermissions[matchingRoute];
        if (!userData.permissions || !userData.permissions.includes(permissionNeeded)) {
            return new Response(`Acesso negado. Requer permissão: ${permissionNeeded}`, { status: 403 });
        }
    }
    
    // Se tudo estiver OK, prossiga para a rota solicitada
    return next();
}

// O manipulador on-demand para o Cloudflare Pages
export const onRequest = [authMiddleware];