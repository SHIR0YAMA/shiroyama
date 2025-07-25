// /functions/api/webhook.js

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        // Pega o corpo da requisição enviada pelo Telegram
        const data = await request.json();

        // O Telegram envia dados diferentes dependendo do tipo de chat
        // Nós nos interessamos principalmente por 'channel_post' (para canais) e 'message' (para grupos)
        const message = data.channel_post || data.message;

        // Se não for uma mensagem que nos interessa, simplesmente retornamos OK.
        if (!message) {
            return new Response('OK: No relevant message found.', { status: 200 });
        }
        
        // Tentamos encontrar um arquivo na mensagem. O Telegram usa nomes diferentes:
        // document (para a maioria dos arquivos), video, audio, ou photo (para imagens).
        let file = message.document || message.video || message.audio || message.photo;
        let file_name = 'unknown_file';
        let file_size = 0;

        if (file) {
            // Se for uma foto, 'file' é um array de resoluções. Pegamos a maior.
            if (Array.isArray(file)) {
                file = file.sort((a, b) => b.file_size - a.file_size)[0];
            }

            const message_id = message.message_id;
            
            // Atribui o nome e o tamanho do arquivo
            file_name = file.file_name || `photo_${message.message_id}.jpg`;
            file_size = file.file_size;

            // Define a chave no KV com o caminho "Novos/nome_do_arquivo.ext"
            const key = `Novos/${file_name}`;

            // Prepara o valor a ser salvo (um JSON como string)
            const value = JSON.stringify({
                message_id: message_id,
                file_size: file_size // Salva o tamanho do arquivo em bytes
            });

            // Pega a referência do nosso banco de dados KV
            const kv = env.ARQUIVOS_TELEGRAM;

            // Escreve a nova entrada no KV
            await kv.put(key, value);
        }

        // Responde ao Telegram com "OK" para confirmar que recebemos o webhook com sucesso
        return new Response('OK', { status: 200 });

    } catch (error) {
        // Em caso de erro, loga no console da Cloudflare e retorna um erro 500
        console.error('Webhook Error:', error);
        return new Response(`Webhook Error: ${error.message}`, { status: 500 });
    }
}

// O Cloudflare Pages procura por onRequest, onRequestGet, onRequestPost, etc.
// Adicionamos um handler genérico para cobrir qualquer outro método, se necessário.
export async function onRequest(context) {
    if (context.request.method === 'POST') {
        return await onRequestPost(context);
    }
    return new Response('OK: Use POST method for webhook.', { status: 200 });
}