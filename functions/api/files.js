// Esta função será executada quando o usuário acessar /api/files
export async function onRequest(context) {
    // context.env.ARQUIVOS_TELEGRAM é como acessamos nosso banco de dados KV
    const kv = context.env.ARQUIVOS_TELEGRAM;

    // Pega todas as chaves (arquivos) do nosso KV
    const list = await kv.list();

    const files = [];
    for (const key of list.keys) {
        // Para cada chave, pega o valor (os detalhes do arquivo)
        const value = await kv.get(key.name, { type: 'json' });
        if (value) {
            files.push({
                name: key.name, // o nome do arquivo é a chave
                id: value.file_id // o ID do telegram está no valor
            });
        }
    }
    
    // Retorna a lista de arquivos em formato JSON
    return new Response(JSON.stringify({ files }), {
        headers: { 'Content-Type': 'application/json' },
    });
}