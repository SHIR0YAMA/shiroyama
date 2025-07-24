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
        return Response("Erro de configuração: Uma ou mais variáveis (API_ID, API_HASH, SESSION_STRING, CHANNEL_ID) não estão definidas na Vercel.", status=500)

    try:
        message_id = int(message_id_str)
        chat_id = int(CHANNEL_ID_STR)
    except (ValueError, TypeError):
        return Response("Erro: 'message_id' ou 'CHANNEL_ID' inválidos.", status=400)

    user_bot = Client("my_account", api_id=int(API_ID), api_hash=API_HASH, session_string=SESSION_STRING)

    try:
        await user_bot.start()

        # --- CORREÇÃO FINAL E MAIS ROBUSTA ---
        # A forma mais direta de baixar é passando o chat_id e message_id JUNTOS.
        # Pyrogram vai construir o link internamente e fazer o download.
        in_memory_file = await user_bot.download_media(chat_id=chat_id, message_id=message_id, in_memory=True)
        
        in_memory_file.seek(0)
        await user_bot.stop()

        return Response(
            in_memory_file,
            mimetype="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=\"{filename}\""}
        )
    except errors.ChannelInvalid as e:
        await user_bot.stop()
        return Response(f"Erro do Telegram (ChannelInvalid): O ID do canal/grupo parece inválido. Verifique o CHANNEL_ID. Detalhes: {e}", status=404)
    except errors.BadRequest as e:
        await user_bot.stop()
        return Response(f"Erro do Telegram (BadRequest): Não foi possível encontrar a mensagem. Verifique se a message_id está correta para este canal. Detalhes: {e}", status=404)
    except Exception as e:
        if user_bot.is_connected:
            await user_bot.stop()
        return Response(f"Ocorreu um erro inesperado no servidor: {type(e).__name__} - {e}", status=500)

@app.route('/api/download', methods=['GET'])
def download_file():
    return asyncio.run(process_download_async())