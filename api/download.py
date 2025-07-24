from flask import Flask, request, Response
from pyrogram import Client, errors
import os
import asyncio
import io
import struct

app = Flask(__name__)

# Pega todas as variáveis de ambiente de uma vez
API_ID = os.environ.get("API_ID")
API_HASH = os.environ.get("API_HASH")
SESSION_STRING = os.environ.get("SESSION_STRING")
CHANNEL_ID_STR = os.environ.get("CHANNEL_ID")

async def process_download_async():
    message_id_str = request.args.get('message_id')
    filename = request.args.get('filename', 'download')

    # Validação inicial
    if not all([API_ID, API_HASH, SESSION_STRING, CHANNEL_ID_STR]):
        return Response("Erro de configuração: Uma ou mais variáveis (API_ID, API_HASH, SESSION_STRING, CHANNEL_ID) não estão definidas na Vercel.", status=500)

    try:
        message_id = int(message_id_str)
        chat_id = int(CHANNEL_ID_STR)
    except (ValueError, TypeError):
        return Response("Erro: 'message_id' ou 'CHANNEL_ID' inválidos.", status=400)

    user_bot = Client(
        "my_account",
        api_id=int(API_ID),
        api_hash=API_HASH,
        session_string=SESSION_STRING
    )

    try:
        await user_bot.start()

        # --- CORREÇÃO FINAL: A ABORDAGEM CORRETA DE DOIS PASSOS ---
        
        # PASSO 1: Pegar o objeto da mensagem. Esta é a função que precisa do chat_id.
        message = await user_bot.get_messages(chat_id=chat_id, message_ids=message_id)
        
        # Verifica se a mensagem foi encontrada e se tem mídia para baixar
        if not message or not (message.document or message.video or message.audio or message.photo):
             await user_bot.stop()
             return Response(f"Erro: Mensagem com ID {message_id} não encontrada no canal {chat_id}, ou não contém um arquivo para baixar.", status=404)

        # PASSO 2: Fazer o download passando o OBJETO da mensagem, não o ID.
        in_memory_file = await user_bot.download_media(message, in_memory=True)
        
        in_memory_file.seek(0)
        await user_bot.stop()

        return Response(
            in_memory_file,
            mimetype="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=\"{filename}\""}
        )
    except errors.BadRequest as e:
        await user_bot.stop()
        return Response(f"Erro do Telegram (BadRequest): Não foi possível encontrar a mensagem. Verifique se a message_id e o CHANNEL_ID estão corretos. Detalhes: {e}", status=404)
    except Exception as e:
        if user_bot.is_connected:
            await user_bot.stop()
        return Response(f"Ocorreu um erro inesperado no servidor: {type(e).__name__} - {e}", status=500)

@app.route('/api/download', methods=['GET'])
def download_file():
    return asyncio.run(process_download_async())