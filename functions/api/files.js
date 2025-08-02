// /functions/api/files.js

// -- Função de verificação de Token JWT (copiada para cá) --
async function verifyJwt(token, secret) {
    try {
        const encoder = new TextEncoder();
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
        if (!encodedHeader || !encodedPayload || !encodedSignature) {
            throw new Error('Formato do token inválido');
        }
        const dataToSign = `${encodedHeader}.${encodedPayload}`;
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const signature = new Uint8Array(atob(encodedSignature.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));
        const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(dataToSign));
        if (!isValid) {
            throw new Error('Assinatura do token inválida');
        }
        const decodedPayload = JSON.parse(new TextDecoder().decode(new Uint8Array(atob(encodedPayload.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)))));
        if (decodedPayload.exp < Math.floor(Date.now() / 1000)) {
            throw new Error('Token expirado');
        }
        return decodedPayload;
    } catch (error) {
        throw new Error(`Token inválido: ${error.message}`);
    }
}

export async function onRequestGet(context) {
    const { request, env } = context;
    try {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ message: 'Autenticação requerida' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        await verifyJwt(token, env.JWT_SECRET); // Apenas verifica, não precisa do payload aqui

        // Lista todas as chaves no namespace KV ARQUIVOS_TELEGRAM
        const list = await env.ARQUIVOS_TELEGRAM.list();
        const files = [];

        // Itera sobre cada chave encontrada
        for (const key of list.keys) {
            // Pega o valor JSON associado à chave
            const value = await env.ARQUIVOS_TELEGRAM.get(key.name);
            if (value) {
                try {
                    const data = JSON.parse(value);
                    
                    // Constrói o objeto do arquivo com compatibilidade para formatos antigos e novos
                    let fileObject;

                    // Formato NOVO (nome do arquivo é parte da chave, ex: "Novos/NomeDoArquivo.ext")
                    // O nome 'name' no JSON não é mais usado, só a key.name
                    if (key.name.includes('/')) {
                        fileObject = {
                            name: key.name, // A chave já inclui o caminho completo e o nome
                            message_id: data.message_id,
                            file_size: data.file_size
                            // file_id e unique_id não são mais estritamente necessários para a UI,
                            // mas podem ser mantidos se o download.js ainda precisar.
                            // Para o download, o message_id e o CHANNEL_ID são o suficiente.
                        };
                    } 
                    // Formato ANTIGO (nome e outros IDs estão dentro do valor JSON)
                    else {
                        fileObject = {
                            name: data.name, // Pega o nome de dentro do JSON antigo
                            file_id: data.file_id, 
                            unique_id: data.unique_id,
                            file_size: data.file_size,
                            message_id: data.message_id
                        };
                    }
                    
                    // Adiciona o arquivo à lista se tiver um nome válido
                    if (fileObject.name) {
                        files.push(fileObject);
                    }

                } catch (e) {
                    // Loga se houver um erro ao parsear um valor (JSON inválido no KV)
                    console.error(`Erro ao parsear o valor para a chave ${key.name}:`, e);
                }
            }
        }
        
        // Retorna a lista de arquivos
        return new Response(JSON.stringify({ files }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        // Loga e retorna erros de autenticação ou outros erros de servidor
        console.error("Erro em /api/files:", error.message);
        return new Response(JSON.stringify({ message: error.message }), { status: 500 });
    }
}