from flask import Flask, request, Response
from pyrogram import Client, errors
import os
import asyncio
import io

# Inicializa o aplicativo Flask
app = Flask(__name__)

# --- O código do seu app continua aqui... ---
# (O resto do seu código, desde a linha API_ID = ... até o final da função process_download, permanece o mesmo)
# Eu vou colar o código completo abaixo para garantir.

# --- Pegando os segredos das variáveis de ambiente na Vercel ---
API_ID = os.environ.get("API_ID")
API_HASH = os.environ.get("API_HASH")
SESSION_STRING = os.environ.get("SESSION_STRING")

async def process_download_async():
    message_id_str = request.args.get('message_id')
    filename = request.args.get('filename', 'download')

    if not all([API_ID, API_HASH, SESSION_STRING]):
        return Response("Erro de configuração: Variáveis de ambiente (API_ID, API_HASH, SESSION_STRING) não foram definidas no servidor Vercel.", status=500)

    if not message_id_str:
        return Response("Erro: O parâmetro 'message_id' é obrigatório na URL.", status=400)
    
    try:
        message_id = int(message_id_str)
    except ValueError:
        return Response("Erro: O 'message_id' deve ser um número.", status=400)

    user_bot = Client(
        "my_account",
        api_id=int(API_ID),
        api_hash=API_HASH,
        session_string=SESSION_STRING
    )

    try:
        await user_bot.start()
        in_memory_file = await user_bot.download_media(message_id, in_memory=True)
        in_memory_file.seek(0)
        await user_bot.stop()

        return Response(
            in_memory_file,
            mimetype="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=\"{filename}\""}
        )
    except errors.exceptions.base.BadRequest as e:
        await user_bot.stop()
        return Response(f"Erro do Telegram: Não foi possível encontrar a mensagem ou o arquivo. Verifique se a message_id está correta. Detalhes: {e}", status=404)
    except Exception as e:
        if user_bot.is_connected:
            await user_bot.stop()
        return Response(f"Ocorreu um erro inesperado no servidor: {e}", status=500)

# --- A rota da nossa API ---
# Esta é a função que a Vercel irá encontrar e executar.
@app.route('/api/download', methods=['GET'])
def download_file():
    return asyncio.run(process_download_async())