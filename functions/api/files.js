// Esta função será executada quando o usuário acessar /api/files
export async function onRequest(context) {
    try {
        // context.env.ARQUIVOS_TELEGRAM é como acessamos nosso banco de dados KV
        const kv = context.env.ARQUIVOS_TELEGRAM;

        // Pega todas as chaves (nomes dos arquivos) do nosso KV
        const list = await kv.list();

        const files = [];
        for (const key of list.keys) {
            // Para cada chave, pega o valor (que agora contém a message_id)
            const value = await kv.get(key.name, { type: 'json' });
            if (value && value.message_id) {
                files.push({
                    name: key.name,
                    message_id: value.message_id // Alterado de file_id para message_id
                });
            }
        }
        
        // Retorna a lista de arquivos em formato JSON
        return new Response(JSON.stringify({ files }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        // Retorna um erro claro se algo der errado (ex: KV não configurado)
        return new Response(`Erro ao listar arquivos da Cloudflare: ${error.message}`, { status: 500 });
    }
}