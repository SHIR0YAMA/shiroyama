// /functions/api/admin/rename.js

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

        const { oldKey, newKey, isFolder } = await request.json();

        if (!oldKey || !newKey) {
            return new Response(JSON.stringify({ message: 'Nome antigo e novo são obrigatórios.' }), { status: 400 });
        }
        
        if (isFolder) {
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: oldKey + '/' }); // Adiciona a barra para pegar o conteúdo
            if (list.keys.length === 0) {
                 // Se a pasta está vazia, ela só tem um .placeholder. Vamos mover/renomear ele.
                const placeholderValue = await env.ARQUIVOS_TELEGRAM.get(oldKey + '/.placeholder');
                if (placeholderValue) {
                    await env.ARQUIVOS_TELEGRAM.put(newKey + '/.placeholder', placeholderValue);
                    await env.ARQUIVOS_TELEGRAM.delete(oldKey + '/.placeholder');
                    return new Response(JSON.stringify({ success: true, message: 'Pasta vazia movida/renomeada com sucesso.' }));
                } else {
                    return new Response(JSON.stringify({ message: 'Pasta de origem não encontrada.' }), { status: 404 });
                }
            }

            const operations = list.keys.map(key => {
                const originalValuePromise = env.ARQUIVOS_TELEGRAM.get(key.name);
                return originalValuePromise.then(originalValue => {
                    if (originalValue !== null) {
                        const newPath = key.name.replace(oldKey, newKey);
                        return Promise.all([
                            env.ARQUIVOS_TELEGRAM.put(newPath, originalValue),
                            env.ARQUIVOS_TELEGRAM.delete(key.name)
                        ]);
                    }
                });
            });
            
            await Promise.all(operations);
            return new Response(JSON.stringify({ success: true, message: 'Pasta renomeada com sucesso.' }));
        } else {
            const value = await env.ARQUIVOS_TELEGRAM.get(oldKey);
            if (value === null) {
                return new Response(JSON.stringify({ message: 'Arquivo de origem não encontrado.' }), { status: 404 });
            }
            
            await env.ARQUIVOS_TELEGRAM.put(newKey, value);
            await env.ARQUIVOS_TELEGRAM.delete(oldKey);

            return new Response(JSON.stringify({ success: true, message: 'Arquivo renomeado com sucesso.' }));
        }

    } catch (error) {
        console.error("Erro ao renomear:", error.message);
        return new Response(JSON.stringify({ message: error.message }), { status: 500 });
    }
}