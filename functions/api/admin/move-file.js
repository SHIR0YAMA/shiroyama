// /functions/api/admin/move-file.js

async function verifyJwt(token, secret) {
    // ... Cole a função verifyJwt completa aqui ...
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

        // Apenas admins e donos podem mover arquivos
        if (payload.role !== 'admin' && payload.role !== 'owner') {
            return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403 });
        }

        const { oldKey, newKey } = await request.json();

        if (!oldKey || !newKey) {
            return new Response(JSON.stringify({ message: 'Chave antiga e nova são obrigatórias.' }), { status: 400 });
        }
        
        // Passo 1: Pega o valor do arquivo original no KV
        const value = await env.ARQUIVOS_TELEGRAM.get(oldKey);
        
        if (value === null) {
            return new Response(JSON.stringify({ message: 'Arquivo de origem não encontrado.' }), { status: 404 });
        }

        // Passo 2: Escreve o valor no novo local (a nova chave)
        await env.ARQUIVOS_TELEGRAM.put(newKey, value);

        // Passo 3: Apaga o arquivo original
        await env.ARQUIVOS_TELEGRAM.delete(oldKey);

        return new Response(JSON.stringify({ success: true, message: 'Arquivo movido com sucesso.' }));

    } catch (error) {
        console.error("Erro ao mover arquivo:", error.message);
        return new Response(JSON.stringify({ message: error.message }), { status: 500 });
    }
}