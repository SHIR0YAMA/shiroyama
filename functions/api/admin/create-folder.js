// /functions/api/admin/create-folder.js

async function verifyJwt(token, secret) {
    try {
        const encoder = new TextEncoder();
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
        if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Formato do token inválido');
        const dataToSign = `${encodedHeader}.${encodedPayload}`;
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const signature = new Uint8Array(atob(encodedSignature.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));
        const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(dataToSign));
        if (!isValid) throw new Error('Assinatura do token inválida');
        const decodedPayload = JSON.parse(new TextDecoder().decode(new Uint8Array(atob(encodedPayload.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)))));
        if (decodedPayload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expirado');
        return decodedPayload;
    } catch (error) {
        throw new Error(`Token inválido: ${error.message}`);
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ message: 'Auth requerida' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);

        if (payload.role !== 'admin' && payload.role !== 'owner') {
            return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403 });
        }

        const { folderPath } = await request.json();

        if (!folderPath || folderPath.includes('//') || folderPath.endsWith('/')) {
            return new Response(JSON.stringify({ message: 'Nome de pasta inválido.' }), { status: 400 });
        }
        
        const key = `${folderPath}/.placeholder`;

        const existing = await env.ARQUIVOS_TELEGRAM.get(key);
        if (existing !== null) {
            return new Response(JSON.stringify({ message: 'Uma pasta ou arquivo com este nome já existe.' }), { status: 409 });
        }

        const value = JSON.stringify({ created_at: new Date().toISOString() });
        await env.ARQUIVOS_TELEGRAM.put(key, value);

        return new Response(JSON.stringify({ success: true, message: 'Pasta criada com sucesso.' }));

    } catch (error) {
        console.error("Erro ao criar pasta:", error.message);
        return new Response(JSON.stringify({ message: error.message }), { status: 500 });
    }
}