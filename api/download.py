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
        # --- A MÁGICA COMEÇA AQUI ---
        # Converte o chat_id para o formato de link (remove o -100)
        if CHANNEL_ID_STR.startswith("-100"):
            link_chat_id = CHANNEL_ID_STR[4:]
        else:
            # Para o caso de já estar no formato correto ou ser um ID diferente
            link_chat_id = CHANNEL_ID_STR.lstrip('-')
            
        # Constrói o link direto para a mensagem
        message_link = f"https://t.me/c/{link_chat_id}/{message_id}"

    except (ValueError, TypeError):
        return Response("Erro: 'message_id' ou 'CHANNEL_ID' inválidos.", status=400)

    user_bot = Client("my_account", api_id=int(API_ID), api_hash=API_HASH, session_string=SESSION_STRING)

    try:
        await user_bot.start()

        # --- USAREMOS O LINK PARA ENCONTRAR A MENSAGEM ---
        # Este método força o Telegram a resolver o peer e encontrar a mensagem.
        message = await user_bot.get_messages(message_link)
        
        if not message or not (message.document or message.video or message.audio or message.photo):
             await user_bot.stop()
             return Response(f"Erro: Não foi possível encontrar a mensagem através do link {message_link}, ou ela não contém um arquivo.", status=404)

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
        return Response(f"Erro do Telegram (BadRequest): O link da mensagem parece inválido. Detalhes: {e}", status=404)
    except Exception as e:
        if user_bot.is_connected:
            await user_bot.stop()
        return Response(f"Ocorreu um erro inesperado no servidor: {type(e).__name__} - {e}", status=500)

@app.route('/api/download', methods=['GET'])
def download_file():
    return asyncio.run(process_download_async())