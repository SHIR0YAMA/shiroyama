from flask import Flask, request, Response
from pyrogram import Client, errors
import os
import asyncio
import io
import struct

app = Flask(__name__)

API_ID = os.environ.get("API_ID")
API_HASH = os.environ.get("API_HASH")
SESSION_STRING = os.environ.get("SESSION_STRING")
CHANNEL_ID_STR = os.environ.get("CHANNEL_ID")

async def process_download_async():
    message_id_str = request.args.get('message_id')
    filename = request.args.get('filename', 'download')

    if not all([API_ID, API_HASH, SESSION_STRING, CHANNEL_ID_STR]):
        return Response("Erro de configuração: Variáveis de ambiente faltando na Vercel.", status=500)

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

        # --- A ABORDAGEM MAIS ROBUSTA ---
        
        # PASSO 1: Forçar o Pyrogram a "conhecer" o chat.
        # Isso atualiza o cache interno de peers e deve resolver o "Peer id invalid".
        chat = await user_bot.get_chat(chat_id)
        
        # PASSO 2: Agora que o chat é conhecido, pegamos a mensagem.
        message = await user_bot.get_messages(chat_id=chat.id, message_ids=message_id)
        
        if not message or not (message.document or message.video or message.audio or message.photo):
             await user_bot.stop()
             return Response(f"Erro: Mensagem com ID {message_id} não encontrada ou não contém um arquivo.", status=404)

        # PASSO 3: Fazer o download a partir do objeto da mensagem.
        in_memory_file = await user_bot.download_media(message, in_memory=True)
        
        in_memory_file.seek(0)
        await user_bot.stop()

        return Response(
            in_memory_file,
            mimetype="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=\"{filename}\""}
        )
    except errors.PeerIdInvalid as e:
        await user_bot.stop()
        return Response(f"Erro do Telegram (PeerIdInvalid): O ID do canal {chat_id} ainda é considerado inválido pela API. Verifique se a conta de usuário está no canal e se o ID está 100% correto. Detalhes: {e}", status=400)
    except Exception as e:
        if user_bot.is_connected:
            await user_bot.stop()
        return Response(f"Ocorreu um erro inesperado no servidor: {type(e).__name__} - {e}", status=500)

@app.route('/api/download', methods=['GET'])
def download_file():
    return asyncio.run(process_download_async())