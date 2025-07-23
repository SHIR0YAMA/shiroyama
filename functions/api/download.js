// functions/api/download.js

export async function onRequest(context) {
    const { searchParams } = new URL(context.request.url);
    const fileId = searchParams.get('file_id');
    // MUDANÇA AQUI: Pegamos o nome do arquivo da URL
    const filename = searchParams.get('filename') || 'downloaded-file';

    if (!fileId) {
        return new Response('file_id é obrigatório', { status: 400 });
    }

    const BOT_TOKEN = context.env.BOT_TOKEN;

    const getFileUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`;
    const fileInfoResponse = await fetch(getFileUrl);
    const fileInfo = await fileInfoResponse.json();

    if (!fileInfo.ok) {
        // Esta é a mensagem que você viu para arquivos grandes
        return new Response('Não foi possível obter informações do arquivo do Telegram.', { status: 500 });
    }

    const filePath = fileInfo.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    // --- MUDANÇA PRINCIPAL: Deixamos de redirecionar e viramos um proxy ---

    // 1. Buscamos o arquivo do Telegram para dentro do nosso Worker
    const telegramFileResponse = await fetch(downloadUrl);

    // 2. Criamos novos cabeçalhos para a nossa resposta
    const headers = new Headers();
    // Copiamos o tipo de conteúdo (ex: "image/jpeg") da resposta do Telegram
    headers.set('Content-Type', telegramFileResponse.headers.get('Content-Type'));
    // Copiamos o tamanho do arquivo
    headers.set('Content-Length', telegramFileResponse.headers.get('Content-Length'));
    // ESTA É A MÁGICA: Definimos o nome do arquivo para o download
    headers.set('Content-Disposition', `attachment; filename="${decodeURIComponent(filename)}"`);

    // 3. Retornamos uma nova resposta com o corpo do arquivo e nossos cabeçalhos
    return new Response(telegramFileResponse.body, {
        status: 200,
        headers: headers
    });
}