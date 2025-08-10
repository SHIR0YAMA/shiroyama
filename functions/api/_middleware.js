// /functions/api/_middleware.js (SIMPLIFICADO)

async function decodeJwt(token, secret) {
    try {
        const [header, payload, signature] = token.split('.');
        if (!header || !payload || !signature) return null;
        const textToSign = `${header}.${payload}`;
        const decodedSignature = new Uint8Array(atob(signature.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const valid = await crypto.subtle.verify('HMAC', key, decodedSignature, new TextEncoder().encode(textToSign));
        if (!valid) return null;
        const decodedPayload = JSON.parse(atob(payload.replace(/_/g, '/').replace(/-/g, '+')));
        if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) return null;
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
        if (url.pathname.startsWith('/api/admin/') || url.pathname.startsWith('/api/user/')) {
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

    // NENHUMA VERIFICAÇÃO DE PERMISSÃO AQUI. Apenas continua.
    return next();
}

export const onRequest = [authMiddleware];