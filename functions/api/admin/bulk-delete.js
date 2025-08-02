// /functions/api/admin/bulk-delete.js

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

        // Apenas admins e donos podem excluir
        if (payload.role !== 'admin' && payload.role !== 'owner') {
            return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403 });
        }

        const { keys, prefix } = await request.json();

        if (!keys && !prefix) {
            return new Response(JSON.stringify({ message: 'É necessário fornecer "keys" ou "prefix".' }), { status: 400 });
        }

        let keysToDelete = [];

        // Adiciona chaves individuais (para exclusão de arquivos selecionados)
        if (keys && Array.isArray(keys)) {
            keysToDelete.push(...keys);
        }

        // Adiciona chaves de uma pasta inteira (para exclusão de pasta)
        if (prefix && typeof prefix === 'string') {
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: prefix });
            const folderKeys = list.keys.map(k => k.name);
            keysToDelete.push(...folderKeys);
        }
        
        if (keysToDelete.length === 0) {
            return new Response(JSON.stringify({ success: true, message: 'Nenhum arquivo para excluir.' }));
        }

        // A API do KV permite deletar um array de chaves de uma só vez, o que é muito eficiente.
        await env.ARQUIVOS_TELEGRAM.delete(keysToDelete);

        return new Response(JSON.stringify({ success: true, message: `${keysToDelete.length} item(ns) excluído(s) com sucesso.` }));

    } catch (error) {
        console.error("Erro ao excluir arquivos/pastas:", error.message);
        return new Response(JSON.stringify({ message: error.message }), { status: 500 });
    }
}