// /functions/api/files.js

export async function onRequestGet(context) {
    const { env, data } = context;
    const loggedInUser = data.user;

    // A verificação de permissão está dentro do próprio arquivo para garantir.
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

        // Loop com paginação para garantir que TODOS os arquivos sejam lidos do KV,
        // sem depender de nenhum cache ou variável global.
        while(!listComplete) {
            const list = await env.ARQUIVOS_TELEGRAM.list({ cursor: cursor, limit: 1000 });
            const files = list.keys.map(key => {
                // Tenta extrair metadados se existirem, senão usa um valor padrão.
                // A chave 'customMetadata' é usada pelo R2. Se for KV, pode ser diferente ou não existir.
                const metadata = key.customMetadata || {};
                return {
                    name: key.name,
                    file_size: metadata.file_size || 0,
                    message_id: metadata.message_id || null,
                    uploaded_at: key.uploaded
                };
            });
            
            allFiles.push(...files);
            
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