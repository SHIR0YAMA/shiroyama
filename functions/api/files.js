// /functions/api/files.js

export async function onRequestGet(context) {
    const { env, data } = context;
    const loggedInUser = data.user;

    if (!loggedInUser || !loggedInUser.permissions.includes('can_view_files')) {
        return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para visualizar arquivos.' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        let allFiles = [];
        let listComplete = false;
        let cursor = undefined;

        // Loop para listar TODAS as chaves
        while(!listComplete) {
            const list = await env.ARQUIVOS_TELEGRAM.list({ cursor: cursor, limit: 1000 });
            
            // --- CORREÇÃO PRINCIPAL AQUI ---
            // Para cada chave encontrada, precisamos buscar seu valor, que contém os metadados.
            const filePromises = list.keys.map(async (key) => {
                // Ignora chaves de placeholder de pastas
                if (key.name.endsWith('/.placeholder')) {
                    return { name: key.name, isPlaceholder: true };
                }

                try {
                    // Busca o valor da chave no KV
                    const value = await env.ARQUIVOS_TELEGRAM.get(key.name);
                    if (value) {
                        const metadata = JSON.parse(value);
                        return {
                            name: key.name,
                            file_size: metadata.file_size || 0,
                            message_id: metadata.message_id || null
                        };
                    }
                } catch (e) {
                    // Se o valor não for um JSON válido, retorna dados padrão
                    console.error(`Chave '${key.name}' tem valor inválido:`, value);
                    return { name: key.name, file_size: 0, message_id: null };
                }
                return null;
            });
            
            const filesBatch = (await Promise.all(filePromises)).filter(Boolean); // Executa todas as buscas em paralelo e remove nulos
            allFiles.push(...filesBatch);
            // --- FIM DA CORREÇÃO ---
            
            if (list.truncated) {
                cursor = list.cursor;
            } else {
                listComplete = true;
            }
        }

        // Adiciona um cabeçalho para instruir a não cachear esta resposta.
        const headers = new Headers({
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });

        return new Response(JSON.stringify({ files: allFiles }), { headers: headers });

    } catch (error) {
        console.error("Erro ao listar arquivos:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao buscar a lista de arquivos." }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}