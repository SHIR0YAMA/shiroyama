from flask import Flask, request, Response
from pyrogram import Client, errors
import os
import asyncio
import io

# Inicializa o aplicativo Flask, que é o padrão que a Vercel espera
app = Flask(__name__)

# --- Pegando os segredos das variáveis de ambiente na Vercel ---
API_ID = os.environ.get("API_ID")
API_HASH = os.environ.get("API_HASH")
SESSION_STRING = os.environ.get("SESSION_STRING")

# --- Função principal que a Vercel irá chamar ---
@app.route('/api/download', methods=['GET'])
def handler():
    # A Vercel gerencia o loop de eventos, então podemos chamar diretamente nossa função async
    return asyncio.run(process_download())

# --- Função que contém a lógica de download ---
async def process_download():
    # Pega os parâmetros da URL (ex: ?message_id=123&filename=teste.zip)
    message_id_str = request.args.get('message_id')
    filename = request.args.get('filename', 'download')

    # Validação de entrada
    if not all([API_ID, API_HASH, SESSION_STRING]):
        return Response("Erro de configuração: Variáveis de ambiente (API_ID, API_HASH, SESSION_STRING) não foram definidas no servidor Vercel.", status=500)

    if not message_id_str:
        return Response("Erro: O parâmetro 'message_id' é obrigatório na URL.", status=400)
    
    try:
        message_id = int(message_id_str)
    except ValueError:
        return Response("Erro: O 'message_id' deve ser um número.", status=400)

    # Inicializa o cliente Pyrogram com a string de sessão
    # Isso evita ter que fazer login a cada vez
    user_bot = Client(
        "my_account",
        api_id=int(API_ID),
        api_hash=API_HASH,
        session_string=SESSION_STRING
    )

    try:
        # Inicia a conexão com o Telegram
        await user_bot.start()
        
        # Faz o download do arquivo do Telegram para a memória RAM do servidor
        # É mais eficiente que salvar em disco
        in_memory_file = await user_bot.download_media(message_id, in_memory=True)
        
        # Volta o "cursor" do arquivo para o início para que ele possa ser lido do começo
        in_memory_file.seek(0)
        
        # Desconecta do Telegram assim que o download para o servidor terminar
        await user_bot.stop()

        # Monta a resposta final que será enviada para o navegador do usuário
        return Response(
            in_memory_file,
            mimetype="application/octet-stream", # Tipo genérico para forçar o download
            headers={"Content-Disposition": f"attachment; filename=\"{filename}\""}
        )

    except errors.exceptions.base.BadRequest as e:
        # Erro comum se a message_id for inválida ou o arquivo não existir mais
        await user_bot.stop()
        return Response(f"Erro do Telegram: Não foi possível encontrar a mensagem ou o arquivo. Verifique se a message_id está correta. Detalhes: {e}", status=404)
    except Exception as e:
        # Captura qualquer outro erro inesperado
        if user_bot.is_connected:
            await user_bot.stop()
        return Response(f"Ocorreu um erro inesperado no servidor: {e}", status=500)