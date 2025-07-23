# --- INÍCIO DO BLOCO DE VERIFICAÇÃO DE DEPENDÊNCIAS (BOOTSTRAP) ---
# Este bloco é executado primeiro e usa apenas bibliotecas padrão do Python.
import sys
import subprocess
import importlib.util
import os

def verificar_e_instalar_dependencias():
    """
    Verifica se as dependências necessárias estão instaladas.
    Se não estiverem, tenta instalá-las via pip.
    Retorna True se tudo estiver OK para continuar, False caso contrário.
    """
    print("Verificando dependências necessárias...")
    # Mapeia o nome do módulo (para import) com o nome do pacote (para pip)
    dependencias = {
        "flet": "flet",
        "pyrogram": "pyrogram",
        "tgcrypto": "tgcrypto",
        "pymediainfo": "pymediainfo"
    }
    
    # Lista de pacotes que não foram encontrados
    faltando = [pkg for mod, pkg in dependencias.items() if importlib.util.find_spec(mod) is None]

    if not faltando:
        print("Dependências OK.")
        return True  # Tudo certo, pode continuar

    print(f"Dependências faltantes detectadas: {', '.join(faltando)}")
    print("Tentando instalar via pip...")

    # Tenta instalar todos os pacotes faltantes de uma vez
    try:
        # Usamos sys.executable para garantir que estamos usando o pip do interpretador Python correto
        subprocess.check_call([sys.executable, "-m", "pip", "install", *faltando])
        print("\n" + "="*50)
        print("   DEPENDÊNCIAS INSTALADAS COM SUCESSO!")
        print("   Por favor, execute o script novamente para carregar as novas bibliotecas.")
        print("="*50 + "\n")
        return False # A instalação foi bem-sucedida, mas precisa reiniciar
    except subprocess.CalledProcessError as e:
        print("\n" + "!"*50)
        print("   ERRO CRÍTICO AO INSTALAR DEPENDÊNCIAS!")
        print(f"   Falha no comando pip: {e}")
        print(f"   Por favor, instale-as manualmente no seu terminal com o comando:")
        print(f"   pip install {' '.join(faltando)}")
        print("!"*50 + "\n")
        return False # A instalação falhou, não pode continuar

# --- PONTO DE ENTRADA DO SCRIPT ---
if __name__ == "__main__":
    # 1. Executa a verificação PRIMEIRO.
    if not verificar_e_instalar_dependencias():
        # Se a função retornar False, significa que as dependências
        # ou foram recém-instaladas (precisa reiniciar) ou falharam na instalação.
        # Em ambos os casos, encerramos o script.
        input("Pressione Enter para sair...")
        sys.exit(1)

# Se o script chegou até aqui, todas as dependências estão presentes.
# Agora podemos importar tudo com segurança.
# --- FIM DO BLOCO DE VERIFICAÇÃO ---


# --- IMPORTS PRINCIPAIS (MOVEMOS PARA CÁ) ---
import flet as ft
import json
import asyncio
import time
import ctypes
import multiprocessing
import multiprocessing.pool
from queue import Empty
import shutil
import traceback
import random
import tempfile
from functools import partial

# --- Verificação do FFmpeg (Pode ficar aqui, pois não depende de bibliotecas externas) ---
def verificar_ffmpeg():
    """Verifica se o FFmpeg está instalado e acessível no PATH do sistema."""
    print("Verificando a presença do FFmpeg...")
    try:
        # creationflags evita que uma janela de console apareça no Windows
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True, text=True, creationflags=flags)
        print("FFmpeg OK.")
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("\n" + "="*60)
        print("  AVISO IMPORTANTE: FFmpeg não encontrado!")
        print("  A conversão de mídia está desativada sem ele.")
        print("  Por favor, instale-o e adicione-o ao PATH do seu sistema.")
        print("  Downloads: https://ffmpeg.org/download.html")
        print("="*60 + "\n")
        return False

# --- Código principal (O RESTO DO SEU CÓDIGO PERMANECE IGUAL) ---
from pyrogram import Client
from pyrogram.enums import ParseMode, MessageMediaType
from pyrogram.types import InputMediaPhoto, InputMediaVideo, InputMediaAudio, InputMediaDocument
from pyrogram.errors import (
    SessionPasswordNeeded, PhoneCodeInvalid, PasswordHashInvalid,
    UserDeactivatedBan, AuthKeyUnregistered, PhoneCodeExpired, PhoneNumberInvalid,
    MediaCaptionTooLong, FloodWait, ApiIdInvalid, ApiIdPublishedFlood
)

try:
    from pymediainfo import MediaInfo
except ImportError:
    MediaInfo = None

CONFIG_FILE = "telegram_uploader_config.json"
DEFAULT_SENDING_PROFILE_NAME = "Perfil de Envio Padrão"
DEFAULT_AUTH_PROFILE_NAME = "Conta Padrão"
TEMP_SESSION_NAME = "_temp_auth_session_"

def get_default_auth_profile():
    return {
        "api_id": "", "api_hash": "", "session_name": "", 
        "auth_type": "user", "bot_token": "", 
        "log_channel_id": "", "delete_from_log": True
    }

def get_default_sending_profile():
    return {
        "chat_id": "", "topic_id": "0",
        "sort_order": "nome_asc", "send_as_media": False,
        "include_subfolders": False, "group_files": False,
        "caption_mode": "filename", "global_caption": "",
        "album_caption_mode": "none", "album_global_caption": "",
        "concurrency_limit": "3", "custom_concurrency": "",
        "conversion_limit": "1", "custom_conversion_concurrency": "", # NOVA CONFIG
        "ffmpeg_preset": "fast",
        "hw_accel": "cpu",
        "quality_preset": "medio",
        "custom_quality_value": "23",
        "use_watermark": False,
        "watermark_path": "",
        "watermark_position": "bottom_right",
        "watermark_scale": "10",
    }

def carregar_configuracoes():
    default_new_data = {
        "auth_profiles": {
            DEFAULT_AUTH_PROFILE_NAME: get_default_auth_profile()
        },
        "active_auth_profile_name": DEFAULT_AUTH_PROFILE_NAME,
        "sending_profiles": {
            DEFAULT_SENDING_PROFILE_NAME: get_default_sending_profile()
        },
        "active_sending_profile_name": DEFAULT_SENDING_PROFILE_NAME
    }
    if not os.path.exists(CONFIG_FILE):
        return default_new_data
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        is_migrated = False
        
        # Seção de migração de perfis de autenticação
        if "auth_profiles" not in data or not data["auth_profiles"]:
            data["auth_profiles"] = {DEFAULT_AUTH_PROFILE_NAME: get_default_auth_profile()}
            data["active_auth_profile_name"] = DEFAULT_AUTH_PROFILE_NAME
        else:
            auth_defaults = get_default_auth_profile()
            for name, profile in data["auth_profiles"].items():
                for key, default_value in auth_defaults.items():
                    if key not in profile:
                        profile[key] = default_value
                        is_migrated = True

        # Seção de migração de perfis de envio
        if "sending_profiles" not in data or not data["sending_profiles"]:
            data["sending_profiles"] = {DEFAULT_SENDING_PROFILE_NAME: get_default_sending_profile()}
            data["active_sending_profile_name"] = DEFAULT_SENDING_PROFILE_NAME
        else:
            sending_defaults = get_default_sending_profile()
            for name, profile in data.get("sending_profiles", {}).items():
                for key, default_value in sending_defaults.items():
                    if key not in profile:
                        profile[key] = default_value
                        is_migrated = True
        
        if is_migrated:
            print("LOG: Estrutura de configuração validada e/ou atualizada. Salvando.")
            salvar_configuracoes(data)
        return data
    except (json.JSONDecodeError, KeyError) as e:
        print(f"ERRO CRÍTICO ao carregar ou migrar '{CONFIG_FILE}' ({type(e).__name__}: {e}). Usando configurações padrão.")
        traceback.print_exc()
        return default_new_data


def salvar_configuracoes(configs_data):
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(configs_data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"ERRO ao salvar configurações: {e}")

def is_admin():
    try: return ctypes.windll.shell32.IsUserAnAdmin()
    except: return False

def request_admin_privileges():
    if os.name == 'nt' and not is_admin():
        print("Tentando re-executar como administrador...")
        script = os.path.abspath(sys.argv[0])
        params = ' '.join([f'"{p}"' for p in sys.argv[1:]])
        try:
            ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, f'"{script}" {params}', None, 1)
            sys.exit(0)
        except Exception as e:
            print(f"Falha ao elevar privilégios: {e}\nPor favor, execute o script como administrador.")
            input("Pressione Enter para sair..."); sys.exit(1)
    return True

# ================================================================================
# BLOCO DE LÓGICA DE UPLOAD - NOVA ARQUITETURA DE WORKERS
# ================================================================================
# Essas funções precisam ser de nível superior para serem "pickleable" pelo multiprocessing

# --- FUNÇÕES AUXILIARES E WORKERS ---

def _get_quality_params_for_video(resolution_height, preset_key, hw_accel, custom_value):
    QUALITY_MAP = {
        480: {"muito_baixo": {"crf": "28", "bitrate": "500"}, "baixo": {"crf": "26", "bitrate": "750"}, "medio": {"crf": "24", "bitrate": "1000"}, "alto": {"crf": "22", "bitrate": "1500"}, "muito_alto": {"crf": "20", "bitrate": "2000"}},
        720: {"muito_baixo": {"crf": "27", "bitrate": "1000"}, "baixo": {"crf": "25", "bitrate": "1500"}, "medio": {"crf": "23", "bitrate": "2000"}, "alto": {"crf": "21", "bitrate": "3000"}, "muito_alto": {"crf": "19", "bitrate": "4000"}},
        1080: {"muito_baixo": {"crf": "26", "bitrate": "1500"}, "baixo": {"crf": "24", "bitrate": "2500"}, "medio": {"crf": "22", "bitrate": "3500"}, "alto": {"crf": "20", "bitrate": "5000"}, "muito_alto": {"crf": "18", "bitrate": "6500"}},
        2160: {"muito_baixo": {"crf": "26", "bitrate": "3000"}, "baixo": {"crf": "24", "bitrate": "4000"}, "medio": {"crf": "22", "bitrate": "6000"}, "alto": {"crf": "20", "bitrate": "8000"}, "muito_alto": {"crf": "18", "bitrate": "10000"}}
    }
    quality_mode = 'crf' if hw_accel == 'cpu' else 'bitrate'
    if preset_key == "personalizado":
        value = custom_value
        if quality_mode == 'bitrate' and not value.endswith('k'):
            value = f"{value}k"
        return {"mode": quality_mode, "value": value}
    resolution_tier = next((h for h in sorted(QUALITY_MAP.keys()) if resolution_height <= h), max(QUALITY_MAP.keys()))
    params = QUALITY_MAP[resolution_tier].get(preset_key, QUALITY_MAP[resolution_tier]["medio"])
    return {"mode": quality_mode, "value": params[quality_mode]}

def obter_media_info(caminho):
    try:
        if not MediaInfo: return None, None, 0, 0, 0, None
        media_info = MediaInfo.parse(caminho)
        video_track = next((t for t in media_info.video_tracks), None)
        audio_track = next((t for t in media_info.audio_tracks), None)
        width = video_track.width if video_track else 0
        height = video_track.height if video_track else 0
        duration = int(float(video_track.duration) / 1000) if video_track and video_track.duration else 0
        v_codec_str = (video_track.format.lower() if video_track and video_track.format else "")
        v_codec = 'h264' if 'avc' in v_codec_str else v_codec_str
        a_codec = audio_track.format.lower() if audio_track else None
        pixel_format = getattr(video_track, 'pixel_format', None) if video_track else None
        return v_codec, a_codec, width, height, duration, pixel_format
    except Exception as e:
        print(f"AVISO: Falha ao obter metadados de '{caminho}': {e}")
        return None, None, 0, 0, 0, None

def conversion_worker(file_path: str, file_index: int, sending_profile: dict, temp_dir: str): # <<< MUDANÇA: Novo parâmetro temp_dir
    """
    Worker dedicado APENAS para a conversão de arquivos com FFmpeg.
    Não interage com o Telegram.
    """
    try:
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        v_codec, a_codec, width, height, _, pixel_format = obter_media_info(file_path)

        # <<< MUDANÇA: Usar temp_dir para todos os arquivos de saída
        temp_converted_path = os.path.join(temp_dir, f"{base_name}_converted_{file_index}.mp4")

        # Parâmetros da UI
        use_watermark = sending_profile.get("use_watermark", False)
        hw_accel = sending_profile.get("hw_accel", "cpu")
        
        is_10bit = pixel_format and ('10' in str(pixel_format))
        needs_video_reencode = use_watermark or (height > 1080) or v_codec not in ['h264', 'avc'] or is_10bit
        needs_audio_reencode = a_codec not in ['aac', 'mp3']
        
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        
        audio_is_preconverted = False
        temp_audio_path = None
        if needs_audio_reencode and a_codec is not None:
            # <<< MUDANÇA: Usar temp_dir para o áudio
            temp_audio_path = os.path.join(temp_dir, f"{base_name}_temp_audio_{file_index}.aac")
            cmd_audio = ['ffmpeg', '-y', '-i', file_path, '-map', '0:a:0?', '-vn', '-sn', '-c:a', 'aac', '-b:a', '192k', temp_audio_path]
            subprocess.run(cmd_audio, check=True, capture_output=True, text=True, creationflags=flags)
            audio_is_preconverted = True

        cmd_final = ['ffmpeg', '-y', '-i', file_path]
        inputs = [file_path]
        
        if use_watermark and sending_profile.get("watermark_path") and os.path.exists(sending_profile.get("watermark_path")):
            cmd_final.extend(['-i', sending_profile["watermark_path"]])
            inputs.append(sending_profile["watermark_path"])
        
        if audio_is_preconverted:
            cmd_final.extend(['-i', temp_audio_path])
            inputs.append(temp_audio_path)

        video_filters = []
        if needs_video_reencode:
            if height > 1080: video_filters.append("scale=-2:1080")
            video_filters.append("format=yuv420p")

        if use_watermark and sending_profile.get("watermark_path") and os.path.exists(sending_profile.get("watermark_path")):
            watermark_input_idx = inputs.index(sending_profile["watermark_path"])
            scale = int(sending_profile.get("watermark_scale", 10)) / 100.0
            pos_map = {"top_left": "10:10", "top_right": "main_w-overlay_w-10:10", "bottom_left": "10:main_h-overlay_h-10", "bottom_right": "main_w-overlay_w-10:main_h-overlay_h-10", "center": "(main_w-overlay_w)/2:(main_h-overlay_h)/2"}
            overlay_pos = pos_map.get(sending_profile.get("watermark_position"), "main_w-overlay_w-10:main_h-overlay_h-10")
            
            base_chain = f"[0:v]{','.join(video_filters)}[base]" if video_filters else "[0:v]null[base]"
            filter_chain = f"{base_chain};[{watermark_input_idx}:v]format=yuva420p,scale=w='iw*{scale}':h=-1[logo];[base][logo]overlay={overlay_pos}[outv]"
            cmd_final.extend(['-filter_complex', filter_chain, '-map', '[outv]'])
        else:
            if video_filters: cmd_final.extend(['-vf', ",".join(video_filters)])
            cmd_final.extend(['-map', '0:v:0'])

        quality_params = _get_quality_params_for_video(height, sending_profile.get("quality_preset"), hw_accel, sending_profile.get("custom_quality_value"))
        if needs_video_reencode:
            encoder_map = {'nvidia': 'h264_nvenc', 'amd': 'h264_amf', 'intel': 'h264_qsv'}
            if hw_accel != 'cpu' and encoder_map.get(hw_accel):
                cmd_final.extend(['-c:v', encoder_map.get(hw_accel), '-b:v', quality_params['value'].replace('k', '') + 'k'])
            else:
                cmd_final.extend(['-c:v', 'libx264', '-preset', sending_profile.get("ffmpeg_preset"), '-crf', quality_params['value']])
        else:
            cmd_final.extend(['-c:v', 'copy'])

        if audio_is_preconverted:
            audio_input_idx = inputs.index(temp_audio_path)
            cmd_final.extend(['-map', f'{audio_input_idx}:a:0', '-c:a', 'copy'])
        elif needs_audio_reencode:
            cmd_final.extend(['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k'])
        else:
            cmd_final.extend(['-map', '0:a:0?', '-c:a', 'copy'])
            
        cmd_final.extend(['-movflags', '+faststart', temp_converted_path])
        
        # Removido o print do comando para não poluir o console, mas você pode reativá-lo se precisar depurar
        # print(f"CONVERSION CMD (idx: {file_index}): {' '.join(cmd_final)}")
        subprocess.run(cmd_final, check=True, capture_output=True, text=True, creationflags=flags)

        if temp_audio_path and os.path.exists(temp_audio_path):
            try: os.remove(temp_audio_path)
            except OSError: pass

        return {"status": "success", "original_path": file_path, "converted_path": temp_converted_path, "index": file_index}

    except subprocess.CalledProcessError as e:
        error_msg = f"FFmpeg falhou.\nStderr: {e.stderr}"
        return {"status": "failed", "original_path": file_path, "error": error_msg, "index": file_index}
    except Exception as e:
        return {"status": "failed", "original_path": file_path, "error": f"Erro inesperado na conversão: {e}", "index": file_index}

def upload_worker(file_to_upload: str, file_index: int, original_path: str, session_path: str, auth_profile: dict, log_channel_id: int, results_queue: multiprocessing.Queue):
    """
    Worker dedicado APENAS para o upload de arquivos para o Telegram.
    Não faz conversão.
    """
    app = None
    try:
        # <<< MUDANÇA CRÍTICA: Corrigindo a inicialização do Cliente Pyrogram
        # 1. Extrai o diretório de trabalho do caminho completo da sessão
        workdir = os.path.dirname(session_path)
        # 2. Extrai o nome da sessão SEM a extensão .session
        session_name_only = os.path.splitext(os.path.basename(session_path))[0]
        
        # 3. Inicializa o cliente com o nome e o workdir corretos.
        #    O Pyrogram irá procurar por "session_name_only.session" dentro de "workdir".
        #    Como o arquivo já existe (foi clonado), ele não pedirá login.
        app = Client(
            session_name_only, 
            api_id=int(auth_profile["api_id"]), 
            api_hash=auth_profile["api_hash"],
            workdir=workdir, 
            no_updates=True
        )
        app.start()

        max_retries = 3
        for attempt in range(max_retries):
            try:
                last_update_time = 0
                def progress_callback(current, total):
                    nonlocal last_update_time
                    now = time.time()
                    if now - last_update_time > 0.25:
                        last_update_time = now
                        results_queue.put({"type": "progress", "index": file_index, "value": current / total})

                upload_ext = os.path.splitext(file_to_upload)[1].lower()
                is_video = upload_ext in ['.mp4', '.mkv', '.mov', '.avi', '.webm']
                is_photo = upload_ext in ['.jpg', '.jpeg', '.png', '.webp', '.gif']
                is_audio = upload_ext in ['.mp3', '.m4a', '.flac', '.opus', '.ogg']

                if is_video:
                    v_codec, a_codec, width, height, duration, _ = obter_media_info(file_to_upload)
                    # Cria a thumbnail no mesmo diretório temporário do worker
                    thumbnail_path = os.path.join(workdir, f"{os.path.basename(file_to_upload)}_thumb.jpg")
                    try:
                        subprocess.run(['ffmpeg', '-y', '-i', file_to_upload, '-ss', '00:00:05', '-vframes', '1', '-q:v', '3', thumbnail_path], check=True, capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                    except Exception: thumbnail_path = None
                    sent_message = app.send_video(log_channel_id, file_to_upload, thumb=thumbnail_path, width=width, height=height, duration=duration, progress=progress_callback)
                    if thumbnail_path and os.path.exists(thumbnail_path): os.remove(thumbnail_path)
                elif is_photo:
                    sent_message = app.send_photo(log_channel_id, file_to_upload, progress=progress_callback)
                elif is_audio:
                    sent_message = app.send_audio(log_channel_id, file_to_upload, progress=progress_callback)
                else:
                    sent_message = app.send_document(log_channel_id, file_to_upload, force_document=True, progress=progress_callback)
                
                media = sent_message.video or sent_message.audio or sent_message.photo or sent_message.document
                if not media: raise Exception("Mídia não encontrada na mensagem enviada.")

                media_type = sent_message.media.name.lower() if sent_message.media else 'document'
                return {"status": "success", "index": file_index, "file_id": media.file_id, "message_id": sent_message.id, "media_type": media_type, "original_path": original_path}

            except FloodWait as e:
                wait_time = e.value + 2
                results_queue.put({"type": "retry", "index": file_index, "error": f"FloodWait ({wait_time}s)", "attempt": attempt + 2})
                time.sleep(wait_time)
            except Exception as e:
                if attempt < max_retries - 1:
                    results_queue.put({"type": "retry", "index": file_index, "error": str(e), "attempt": attempt + 2})
                    time.sleep(5)
                else:
                    raise e
        
    except Exception as e:
        tb_str = traceback.format_exc()
        print(f"ERRO NO UPLOAD WORKER (idx: {file_index}):\n{tb_str}")
        return {"status": "failed", "index": file_index, "error": f"{type(e).__name__}: {e}", "original_path": original_path}
    finally:
        if app and app.is_connected:
            app.stop()

# Substitua a sua função inteira por esta.
async def processo_de_upload_telegram(page: ft.Page, auth_profile: dict, sending_profile: dict, lista_de_arquivos_caminhos: list, upload_concurrency: int, conversion_concurrency: int, ui_controls: dict, app_state: dict):
    log_func = ui_controls["log_func"]
    send_as_media = sending_profile.get("send_as_media", False)
    group_files = sending_profile.get("group_files", False)
    delete_from_log = auth_profile.get("delete_from_log", True)
    log_channel_id = int(auth_profile["log_channel_id"])
    
    manager = multiprocessing.Manager()
    results_queue_mp = manager.Queue()
    
    temp_dir = tempfile.mkdtemp(prefix="telegram_uploader_")
    # <<< CORREÇÃO FINAL: Usando uma cor sólida que existe, sem funções inventadas.
    await log_func(f"Diretório temporário criado: {temp_dir}", ft.Colors.GREY_500)

    progress_bars_column = ui_controls["progress_bars_column_ref"]
    progress_bars_column.controls.clear()
    
    active_ui_slots = {}
    total_files = len(lista_de_arquivos_caminhos)
    
    for i, path in enumerate(lista_de_arquivos_caminhos):
        base_name = os.path.basename(path)
        label = ft.Text(f"#{i+1} (Fila) {base_name}", expand=True, size=12, no_wrap=True, tooltip=base_name)
        progress = ft.ProgressBar(value=0, width=200, bar_height=8, color=ft.Colors.GREY, bgcolor=ft.Colors.BLACK12)
        percentage_label = ft.Text("0%", size=11, width=40, text_align=ft.TextAlign.RIGHT)
        row = ft.Row([label, progress, percentage_label], alignment=ft.MainAxisAlignment.SPACE_BETWEEN, visible=False)
        active_ui_slots[i] = {"label": label, "progress": progress, "percentage": percentage_label, "row": row}
        progress_bars_column.controls.append(row)
    page.update()

    conversion_pool = multiprocessing.Pool(processes=conversion_concurrency) if send_as_media else None
    upload_pool = multiprocessing.Pool(processes=upload_concurrency)
    
    original_session_file = f"{auth_profile['session_name']}.session"
    if not os.path.exists(original_session_file):
        await log_func("ERRO: Arquivo de sessão não encontrado!", ft.Colors.RED)
        if conversion_pool: conversion_pool.terminate()
        upload_pool.terminate()
        shutil.rmtree(temp_dir, ignore_errors=True)
        return
    
    temp_session_files = []
    for i in range(upload_concurrency):
        temp_name = f"{auth_profile['session_name']}-clone-{i}-{int(time.time())}"
        temp_file_path = os.path.join(temp_dir, f"{temp_name}.session") 
        shutil.copy(original_session_file, temp_file_path)
        temp_session_files.append(temp_file_path)
    
    session_names_for_workers = [f for f in temp_session_files]

    pending_uploads = manager.dict()
    
    def handle_result(result):
        result['type'] = 'upload_finished'
        results_queue_mp.put(result)
    
    def handle_conversion_result(result):
        if result['status'] == 'success':
            results_queue_mp.put({"type": "conversion_finished", "index": result["index"]})
            session_path = session_names_for_workers[result["index"] % upload_concurrency] # O nome da variável agora é session_path
            upload_args = (result["converted_path"], result["index"], result["original_path"], session_path, auth_profile, log_channel_id, results_queue_mp)
            upload_pool.apply_async(upload_worker, args=upload_args, callback=handle_result)
        else:
            result['type'] = 'upload_finished'
            results_queue_mp.put(result)

    files_processed_count = 0
    enviados_com_sucesso = 0
    results_buffer = {}
    next_to_send_index = 0
    media_group_buffer = []
    message_ids_to_delete_buffer = []
    group_indices_buffer = []
    app_sender = None

    try:
        app_sender = Client(auth_profile["session_name"], api_id=int(auth_profile["api_id"]), api_hash=auth_profile["api_hash"], bot_token=auth_profile.get("bot_token") or None, no_updates=True)
        await app_sender.start()
        chat_id_str = sending_profile.get("chat_id", "")
        chat_id_int = int(chat_id_str) if not chat_id_str.startswith('@') else chat_id_str
        topic_id_str = sending_profile.get("topic_id", "0")
        reply_id = int(topic_id_str) if topic_id_str and topic_id_str != "0" else None

        async def send_media_group_and_cleanup():
            nonlocal media_group_buffer, message_ids_to_delete_buffer, group_indices_buffer
            if not media_group_buffer: return
            
            try:
                album_caption_mode = sending_profile.get("album_caption_mode")
                album_caption_text = sending_profile.get("album_global_caption")
                if album_caption_mode == "album_global" and album_caption_text and media_group_buffer:
                    media_group_buffer[0].caption = f"{album_caption_text}\n\n{media_group_buffer[0].caption or ''}".strip()
                await app_sender.send_media_group(chat_id_int, media_group_buffer, reply_to_message_id=reply_id)
                await log_func(f"[Enviado Grupo] {len(media_group_buffer)} arquivos para o destino.", ft.Colors.GREEN)
                
                for idx in group_indices_buffer:
                    if idx in active_ui_slots:
                        active_ui_slots[idx]["row"].visible = False
                
                if delete_from_log and message_ids_to_delete_buffer: 
                    await app_sender.delete_messages(log_channel_id, message_ids_to_delete_buffer)
            except Exception as e: await log_func(f"ERRO ao enviar grupo: {e}", ft.Colors.RED)
            finally:
                media_group_buffer, message_ids_to_delete_buffer, group_indices_buffer = [], [], []

        for i, path in enumerate(lista_de_arquivos_caminhos):
            results_queue_mp.put({"type": "task_started", "index": i})
            
            if send_as_media:
                EXT_MEDIA = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp3', '.m4a', '.flac', '.opus', '.ogg']
                if os.path.splitext(path)[1].lower() in EXT_MEDIA:
                    conversion_args = (path, i, sending_profile, temp_dir)
                    conversion_pool.apply_async(conversion_worker, args=conversion_args, callback=handle_conversion_result)
                else:
                    session_path = session_names_for_workers[i % upload_concurrency] # O nome da variável agora é session_path
                    upload_args = (path, i, path, session_path, auth_profile, log_channel_id, results_queue_mp)
                    upload_pool.apply_async(upload_worker, args=upload_args, callback=handle_result)
            else:
                session_path = session_names_for_workers[i % upload_concurrency] # O nome da variável agora é session_path
                upload_args = (path, i, path, session_path, auth_profile, log_channel_id, results_queue_mp)
                upload_pool.apply_async(upload_worker, args=upload_args, callback=handle_result)
        
        while files_processed_count < total_files:
            if app_state["stop_all_flag"]: break

            ui_needs_update = False
            try:
                msg = results_queue_mp.get(timeout=1)
                messages_to_process = [msg]
                while not results_queue_mp.empty():
                    messages_to_process.append(results_queue_mp.get_nowait())
            except Empty:
                continue

            for msg in messages_to_process:
                msg_index = msg["index"]
                msg_type = msg.get("type")

                if msg_index in active_ui_slots:
                    ui_slot = active_ui_slots[msg_index]
                    if msg_type == "task_started":
                        ui_slot["row"].visible = True
                        ui_slot["label"].value = f"#{msg_index+1} (Processando) {os.path.basename(lista_de_arquivos_caminhos[msg_index])}"
                        ui_slot["progress"].value = None
                        ui_slot["progress"].color = ft.Colors.AMBER
                    elif msg_type == "conversion_finished":
                        ui_slot["label"].value = f"#{msg_index+1} (Enviando) {os.path.basename(lista_de_arquivos_caminhos[msg_index])}"
                        ui_slot["progress"].color = ft.Colors.BLUE
                        ui_slot["progress"].value = 0
                        ui_slot["percentage"].value = "0%"
                    elif msg_type == "progress":
                        ui_slot["progress"].value = msg["value"]
                        ui_slot["percentage"].value = f"{int(msg['value'] * 100)}%"
                    elif msg_type == "retry":
                        ui_slot["label"].value = f"#{msg_index+1} (Tentativa {msg['attempt']}) {os.path.basename(lista_de_arquivos_caminhos[msg_index])}"
                        ui_slot["progress"].color = ft.Colors.ORANGE
                    elif msg_type == "upload_finished":
                        results_buffer[msg_index] = msg
                    
                    ui_needs_update = True
            
            if ui_needs_update:
                page.update()

            while next_to_send_index in results_buffer:
                result = results_buffer.pop(next_to_send_index)
                path = result.get("original_path")
                base_name = os.path.basename(path)
                ui_slot = active_ui_slots[next_to_send_index]
                
                if result.get("status") == "success":
                    enviados_com_sucesso += 1
                    caption_text = _obter_legenda_para_arquivo_individual(path, ui_controls)
                    if group_files:
                        message_ids_to_delete_buffer.append(result["message_id"])
                        group_indices_buffer.append(next_to_send_index)
                        
                        ui_slot["label"].value = f"#{next_to_send_index+1} (Aguardando grupo)"
                        ui_slot["progress"].color = ft.Colors.PURPLE_ACCENT
                        ui_slot["progress"].value = 1
                        ui_slot["percentage"].value = "OK"
                        
                        media_type = result.get("media_type")
                        media_item = InputMediaVideo(result["file_id"], caption=caption_text) if media_type == "video" else \
                                     InputMediaPhoto(result["file_id"], caption=caption_text) if media_type == "photo" else \
                                     InputMediaAudio(result["file_id"], caption=caption_text) if media_type == "audio" else \
                                     InputMediaDocument(result["file_id"], caption=caption_text)
                        media_group_buffer.append(media_item)

                        is_last_file = (next_to_send_index == total_files - 1)
                        if len(media_group_buffer) == 10 or (is_last_file and media_group_buffer):
                            await send_media_group_and_cleanup()
                    else:
                        try:
                            await app_sender.copy_message(chat_id_int, log_channel_id, result["message_id"], caption=caption_text, reply_to_message_id=reply_id)
                            await log_func(f"[Enviado] {base_name} para o destino.", ft.Colors.GREEN)
                            if delete_from_log: await app_sender.delete_messages(log_channel_id, result["message_id"])
                        except Exception as e: await log_func(f"ERRO ao enviar '{base_name}': {e}", ft.Colors.RED)
                        ui_slot["row"].visible = False
                else:
                    await log_func(f"[FALHA] {base_name}: {result.get('error')}", ft.Colors.RED)
                    ui_slot["row"].visible = False

                files_processed_count += 1
                ui_controls["prog_total_bar_ref"].value = files_processed_count / total_files
                ui_controls["lbl_prog_total_ref"].value = f"Total: {files_processed_count}/{total_files}"
                next_to_send_index += 1
                page.update()

        if group_files and media_group_buffer: await send_media_group_and_cleanup()

    finally:
        await log_func("--- Finalizando e limpando recursos ---", ft.Colors.WHITE)
        if app_state["stop_all_flag"]:
            if conversion_pool: conversion_pool.terminate()
            upload_pool.terminate()
        else:
            if conversion_pool:
                conversion_pool.close(); conversion_pool.join()
            upload_pool.close(); upload_pool.join()
        
        if app_sender and app_sender.is_connected: await app_sender.stop()
        
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
                # <<< CORREÇÃO FINAL: Usando uma cor sólida que existe, sem funções inventadas.
                await log_func(f"Diretório temporário limpo.", ft.Colors.GREY_500)
            except Exception as e:
                await log_func(f"AVISO: Falha ao limpar diretório temporário {temp_dir}: {e}", ft.Colors.AMBER)

        await log_func(f"Total de arquivos processados com sucesso: {enviados_com_sucesso}/{total_files}")
        ui_controls["progress_bars_container_ref"].visible = False
        ui_controls["btn_start_upload_ref"].disabled = False
        ui_controls["btn_start_upload_ref"].text = "Iniciar Uploads"
        ui_controls["btn_stop_all_uploads_ref"].visible = False
        if page.controls: page.update()

def _obter_legenda_para_arquivo_individual(caminho_do_arquivo, ui_controls):
    nome_arquivo = os.path.basename(caminho_do_arquivo)
    caption_mode = ui_controls["dd_caption_mode_ref"].value
    final_caption = ""
    
    if caption_mode == "filename":
        final_caption = nome_arquivo
    elif caption_mode == "filename_no_ext":
        final_caption = os.path.splitext(nome_arquivo)[0]
    elif caption_mode == "global":
        final_caption = ui_controls["txt_global_caption_ref"].value or ""
    # Se for "none", final_caption continua vazio.
        
    return final_caption if final_caption.strip() else None

async def _coletar_e_ordenar_arquivos(path_info: dict, ui_controls: dict, log_func_ref):
    lista_de_arquivos_caminhos = []
    chk_include_subfolders = ui_controls["chk_include_subfolders_ref"]
    if path_info["type"] == "folder":
        folder_path = path_info["path"]
        if not os.path.isdir(folder_path):
            await log_func_ref(f"ERRO: Pasta inválida: {folder_path}", ft.Colors.RED); return []
        include_subfolders_active = chk_include_subfolders.value
        await log_func_ref(f"Listando arquivos em: {folder_path} ({'subpastas incluídas' if include_subfolders_active else 'apenas da raiz da pasta'})")
        if include_subfolders_active:
            for dirpath, _, filenames in os.walk(folder_path):
                for filename in filenames:
                    file_full_path = os.path.join(dirpath, filename)
                    if os.path.isfile(file_full_path): lista_de_arquivos_caminhos.append(file_full_path)
        else:
            for nome_arquivo_temp in os.listdir(folder_path):
                file_full_path = os.path.join(folder_path, nome_arquivo_temp)
                if os.path.isfile(file_full_path): lista_de_arquivos_caminhos.append(file_full_path)
    elif path_info["type"] == "files":
        lista_de_arquivos_caminhos = [p for p in path_info["paths"] if os.path.isfile(p)]
        if len(lista_de_arquivos_caminhos) != len(path_info["paths"]): await log_message_async("AVISO: Alguns arquivos individuais foram ignorados.", ft.Colors.YELLOW)
    if not lista_de_arquivos_caminhos: return []
    sort_preference = ui_controls.get("dd_sort_order_ref").value
    key_func, reverse_order = (None, False)
    if sort_preference == "tamanho_desc": key_func, reverse_order = (os.path.getsize, True)
    elif sort_preference == "tamanho_asc": key_func, reverse_order = (os.path.getsize, False)
    elif sort_preference == "data_mod_desc": key_func, reverse_order = (os.path.getmtime, True)
    elif sort_preference == "data_mod_asc": key_func, reverse_order = (os.path.getmtime, False)
    try:
        if key_func: lista_de_arquivos_caminhos.sort(key=key_func, reverse=reverse_order)
        else: lista_de_arquivos_caminhos.sort()
    except FileNotFoundError:
        await log_func_ref("ERRO: Um ou mais arquivos não foram encontrados durante a ordenação.", ft.Colors.RED); return []
    return lista_de_arquivos_caminhos

async def main(page: ft.Page):
    page.title = "Telegram File Uploader by Shiroyama"
    page.window_width = 820
    page.window_height = 1200
    page.vertical_alignment = ft.MainAxisAlignment.START
    page.theme_mode = ft.ThemeMode.DARK

    configs_data = carregar_configuracoes()
    ffmpeg_disponivel = verificar_ffmpeg()

    app_state = { "current_upload_task": None, "stop_all_flag": False, "individual_files_paths": None }

    async def log_message_async(message, color=None, duration=None):
        print(f"LOG UI: {message}")
        log_list_view.controls.append(ft.Text(message, color=color, selectable=True, font_family="Consolas", size=12))
        if len(log_list_view.controls) > 200: log_list_view.controls.pop(0)
        if page.controls:
            try:
                page.update()
                if duration: page.snack_bar = ft.SnackBar(content=ft.Text(message, color=color), open=True)
            except Exception: pass

    def update_auth_dropdown():
        auth_profile_names = sorted(configs_data["auth_profiles"].keys())
        dd_auth_profiles.options = [ft.dropdown.Option(name) for name in auth_profile_names]
        active_auth_name = configs_data.get("active_auth_profile_name")
        if active_auth_name in auth_profile_names:
            dd_auth_profiles.value = active_auth_name
        elif auth_profile_names:
            dd_auth_profiles.value = auth_profile_names[0]
            configs_data["active_auth_profile_name"] = auth_profile_names[0]
        else:
            dd_auth_profiles.value = None
        if dd_auth_profiles.page:
            page.update()
        return dd_auth_profiles.value

    def update_sending_profile_dropdown():
        profile_names = sorted(configs_data["sending_profiles"].keys())
        dd_sending_profiles.options = [ft.dropdown.Option(name) for name in profile_names]
        active_sending_profile = configs_data.get("active_sending_profile_name")
        if active_sending_profile in profile_names:
            dd_sending_profiles.value = active_sending_profile
        elif profile_names:
            dd_sending_profiles.value = profile_names[0]
            configs_data["active_sending_profile_name"] = profile_names[0]
        if dd_sending_profiles.page:
            page.update()
        return dd_sending_profiles.value

    # --- CONTROLES DA UI ---
    
    dd_auth_profiles = ft.Dropdown(label="Conta Telegram Ativa", hint_text="Selecione ou adicione uma conta", options=[], width=350, border_radius=8)
    txt_api_id = ft.TextField(label="API ID", width=350, border_radius=8, password=True, can_reveal_password=True, input_filter=ft.InputFilter(allow=True, regex_string=r"[0-9]"))
    txt_api_hash = ft.TextField(label="API Hash", password=True, can_reveal_password=True, width=350, border_radius=8)
    
    chk_delete_from_log_auth = ft.Checkbox(label="Apagar do log após envio", value=True)
    txt_log_channel_id = ft.TextField(label="ID do Canal de Log", hint_text="Ex: -100123456789", width=250, border_radius=8)

    txt_bot_token = ft.TextField(label="Token do Bot", password=True, can_reveal_password=True, width=450, border_radius=8, visible=False)
    rg_auth_type = ft.RadioGroup(content=ft.Row([ft.Radio(value="user", label="Usuário"), ft.Radio(value="bot", label="Bot")]), value="user")
    
    txt_sending_profile_name = ft.TextField(label="Nome da Config. de Envio", width=250, border_radius=8, hint_text="Ex: Para Canal de Filmes")
    dd_sending_profiles = ft.Dropdown(label="Config. de Envio Ativa", options=[], width=250, border_radius=8)
    txt_chat_id = ft.TextField(label="ID do Chat/Canal de Destino", width=350, border_radius=8, hint_text="Ex: -100123456789 ou @username")
    txt_topic_id = ft.TextField(label="ID do Tópico/Reply", hint_text="0 ou vazio se não usar", width=220, text_align=ft.TextAlign.RIGHT, border_radius=8, input_filter=ft.InputFilter(allow=True, regex_string=r"[0-9]"))
    txt_folder_path_display = ft.TextField(label="Fonte dos Arquivos (Pasta ou Arquivos Individuais)", expand=True, border_radius=8, read_only=True, hint_text="Selecione uma pasta ou arquivos individuais abaixo")
    selected_files_list_view = ft.ListView(height=80, spacing=2, visible=False, padding=ft.padding.only(top=5), auto_scroll=False)
    dd_sort_order = ft.Dropdown(label="Ordenar arquivos por:", width=250, border_radius=8, tooltip="Como os arquivos da fonte serão ordenados antes do upload")
    
    txt_custom_concurrency = ft.TextField(label="Nº Personalizado", width=150, border_radius=8, visible=False, input_filter=ft.InputFilter(allow=True, regex_string=r"[0-9]"), keyboard_type=ft.KeyboardType.NUMBER)
    txt_custom_conversion_concurrency = ft.TextField(label="Nº Personalizado", width=150, border_radius=8, visible=False, input_filter=ft.InputFilter(allow=True, regex_string=r"[0-9]"), keyboard_type=ft.KeyboardType.NUMBER)
    
    def on_concurrency_change(e):
        is_custom = (e.control.value == "Personalizado...")
        txt_custom_concurrency.visible = is_custom
        if not is_custom: txt_custom_concurrency.value = ""
        page.update()

    def on_conversion_concurrency_change(e):
        is_custom = (e.control.value == "Personalizado...")
        txt_custom_conversion_concurrency.visible = is_custom
        if not is_custom: txt_custom_conversion_concurrency.value = ""
        page.update()

    dd_concurrency_limit = ft.Dropdown(label="Uploads Simultâneos", hint_text="Nº de processos", width=220, border_radius=8, value="3", options=[ft.dropdown.Option(str(i)) for i in range(1, 11)] + [ft.dropdown.Option("Personalizado...")], on_change=on_concurrency_change)
    dd_conversion_limit = ft.Dropdown(label="Conversões Simultâneas", hint_text="Nº de processos", width=220, border_radius=8, value="1", options=[ft.dropdown.Option(str(i)) for i in range(1, 11)] + [ft.dropdown.Option("Personalizado...")], on_change=on_conversion_concurrency_change)
    
    concurrency_row = ft.Row(
        [
            ft.Column([dd_concurrency_limit, txt_custom_concurrency]),
            ft.Column([dd_conversion_limit, txt_custom_conversion_concurrency], visible=False) # Inicia invisível
        ],
        alignment=ft.MainAxisAlignment.CENTER
    )

    def toggle_hw_accel_options(e=None):
        use_gpu = chk_hw_accel.value
        gpu_selector_container.visible = use_gpu
        ffmpeg_preset_container.visible = not use_gpu
        mode_hint = "Bitrate (kbps)" if use_gpu else "CRF (menor=melhor)"
        txt_custom_quality_value.label = f"Valor Personalizado ({mode_hint})"
        if page.controls:
            page.update()

    chk_hw_accel = ft.Checkbox(label="Usar Aceleração de Hardware (GPU)", on_change=toggle_hw_accel_options)
    dd_gpu_selector = ft.Dropdown(label="Provedor da GPU", hint_text="Selecione a GPU", width=250, border_radius=8, value="nvidia", options=[ft.dropdown.Option("nvidia", "NVIDIA (NVENC)"), ft.dropdown.Option("amd", "AMD (AMF)"), ft.dropdown.Option("intel", "Intel (QSV)")])
    gpu_selector_container = ft.Container(content=dd_gpu_selector, visible=False)
    dd_ffmpeg_preset = ft.Dropdown(label="Preset de Conversão (CPU)", hint_text="Velocidade vs. Compressão", width=250, border_radius=8, value="fast", options=[ft.dropdown.Option(k, t) for k, t in [("ultrafast", "Ultra Rápido"), ("superfast", "Super Rápido"), ("veryfast", "Muito Rápido"), ("faster", "Mais Rápido"), ("fast", "Rápido"), ("medium", "Médio"), ("slow", "Lento"), ("slower", "Mais Lento"), ("veryslow", "Muito Lento")]])
    ffmpeg_preset_container = ft.Container(content=dd_ffmpeg_preset, visible=True)

    def on_quality_preset_change(e):
        is_custom = e.control.value == "personalizado"
        txt_custom_quality_value.visible = is_custom
        toggle_hw_accel_options()
        if page.controls:
            page.update()

    dd_quality_preset = ft.Dropdown(label="Nível de Qualidade", width=250, border_radius=8, value="medio", options=[ft.dropdown.Option("muito_baixo", "Muito Baixo"), ft.dropdown.Option("baixo", "Baixo"), ft.dropdown.Option("medio", "Médio"), ft.dropdown.Option("alto", "Alto"), ft.dropdown.Option("muito_alto", "Muito Alto"), ft.dropdown.Option("personalizado", "Personalizado...")], on_change=on_quality_preset_change)
    txt_custom_quality_value = ft.TextField(label="Valor Personalizado (CRF)", hint_text="Defina CRF ou Bitrate", width=250, border_radius=8, value="23", input_filter=ft.InputFilter(allow=True, regex_string=r"[0-9]"), keyboard_type=ft.KeyboardType.NUMBER, visible=False)
    
    def toggle_watermark_options(e):
        watermark_options_container.visible = chk_watermark.value
        page.update()

    chk_watermark = ft.Checkbox(label="Adicionar Marca d'água", on_change=toggle_watermark_options)
    
    def on_watermark_picker_result(e: ft.FilePickerResultEvent):
        if e.files and e.files[0].path:
            txt_watermark_path.value = e.files[0].path
            page.update()

    watermark_picker = ft.FilePicker(on_result=on_watermark_picker_result)
    page.overlay.append(watermark_picker)

    btn_select_watermark = ft.ElevatedButton("Selecionar Imagem...", icon=ft.Icons.IMAGE, on_click=lambda _: watermark_picker.pick_files(dialog_title="Selecione a imagem da marca d'água", allow_multiple=False, allowed_extensions=["png"]))
    txt_watermark_path = ft.TextField(label="Caminho da Imagem", read_only=True, expand=True)
    txt_watermark_scale = ft.TextField(label="Tamanho da Marca d'água (%)", value="10", width=200, border_radius=8, hint_text="Ex: 10", input_filter=ft.InputFilter(allow=True, regex_string=r"[0-9]"), keyboard_type=ft.KeyboardType.NUMBER)
    dd_watermark_position = ft.Dropdown(
        label="Posição da Marca d'água",
        width=300,
        value="bottom_right",
        options=[
            ft.dropdown.Option("top_left", "Canto Superior Esquerdo"),
            ft.dropdown.Option("top_right", "Canto Superior Direito"),
            ft.dropdown.Option("bottom_left", "Canto Inferior Esquerdo"),
            ft.dropdown.Option("bottom_right", "Canto Inferior Direito"),
            ft.dropdown.Option("center", "Centro"),
        ]
    )
    watermark_options_container = ft.Container(
        visible=False,
        content=ft.Column([
            ft.Row([btn_select_watermark, txt_watermark_path], alignment=ft.MainAxisAlignment.SPACE_BETWEEN, vertical_alignment=ft.CrossAxisAlignment.CENTER),
            ft.Row([dd_watermark_position, txt_watermark_scale], alignment=ft.MainAxisAlignment.SPACE_EVENLY, wrap=True)
        ])
    )

    ffmpeg_settings_container = ft.Container(visible=False, content=ft.Column([
        ft.Divider(height=5),
        ft.Row([ft.Text("Opções de Otimização (FFmpeg)", weight=ft.FontWeight.BOLD, size=18)], alignment=ft.MainAxisAlignment.CENTER),
        ft.Row([chk_hw_accel], alignment=ft.MainAxisAlignment.CENTER),
        ft.Row([gpu_selector_container, ffmpeg_preset_container], alignment=ft.MainAxisAlignment.SPACE_EVENLY, wrap=True),
        ft.Row([dd_quality_preset, txt_custom_quality_value], alignment=ft.MainAxisAlignment.SPACE_EVENLY, wrap=True),
        ft.Divider(height=2, color=ft.Colors.with_opacity(0.5, ft.Colors.OUTLINE)),
        ft.Row([chk_watermark], alignment=ft.MainAxisAlignment.CENTER),
        watermark_options_container,
        ft.Divider(height=5),
    ]))

    def update_media_options_visibility(e=None):
        is_send_as_media_active = chk_send_as_media.value
        is_grouping_active = chk_group_files.value

        ffmpeg_settings_container.visible = is_send_as_media_active
        # Torna o dropdown de conversão visível/invisível
        concurrency_row.controls[1].visible = is_send_as_media_active
        caption_warning_text.visible = False
        
        if is_grouping_active and is_send_as_media_active:
            individual_caption_controls_container.visible = False
            album_caption_controls_container.visible = True
        else:
            individual_caption_controls_container.visible = True
            album_caption_controls_container.visible = False
            if is_grouping_active: 
                caption_warning_text.visible = True

        txt_global_caption.visible = individual_caption_controls_container.visible and (dd_caption_mode.value == "global")
        txt_album_global_caption.visible = album_caption_controls_container.visible and (dd_album_caption_mode.value == "album_global")
        
        on_quality_preset_change(ft.ControlEvent(target=dd_quality_preset, name="change", data=dd_quality_preset.value, control=dd_quality_preset, page=page))
        toggle_hw_accel_options()

        title_row_caption_config.visible = True
        if page.controls: 
            page.update()

    chk_send_as_media = ft.Checkbox(label="Otimizar como mídia (imagem/vídeo/áudio)", on_change=update_media_options_visibility)
    chk_group_files = ft.Checkbox(label="Agrupar arquivos (álbum/lote, máx 10)", on_change=update_media_options_visibility)
    chk_include_subfolders = ft.Checkbox(label="Incluir subpastas (se fonte for pasta)")
    
    dd_caption_mode = ft.Dropdown(label="Legenda Individual", width=450, border_radius=8, on_change=update_media_options_visibility, options=[ft.dropdown.Option(k, v) for k, v in [("filename", "Nome do arquivo com extensão"), ("filename_no_ext", "Nome do arquivo sem extensão"), ("global", "Usar Legenda Única abaixo"), ("none", "Sem legenda")]])
    txt_global_caption = ft.TextField(label="Legenda Única", visible=False, width=450, border_radius=8, multiline=True, max_lines=5)
    individual_caption_controls_container = ft.Column(controls=[ft.Row([dd_caption_mode]), ft.Row([txt_global_caption])], visible=True)
    dd_album_caption_mode = ft.Dropdown(label="Legenda do Álbum", width=450, border_radius=8, on_change=update_media_options_visibility, options=[ft.dropdown.Option(k, v) for k, v in [("none", "Sem legenda para o álbum"), ("album_global", "Usar Legenda Única do Álbum abaixo")]])
    txt_album_global_caption = ft.TextField(label="Legenda Única do Álbum", visible=False, width=450, border_radius=8, multiline=True, max_lines=5)
    album_caption_controls_container = ft.Column(controls=[ft.Row([dd_album_caption_mode]), ft.Row([txt_album_global_caption])], visible=False)
    title_row_caption_config = ft.Row([ft.Text("Configurações de Legenda", weight=ft.FontWeight.BOLD, size=18)], alignment=ft.MainAxisAlignment.CENTER)
    caption_warning_text = ft.Text("Legenda para grupo de documentos será aplicada apenas ao primeiro arquivo.", italic=True, color=ft.Colors.AMBER, size=12, visible=False, width=550, text_align=ft.TextAlign.CENTER)
    
    log_list_view = ft.ListView(expand=True, spacing=5, auto_scroll=True, padding=5)
    progress_bars_column = ft.Column(scroll=ft.ScrollMode.ADAPTIVE, spacing=4, expand=True)
    progress_bars_container = ft.Container(content=progress_bars_column, border=ft.border.all(1, ft.Colors.with_opacity(0.5, ft.Colors.OUTLINE)), border_radius=8, padding=10, height=300, visible=False)
    lbl_prog_total = ft.Text("Progresso total: N/A"); prog_total = ft.ProgressBar(value=0, bar_height=10, color=ft.Colors.GREEN_ACCENT)
    btn_start_upload = ft.ElevatedButton("Iniciar Uploads", icon=ft.Icons.UPLOAD_FILE, bgcolor=ft.Colors.GREEN_ACCENT_700, color=ft.Colors.WHITE, height=40)
    btn_stop_all_uploads = ft.ElevatedButton("Parar Tudo Agora", icon=ft.Icons.STOP_CIRCLE, visible=False, height=40, bgcolor=ft.Colors.RED_700, color=ft.Colors.WHITE)

    ui_controls = {
        "chk_group_files_ref": chk_group_files, "chk_send_as_media_ref": chk_send_as_media, 
        "dd_caption_mode_ref": dd_caption_mode, "txt_global_caption_ref": txt_global_caption, "dd_album_caption_mode_ref": dd_album_caption_mode,
        "txt_album_global_caption_ref": txt_album_global_caption, "dd_sort_order_ref": dd_sort_order, "chk_include_subfolders_ref": chk_include_subfolders,
        "log_func": log_message_async,
        "lbl_prog_total_ref": lbl_prog_total, "prog_total_bar_ref": prog_total,
        "dd_concurrency_limit_ref": dd_concurrency_limit,
        "txt_custom_concurrency_ref": txt_custom_concurrency,
        "dd_conversion_limit_ref": dd_conversion_limit, # NOVO
        "txt_custom_conversion_concurrency_ref": txt_custom_conversion_concurrency, # NOVO
        "progress_bars_container_ref": progress_bars_container,
        "progress_bars_column_ref": progress_bars_column,
        "chk_hw_accel_ref": chk_hw_accel, "dd_gpu_selector_ref": dd_gpu_selector,
        "dd_ffmpeg_preset_ref": dd_ffmpeg_preset, "dd_quality_preset_ref": dd_quality_preset,
        "txt_custom_quality_value_ref": txt_custom_quality_value,
        "txt_watermark_scale_ref": txt_watermark_scale,
        "btn_start_upload_ref": btn_start_upload, "btn_stop_all_uploads_ref": btn_stop_all_uploads,
    }
    
    def on_auth_type_change(e):
        txt_bot_token.visible = (rg_auth_type.value == "bot")
        page.update()
    rg_auth_type.on_change = on_auth_type_change

    def populate_auth_fields(auth_profile_name):
        txt_api_id.value = ""
        txt_api_hash.value = ""
        txt_bot_token.value = ""
        txt_log_channel_id.value = ""
        chk_delete_from_log_auth.value = True
        txt_bot_token.visible = False
        rg_auth_type.value = "user"
        if auth_profile_name and auth_profile_name in configs_data["auth_profiles"]:
            profile = configs_data["auth_profiles"][auth_profile_name]
            rg_auth_type.value = profile.get("auth_type", "user")
            txt_api_id.value = profile.get("api_id", "")
            txt_api_hash.value = profile.get("api_hash", "")
            txt_bot_token.value = profile.get("bot_token", "")
            txt_log_channel_id.value = profile.get("log_channel_id", "")
            chk_delete_from_log_auth.value = profile.get("delete_from_log", True)
            txt_bot_token.visible = (rg_auth_type.value == "bot")
        if page.controls: page.update()

    async def on_auth_profile_change(e):
        selected_auth_name = dd_auth_profiles.value
        await log_message_async(f"Conta de autenticação selecionada: '{selected_auth_name}'")
        configs_data["active_auth_profile_name"] = selected_auth_name
        populate_auth_fields(selected_auth_name)
        salvar_configuracoes(configs_data)
    dd_auth_profiles.on_change = on_auth_profile_change

    async def new_auth_profile_action(e):
        base_name = "Nova Conta"
        new_profile_name = base_name; i = 2
        while new_profile_name in configs_data["auth_profiles"]:
            new_profile_name = f"{base_name} {i}"; i += 1
        configs_data["auth_profiles"][new_profile_name] = get_default_auth_profile()
        salvar_configuracoes(configs_data)
        update_auth_dropdown()
        dd_auth_profiles.value = new_profile_name
        populate_auth_fields(new_profile_name)
        await log_message_async(f"Perfil de conta '{new_profile_name}' criado. Preencha os dados e salve.", ft.Colors.BLUE)

    def connect_and_get_session_name(api_id, api_hash, bot_token, auth_type):
        async def do_connect():
            if os.path.exists(f"{TEMP_SESSION_NAME}.session"):
                os.remove(f"{TEMP_SESSION_NAME}.session")

            client = Client(TEMP_SESSION_NAME, api_id=int(api_id), api_hash=api_hash, bot_token=bot_token or None, no_updates=True)
            
            await client.connect()
            try:
                phone_number = None
                if auth_type == 'user':
                    phone_number = await client.send_code(await client.ask("Número de Telefone (ex: +55119...): "))
                
                me = await client.sign_in(
                    phone_number.phone_number if phone_number else None, 
                    phone_number.phone_code_hash if phone_number else None,
                    await client.ask("Código de verificação: ")
                )
            except SessionPasswordNeeded:
                me = await client.check_password(await client.ask("Senha de verificação em 2 etapas: ", password=True))
            
            profile_name = me.username or me.first_name or f"User_{me.id}" if auth_type == "user" else me.username or f"Bot_{me.id}"
            await client.disconnect()
            return {"status": "success", "profile_name": profile_name}
        try:
            return asyncio.run(do_connect())
        except Exception as e:
            traceback.print_exc()
            return {"status": "error", "message": f"{type(e).__name__}: {e}"}

    async def save_auth_action(e):
        current_profile_name = dd_auth_profiles.value
        if not current_profile_name:
            await log_message_async("ERRO: Nenhum perfil de conta selecionado para salvar.", ft.Colors.RED)
            return

        profile_data = configs_data["auth_profiles"].get(current_profile_name)
        if not profile_data:
            await log_message_async(f"ERRO: Perfil '{current_profile_name}' não encontrado nos dados.", ft.Colors.RED)
            return

        profile_data.update({
            "api_id": txt_api_id.value.strip(),
            "api_hash": txt_api_hash.value.strip(),
            "auth_type": rg_auth_type.value,
            "bot_token": txt_bot_token.value.strip(),
            "log_channel_id": txt_log_channel_id.value.strip(),
            "delete_from_log": chk_delete_from_log_auth.value
        })
        
        configs_data["auth_profiles"][current_profile_name] = profile_data
        salvar_configuracoes(configs_data)
        await log_message_async(f"Dados da conta '{current_profile_name}' salvos com sucesso.", ft.Colors.GREEN)

    async def connect_auth_action(e):
        current_profile_name = dd_auth_profiles.value
        if not current_profile_name or current_profile_name not in configs_data["auth_profiles"]:
            await log_message_async("ERRO: Selecione uma conta com dados salvos para conectar.", ft.Colors.RED)
            return

        profile = configs_data["auth_profiles"][current_profile_name]
        api_id_ui = profile.get("api_id")
        api_hash_ui = profile.get("api_hash")
        auth_type = profile.get("auth_type")
        bot_token = profile.get("bot_token")

        if not api_id_ui or not api_hash_ui or (auth_type == "bot" and not bot_token):
            await log_message_async("ERRO: Preencha e salve os campos de autenticação antes de conectar.", ft.Colors.RED); return
        
        await log_message_async("Tentando conectar ao Telegram... Verifique o console para inserir dados.", ft.Colors.YELLOW)
        page.update()
        
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, connect_and_get_session_name, api_id_ui, api_hash_ui, bot_token, auth_type)
        
        if result["status"] == "success":
            real_profile_name = result["profile_name"]
            final_session_name = "".join(c for c in real_profile_name if c.isalnum() or c in ('_',)).rstrip()
            
            temp_session_file = f"{TEMP_SESSION_NAME}.session"
            final_session_file = f"{final_session_name}.session"

            if os.path.exists(temp_session_file):
                if os.path.exists(final_session_file): os.remove(final_session_file)
                os.rename(temp_session_file, final_session_file)
            
            profile["session_name"] = final_session_name
            
            if current_profile_name != real_profile_name:
                del configs_data["auth_profiles"][current_profile_name]
            
            configs_data["auth_profiles"][real_profile_name] = profile
            configs_data["active_auth_profile_name"] = real_profile_name
            salvar_configuracoes(configs_data)
            
            update_auth_dropdown()
            dd_auth_profiles.value = real_profile_name
            populate_auth_fields(real_profile_name)
            await log_message_async(f"Conta '{real_profile_name}' conectada e salva!", ft.Colors.GREEN)
        else:
            await log_message_async(f"ERRO ao conectar: {result['message']}", ft.Colors.RED)

    async def delete_auth_action(e):
        profile_to_delete = dd_auth_profiles.value
        if not profile_to_delete or (len(configs_data["auth_profiles"]) <= 1 and profile_to_delete == DEFAULT_AUTH_PROFILE_NAME):
            await log_message_async("Não é possível excluir a conta padrão ou nenhuma conta selecionada.", ft.Colors.RED); return
        
        if profile_to_delete in configs_data["auth_profiles"]:
            session_file = f"{configs_data['auth_profiles'][profile_to_delete].get('session_name')}.session"
            if os.path.exists(session_file):
                os.remove(session_file)
                await log_message_async(f"Arquivo de sessão para '{profile_to_delete}' removido.", ft.Colors.ORANGE)
            del configs_data["auth_profiles"][profile_to_delete]
            
            new_active = list(configs_data["auth_profiles"].keys())[0] if configs_data["auth_profiles"] else None
            configs_data["active_auth_profile_name"] = new_active
            salvar_configuracoes(configs_data)
            update_auth_dropdown()
            populate_auth_fields(new_active)
            await log_message_async(f"Conta '{profile_to_delete}' excluída.", ft.Colors.ORANGE)

    btn_new_auth_profile = ft.IconButton(ft.Icons.ADD_CIRCLE_OUTLINE, tooltip="Preparar para Adicionar Nova Conta", on_click=new_auth_profile_action)
    btn_save_auth = ft.IconButton(ft.Icons.SAVE, tooltip="Salvar Dados da Conta", on_click=save_auth_action, icon_color=ft.Colors.BLUE_700)
    btn_connect_auth = ft.IconButton(ft.Icons.LINK, tooltip="Conectar Conta (Gerar Sessão)", on_click=connect_auth_action, icon_color=ft.Colors.GREEN_700)
    btn_delete_auth = ft.IconButton(ft.Icons.DELETE_FOREVER, tooltip="Excluir Conta Selecionada", icon_color=ft.Colors.RED_ACCENT_700, on_click=delete_auth_action)

    def populate_sending_fields(profile_name):
        if profile_name and profile_name in configs_data["sending_profiles"]:
            defaults = get_default_sending_profile()
            profile = configs_data["sending_profiles"][profile_name]
            
            txt_sending_profile_name.value = profile_name
            txt_chat_id.value = profile.get("chat_id", "")
            txt_topic_id.value = str(profile.get("topic_id", "0"))
            dd_sort_order.value = profile.get("sort_order", defaults["sort_order"])
            chk_send_as_media.value = profile.get("send_as_media", defaults["send_as_media"])
            chk_include_subfolders.value = profile.get("include_subfolders", defaults["include_subfolders"])
            chk_group_files.value = profile.get("group_files", defaults["group_files"])
            dd_caption_mode.value = profile.get("caption_mode", defaults["caption_mode"])
            txt_global_caption.value = profile.get("global_caption", "")
            dd_album_caption_mode.value = profile.get("album_caption_mode", defaults["album_caption_mode"])
            txt_album_global_caption.value = profile.get("album_global_caption", "")
            
            hw_accel_saved = profile.get("hw_accel", defaults["hw_accel"])
            chk_hw_accel.value = hw_accel_saved != "cpu"
            if chk_hw_accel.value: dd_gpu_selector.value = hw_accel_saved

            dd_ffmpeg_preset.value = profile.get("ffmpeg_preset", defaults["ffmpeg_preset"])
            dd_quality_preset.value = profile.get("quality_preset", defaults["quality_preset"])
            txt_custom_quality_value.value = profile.get("custom_quality_value", defaults["custom_quality_value"])

            chk_watermark.value = profile.get("use_watermark", False)
            txt_watermark_path.value = profile.get("watermark_path", "")
            txt_watermark_scale.value = profile.get("watermark_scale", defaults["watermark_scale"])
            dd_watermark_position.value = profile.get("watermark_position", "bottom_right")
            watermark_options_container.visible = chk_watermark.value
            
            concurrency_limit = profile.get("concurrency_limit", defaults["concurrency_limit"])
            dd_concurrency_limit.value = concurrency_limit
            txt_custom_concurrency.value = profile.get("custom_concurrency", "") if concurrency_limit == "Personalizado..." else ""
            txt_custom_concurrency.visible = concurrency_limit == "Personalizado..."

            # NOVO
            conversion_limit = profile.get("conversion_limit", defaults["conversion_limit"])
            dd_conversion_limit.value = conversion_limit
            txt_custom_conversion_concurrency.value = profile.get("custom_conversion_concurrency", "") if conversion_limit == "Personalizado..." else ""
            txt_custom_conversion_concurrency.visible = conversion_limit == "Personalizado..."
        
        update_media_options_visibility()

    async def on_sending_profile_change(e):
        selected_profile_name = dd_sending_profiles.value
        await log_message_async(f"Configuração de Envio: '{selected_profile_name}'")
        configs_data["active_sending_profile_name"] = selected_profile_name
        populate_sending_fields(selected_profile_name)
        salvar_configuracoes(configs_data)
    dd_sending_profiles.on_change = on_sending_profile_change

    async def new_sending_profile_action(e):
        base_name = "Novo Perfil"
        new_profile_name = base_name; i = 2
        while new_profile_name in configs_data["sending_profiles"]:
            new_profile_name = f"{base_name} {i}"; i += 1
        configs_data["sending_profiles"][new_profile_name] = get_default_sending_profile()
        salvar_configuracoes(configs_data)
        update_sending_profile_dropdown()
        dd_sending_profiles.value = new_profile_name
        populate_sending_fields(new_profile_name)
        await log_message_async(f"Perfil '{new_profile_name}' criado. Modifique e salve.", ft.Colors.BLUE)

    async def save_sending_profile_action(e):
        current_name = dd_sending_profiles.value
        new_name = txt_sending_profile_name.value.strip()
        if not new_name:
            await log_message_async("ERRO: O nome do perfil não pode estar vazio.", ft.Colors.RED); return
        if new_name != current_name and new_name in configs_data["sending_profiles"]:
            await log_message_async(f"ERRO: Já existe um perfil chamado '{new_name}'.", ft.Colors.RED); return
        
        hw_accel_to_save = dd_gpu_selector.value if chk_hw_accel.value else "cpu"
        defaults = get_default_sending_profile()
        
        profile_data = {
            "chat_id": txt_chat_id.value.strip(), "topic_id": txt_topic_id.value.strip() or "0",
            "sort_order": dd_sort_order.value, "send_as_media": chk_send_as_media.value,
            "include_subfolders": chk_include_subfolders.value, "group_files": chk_group_files.value,
            "caption_mode": dd_caption_mode.value, "global_caption": txt_global_caption.value,
            "album_caption_mode": dd_album_caption_mode.value, "album_global_caption": txt_album_global_caption.value,
            "concurrency_limit": dd_concurrency_limit.value,
            "custom_concurrency": txt_custom_concurrency.value or "",
            "conversion_limit": dd_conversion_limit.value, # NOVO
            "custom_conversion_concurrency": txt_custom_conversion_concurrency.value or "", # NOVO
            "ffmpeg_preset": dd_ffmpeg_preset.value, "hw_accel": hw_accel_to_save,
            "quality_preset": dd_quality_preset.value,
            "custom_quality_value": txt_custom_quality_value.value or defaults["custom_quality_value"],
            "use_watermark": chk_watermark.value,
            "watermark_path": txt_watermark_path.value,
            "watermark_scale": txt_watermark_scale.value or defaults["watermark_scale"],
            "watermark_position": dd_watermark_position.value,
        }
        
        if current_name and new_name != current_name:
            del configs_data["sending_profiles"][current_name]
        
        configs_data["sending_profiles"][new_name] = profile_data
        configs_data["active_sending_profile_name"] = new_name
        salvar_configuracoes(configs_data)
        update_sending_profile_dropdown()
        dd_sending_profiles.value = new_name
        await log_message_async(f"Perfil '{new_name}' salvo!", ft.Colors.GREEN)

    async def delete_sending_profile_action(e):
        profile_to_delete = dd_sending_profiles.value
        if not profile_to_delete or len(configs_data["sending_profiles"]) <= 1:
            await log_message_async("Não é possível excluir o último perfil de envio.", ft.Colors.RED); return
        
        if profile_to_delete in configs_data["sending_profiles"]:
            del configs_data["sending_profiles"][profile_to_delete]
            new_active = list(configs_data["sending_profiles"].keys())[0]
            configs_data["active_sending_profile_name"] = new_active
            salvar_configuracoes(configs_data)
            update_sending_profile_dropdown()
            dd_sending_profiles.value = new_active
            populate_sending_fields(new_active)
            await log_message_async(f"Perfil '{profile_to_delete}' excluído.", ft.Colors.ORANGE)

    btn_new_sending_profile = ft.IconButton(ft.Icons.ADD_CIRCLE_OUTLINE, tooltip="Nova Configuração de Envio", on_click=new_sending_profile_action)
    btn_save_sending_profile = ft.IconButton(ft.Icons.SAVE, tooltip="Salvar Configuração de Envio", on_click=save_sending_profile_action)
    btn_delete_sending_profile = ft.IconButton(ft.Icons.DELETE_FOREVER, tooltip="Excluir Config. de Envio Selecionada", icon_color=ft.Colors.RED_ACCENT_700, on_click=delete_sending_profile_action)
    dd_sort_order.options=[ft.dropdown.Option(k, v) for k, v in [("nome_asc", "Nome (A-Z)"), ("tamanho_desc", "Tamanho (Maior primeiro)"), ("tamanho_asc", "Tamanho (Menor primeiro)"), ("data_mod_desc", "Data de Modificação (Recente primeiro)"), ("data_mod_asc", "Data de Modificação (Antigo primeiro)")] ]
    
    active_auth_profile_name = update_auth_dropdown()
    populate_auth_fields(active_auth_profile_name)
    active_sending_profile_name = update_sending_profile_dropdown()
    if active_sending_profile_name: populate_sending_fields(active_sending_profile_name)
    
    def on_file_picker_result(e: ft.FilePickerResultEvent):
        if e.path:
            app_state["individual_files_paths"] = None
            txt_folder_path_display.value = e.path
            selected_files_list_view.controls.clear()
            selected_files_list_view.visible = False
        elif e.files:
            app_state["individual_files_paths"] = [f.path for f in e.files if f.path and os.path.isfile(f.path)]
            txt_folder_path_display.value = f"{len(app_state['individual_files_paths'])} arquivo(s) selecionado(s)."
            selected_files_list_view.controls.clear()
            for p in app_state["individual_files_paths"]:
                selected_files_list_view.controls.append(ft.Text(os.path.basename(p), size=10, tooltip=p))
            selected_files_list_view.visible = True
        page.update()

    file_picker = ft.FilePicker(on_result=on_file_picker_result)
    page.overlay.append(file_picker)
    btn_select_folder = ft.ElevatedButton("Selecionar Pasta Inteira", icon=ft.Icons.FOLDER_OPEN, on_click=lambda _: file_picker.get_directory_path(dialog_title="Selecione a pasta de origem"))
    btn_select_files = ft.ElevatedButton("Selecionar Arquivos Individuais", icon=ft.Icons.FILE_OPEN, on_click=lambda _: file_picker.pick_files(dialog_title="Selecione um ou mais arquivos", allow_multiple=True))
    
    async def acao_iniciar_uploads(e):
        if chk_send_as_media.value and not ffmpeg_disponivel:
            await log_message_async("AVISO: FFmpeg não encontrado.", ft.Colors.AMBER, 5000)

        # Obter limites de concorrência
        def get_concurrency(limit_dd, custom_txt):
            limit_str = limit_dd.value
            if limit_str == "Personalizado...":
                custom_val = custom_txt.value
                return int(custom_val) if custom_val and custom_val.isdigit() and int(custom_val) > 0 else -1
            return int(limit_str)

        upload_concurrency = get_concurrency(dd_concurrency_limit, txt_custom_concurrency)
        conversion_concurrency = get_concurrency(dd_conversion_limit, txt_custom_conversion_concurrency)
        
        if upload_concurrency == -1 or conversion_concurrency == -1:
            await log_message_async("ERRO: Nº de processos personalizado inválido.", ft.Colors.RED); return

        if app_state.get("current_upload_task") and not app_state["current_upload_task"].done():
            await log_message_async("ERRO: Upload já em andamento.", ft.Colors.RED); return

        auth_name = dd_auth_profiles.value
        sending_name = dd_sending_profiles.value
        if not auth_name or not sending_name:
            await log_message_async("ERRO: Selecione uma Conta e uma Config. de Envio.", ft.Colors.RED); return
            
        auth_profile = configs_data["auth_profiles"][auth_name]
        
        if not auth_profile.get("session_name") or not os.path.exists(f'{auth_profile.get("session_name")}.session'):
            await log_message_async("ERRO: Conta não conectada. Salve os dados e clique em 'Conectar Conta' primeiro.", ft.Colors.RED); return
            
        if not txt_chat_id.value.strip():
            await log_message_async("ERRO: ID do chat de destino é obrigatório.", ft.Colors.RED); return
        
        if not auth_profile.get("log_channel_id", "").strip():
            await log_message_async("ERRO: ID do Canal de Log não definido para esta conta. Salve a configuração da conta primeiro.", ft.Colors.RED); return

        path_info = {"type": "files", "paths": app_state.get("individual_files_paths")} if app_state.get("individual_files_paths") else {"type": "folder", "path": txt_folder_path_display.value} if txt_folder_path_display.value and os.path.isdir(txt_folder_path_display.value) else {}
        if not path_info:
            await log_message_async("ERRO: Nenhuma fonte de arquivos válida.", ft.Colors.RED); return
            
        lista_arquivos_para_upload = await _coletar_e_ordenar_arquivos(path_info, ui_controls, log_message_async)
        if not lista_arquivos_para_upload:
            await log_message_async("Nenhum arquivo encontrado na fonte.", ft.Colors.YELLOW); return
        
        progress_bars_container.visible = True
        await log_message_async(f"Iniciando upload com a conta {auth_profile['session_name']}", ft.Colors.YELLOW)
        btn_start_upload.disabled = True; btn_start_upload.text = "Enviando..."
        btn_stop_all_uploads.visible = True; btn_stop_all_uploads.disabled = False
        page.update()

        app_state["stop_all_flag"] = False

        temp_sending_profile = configs_data["sending_profiles"][sending_name].copy()
        
        task = asyncio.create_task(
            processo_de_upload_telegram(
                page, auth_profile, temp_sending_profile, 
                lista_arquivos_para_upload, upload_concurrency, conversion_concurrency,
                ui_controls, app_state
            )
        )
        app_state["current_upload_task"] = task

        try:
            await task
        finally:
            app_state["current_upload_task"] = None
            btn_start_upload.disabled = False
            btn_start_upload.text = "Iniciar Uploads"
            btn_stop_all_uploads.visible = False
            if page.controls:
                page.update()
    
    btn_start_upload.on_click = acao_iniciar_uploads
    
    async def acao_parar_tudo(e):
        await log_message_async("Sinal de parada geral enviado!", ft.Colors.RED)
        app_state["stop_all_flag"] = True
        btn_stop_all_uploads.disabled = True
        page.update()
    btn_stop_all_uploads.on_click = acao_parar_tudo

    layout_principal = ft.Column(
        scroll=ft.ScrollMode.ADAPTIVE, spacing=12, expand=True, horizontal_alignment=ft.CrossAxisAlignment.CENTER,
        controls=[
            ft.Text("1. Contas de Autenticação", weight=ft.FontWeight.BOLD, size=20),
            ft.Row([dd_auth_profiles, btn_new_auth_profile, btn_save_auth, btn_connect_auth, btn_delete_auth], alignment=ft.MainAxisAlignment.CENTER),
            ft.Row([rg_auth_type], alignment=ft.MainAxisAlignment.CENTER),
            ft.Row([txt_api_id, txt_api_hash], alignment=ft.MainAxisAlignment.SPACE_EVENLY),
            ft.Row([txt_log_channel_id, chk_delete_from_log_auth], alignment=ft.MainAxisAlignment.CENTER, vertical_alignment=ft.CrossAxisAlignment.CENTER),
            ft.Row([txt_bot_token], alignment=ft.MainAxisAlignment.CENTER),
            ft.Divider(height=15, thickness=2),

            ft.Text("2. Configurações de Envio", weight=ft.FontWeight.BOLD, size=20),
            ft.Row([txt_sending_profile_name, dd_sending_profiles, btn_new_sending_profile, btn_save_sending_profile, btn_delete_sending_profile], alignment=ft.MainAxisAlignment.CENTER),
            ft.Row([txt_chat_id, txt_topic_id], alignment=ft.MainAxisAlignment.SPACE_EVENLY),
            ft.Row([dd_sort_order], alignment=ft.MainAxisAlignment.CENTER),
            concurrency_row,
            
            ft.Row([chk_send_as_media, chk_group_files, chk_include_subfolders], alignment=ft.MainAxisAlignment.CENTER, spacing=20, wrap=True),

            ffmpeg_settings_container,
            
            ft.Divider(height=15, thickness=1),
            
            title_row_caption_config, 
            caption_warning_text,
            individual_caption_controls_container, 
            album_caption_controls_container,
            ft.Divider(height=15, thickness=1),

            ft.Text("3. Fonte dos Arquivos e Iniciar", weight=ft.FontWeight.BOLD, size=20),
            ft.Row([btn_select_folder, btn_select_files], alignment=ft.MainAxisAlignment.SPACE_EVENLY),
            txt_folder_path_display,
            ft.Container(content=selected_files_list_view, border=ft.border.all(1, ft.Colors.with_opacity(0.5, ft.Colors.OUTLINE)), border_radius=5, padding=5, visible=selected_files_list_view.visible, margin=ft.margin.only(top=2)),
            ft.Divider(height=20, thickness=1),

            ft.Row([btn_start_upload, btn_stop_all_uploads], alignment=ft.MainAxisAlignment.CENTER, spacing=10, wrap=True),
            ft.Divider(height=10),
            
            progress_bars_container,
            lbl_prog_total, prog_total,
            ft.Divider(height=10),

            ft.Text("Log de Eventos:", weight=ft.FontWeight.BOLD, size=16),
            ft.Container(content=log_list_view, border=ft.border.all(1, ft.Colors.OUTLINE), border_radius=8, padding=10, expand=True, height=200)
        ]
    )
    
    page.add(layout_principal)
    
    await log_message_async("Interface iniciada. Selecione uma conta e configuração.")
    if not ffmpeg_disponivel:
        await log_message_async("AVISO: FFmpeg não encontrado. A conversão de mídia está desativada.", ft.Colors.AMBER)

if __name__ == "__main__":
    multiprocessing.freeze_support()
    if os.name == 'nt' and not is_admin():
        request_admin_privileges()

    ft.app(target=main)