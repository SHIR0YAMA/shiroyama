from flask import Flask, request, Response
from pyrogram import Client, errors
import os
import asyncio
import io

app = Flask(__name__)

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
    # --- CORREÇÃO AQUI ---
    # Usamos a exceção correta, que é 'BadRequest' diretamente do módulo 'errors'.
    except errors.BadRequest as e:
        await user_bot.stop()
        return Response(f"Erro do Telegram (BadRequest): Não foi possível encontrar a mensagem ou o arquivo. Verifique se a message_id está correta. Detalhes: {e}", status=404)
    # --- CORREÇÃO AQUI ---
    # Captura o erro de sessão inválida separadamente para um diagnóstico mais claro.
    except (TypeError, struct.error) as e:
         if user_bot.is_connected:
            await user_bot.stop()
         return Response(f"Erro de Sessão: A SESSION_STRING parece inválida ou corrompida. Por favor, gere uma nova e atualize na Vercel. Detalhes: {e}", status=500)
    except Exception as e:
        if user_bot.is_connected:
            await user_bot.stop()
        return Response(f"Ocorreu um erro inesperado no servidor: {type(e).__name__} - {e}", status=500)

@app.route('/api/download', methods=['GET'])
def download_file():
    return asyncio.run(process_download_async())