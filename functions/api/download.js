// Esta função será executada quando o usuário clicar em "Baixar"
export async function onRequest(context) {
    // 1. Pega o file_id da URL (ex: /api/download?file_id=...)
    const { searchParams } = new URL(context.request.url);
    const fileId = searchParams.get('file_id');

    if (!fileId) {
        return new Response('file_id é obrigatório', { status: 400 });
    }

    // 2. Pega o token do bot das variáveis de ambiente (vamos configurar isso depois)
    const BOT_TOKEN = context.env.BOT_TOKEN;

    // 3. Pede ao Telegram informações sobre o arquivo
    const getFileUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`;
    const fileInfoResponse = await fetch(getFileUrl);
    const fileInfo = await fileInfoResponse.json();

    if (!fileInfo.ok) {
        return new Response('Não foi possível obter informações do arquivo do Telegram.', { status: 500 });
    }

    const filePath = fileInfo.result.file_path;

    // 4. Constrói a URL de download final do Telegram
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    // 5. Redireciona o navegador do usuário para o link de download do Telegram
    return Response.redirect(downloadUrl, 302);
}