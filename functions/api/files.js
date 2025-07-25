// /functions/api/files.js

export async function onRequest(context) {
    try {
        const kv = context.env.ARQUIVOS_TELEGRAM;

        const list = await kv.list();

        const files = [];
        for (const key of list.keys) {
            // Pega o valor do KV e o converte de string para objeto JSON
            const value = await kv.get(key.name, { type: 'json' });
            
            // Verifica se o valor existe e tem a message_id
            if (value && value.message_id) {
                files.push({
                    name: key.name,
                    message_id: value.message_id,
                    // --- A LINHA QUE FALTAVA ---
                    file_size: value.file_size || 0 // Pega o file_size. Se não existir, usa 0.
                });
            }
        }
        
        return new Response(JSON.stringify({ files }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error("Erro na API /files:", error);
        return new Response(`Erro ao listar arquivos: ${error.message}`, { status: 500 });
    }
}