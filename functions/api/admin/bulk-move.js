// /functions/api/admin/bulk-move.js

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

        // Apenas admins e donos podem mover arquivos em massa
        if (payload.role !== 'admin' && payload.role !== 'owner') {
            return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403 });
        }

        const { oldKeys, destinationPath } = await request.json();

        if (!Array.isArray(oldKeys) || oldKeys.length === 0 || typeof destinationPath !== 'string') {
            return new Response(JSON.stringify({ message: 'Payload inválido. É necessário "oldKeys" (array) e "destinationPath" (string).' }), { status: 400 });
        }
        
        // Para cada arquivo a ser movido, criamos uma promessa de "copiar e apagar"
        const moveOperations = oldKeys.map(async (oldKey) => {
            const value = await env.ARQUIVOS_TELEGRAM.get(oldKey);

            if (value !== null) {
                const fileName = oldKey.split('/').pop();
                // O novo caminho é o destino + nome do arquivo
                const newKey = destinationPath ? `${destinationPath}/${fileName}` : fileName;

                // Evita mover um arquivo para o mesmo lugar
                if (oldKey !== newKey) {
                    await env.ARQUIVOS_TELEGRAM.put(newKey, value);
                    await env.ARQUIVOS_TELEGRAM.delete(oldKey);
                }
            }
        });

        // Executa todas as operações em paralelo
        await Promise.all(moveOperations);

        return new Response(JSON.stringify({ success: true, message: `${oldKeys.length} arquivo(s) movido(s) com sucesso.` }));

    } catch (error) {
        console.error("Erro ao mover arquivos em massa:", error.message);
        return new Response(JSON.stringify({ message: error.message }), { status: 500 });
    }
}