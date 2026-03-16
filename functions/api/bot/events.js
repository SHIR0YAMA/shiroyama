function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function authenticateBot(env, botName, botSecret) {
  if (!botName || !botSecret) return null;
  return env.DB.prepare(
    'SELECT id, bot_name, is_active FROM telegram_bots WHERE bot_name = ? AND webhook_secret = ?'
  ).bind(botName, botSecret).first();
}

function extractFileInfo(update) {
  const msg = update.message || update.channel_post || update.edited_message || update.edited_channel_post;
  if (!msg) return null;

  const chat = msg.chat || {};
  const threadId = msg.message_thread_id || null;

  let media = null;
  if (msg.document) media = msg.document;
  else if (msg.video) media = msg.video;
  else if (msg.audio) media = msg.audio;
  else if (msg.voice) media = msg.voice;
  else if (Array.isArray(msg.photo) && msg.photo.length > 0) media = msg.photo[msg.photo.length - 1];

  if (!media) return null;

  return {
    telegram_chat_id: String(chat.id),
    source_name: chat.title || chat.username || `chat_${chat.id}`,
    source_type: chat.type === 'channel' ? 'channel' : 'group',
    telegram_message_id: msg.message_id,
    telegram_file_ref: media.file_id || media.file_unique_id || null,
    file_name: media.file_name || `arquivo_${msg.message_id}`,
    mime_type: media.mime_type || 'application/octet-stream',
    file_size: media.file_size || 0,
    metadata: {
      file_unique_id: media.file_unique_id || null,
      thread_id: threadId,
      chat_type: chat.type || null,
      is_forum: !!chat.is_forum
    }
  };
}

function normalizeTelegramUpdate(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.event_type) return payload;

  const msg = payload.message || payload.channel_post || payload.my_chat_member;
  if (!msg) return null;

  if (payload.my_chat_member) {
    const chatId = String(payload.my_chat_member.chat?.id || '');
    const sourceName = payload.my_chat_member.chat?.title || payload.my_chat_member.chat?.username || `chat_${chatId}`;
    const newStatus = payload.my_chat_member.new_chat_member?.status;

    if (['member', 'administrator'].includes(newStatus)) {
      return { event_type: 'source_joined', telegram_chat_id: chatId, source_name: sourceName, source_type: 'group', metadata: payload.my_chat_member };
    }

    if (['left', 'kicked'].includes(newStatus)) {
      return { event_type: 'source_left', telegram_chat_id: chatId, source_name: sourceName, source_type: 'group', metadata: payload.my_chat_member };
    }

    return null;
  }

  const fileInfo = extractFileInfo(payload);
  if (fileInfo) {
    return { event_type: 'file_detected', ...fileInfo };
  }

  return null;
}

export async function onRequestPost(context) {
  const { env, request } = context;

  const url = new URL(request.url);
  const botName = request.headers.get('x-bot-name') || url.searchParams.get('bot_name');
  const botSecret = request.headers.get('x-bot-secret') || url.searchParams.get('bot_secret');
  const bot = await authenticateBot(env, botName, botSecret);
  if (!bot || bot.is_active !== 1) return json({ message: 'Bot não autorizado.' }, 401);

  const rawPayload = await request.json();
  const updateType = rawPayload?.message ? 'message' : rawPayload?.channel_post ? 'channel_post' : rawPayload?.my_chat_member ? 'my_chat_member' : 'custom';
  const updateChatId = rawPayload?.message?.chat?.id || rawPayload?.channel_post?.chat?.id || rawPayload?.my_chat_member?.chat?.id || null;
  console.log('[bot-events] webhook recebido', { bot: botName, updateType, updateChatId, hasUpdateId: !!rawPayload?.update_id });

  const payload = normalizeTelegramUpdate(rawPayload);
  if (!payload) {
    console.log('[bot-events] update ignorado: sem evento suportado');
    return json({ success: true, ignored: true });
  }

  const { event_type, telegram_chat_id, source_name, source_type = 'channel' } = payload;

  const allowedEventTypes = new Set(['source_joined', 'source_left', 'file_detected']);
  if (!allowedEventTypes.has(event_type)) {
    return json({ message: 'event_type inválido.' }, 400);
  }

  let source = null;
  if (telegram_chat_id) {
    source = await env.DB.prepare('SELECT id, is_active FROM telegram_sources WHERE telegram_chat_id = ?').bind(String(telegram_chat_id)).first();
    if (!source) {
      const { meta } = await env.DB.prepare(
        'INSERT INTO telegram_sources (source_type, telegram_chat_id, source_name, is_active) VALUES (?, ?, ?, 1)'
      ).bind(source_type, String(telegram_chat_id), source_name || `chat_${telegram_chat_id}`).run();
      source = { id: meta.last_row_id, is_active: 1 };
    }
  }

  if (event_type === 'source_joined' && source) {
    await env.DB.prepare('UPDATE telegram_sources SET is_active = 1, source_name = COALESCE(?, source_name), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(source_name || null, source.id).run();
    console.log('[bot-events] source_joined processado', { bot: botName, chat: telegram_chat_id, sourceId: source.id });
  }

  if (event_type === 'source_left' && source) {
    await env.DB.prepare('UPDATE telegram_sources SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(source.id).run();
    console.log('[bot-events] source_left processado', { bot: botName, chat: telegram_chat_id, sourceId: source.id });
  }

  if (event_type === 'file_detected') {
    if (!telegram_chat_id || !payload.telegram_message_id) {
      return json({ message: 'telegram_chat_id e telegram_message_id são obrigatórios para file_detected.' }, 400);
    }

    const mapping = source ? await env.DB.prepare(
      'SELECT id, folder_path FROM bot_source_mappings WHERE bot_id = ? AND source_id = ? AND is_active = 1'
    ).bind(bot.id, source.id).first() : null;

    const folderPath = payload.folder_path || mapping?.folder_path || 'Inbox';
    console.log('[bot-events] mapeamento resolvido', { bot: botName, chatId: telegram_chat_id, sourceId: source?.id || null, mappingId: mapping?.id || null, folderPath });

    const insert = await env.DB.prepare(`
      INSERT INTO files (
        folder_path, file_name, mime_type, file_size, telegram_chat_id, telegram_message_id,
        telegram_file_ref, metadata_json, origin, status, bot_id, source_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'bot_sync', 'active', ?, ?)
    `).bind(
      folderPath,
      payload.file_name || `arquivo_${payload.telegram_message_id}`,
      payload.mime_type || 'application/octet-stream',
      payload.file_size || 0,
      String(telegram_chat_id),
      payload.telegram_message_id,
      payload.telegram_file_ref || null,
      JSON.stringify(payload.metadata || {}),
      bot.id,
      source?.id || null
    ).run();

    await env.DB.prepare(
      'INSERT INTO bot_events (bot_id, source_id, event_type, payload_json, status) VALUES (?, ?, ?, ?, ?)'
    ).bind(bot.id, source?.id || null, event_type, JSON.stringify(payload), 'processed').run();

    console.log('[bot-events] arquivo detectado', {
      bot: botName,
      chat: telegram_chat_id,
      messageId: payload.telegram_message_id,
      fileId: insert.meta.last_row_id,
      mappedFolder: folderPath,
      mappingApplied: !!mapping
    });

    return json({ success: true, file_id: insert.meta.last_row_id });
  }

  await env.DB.prepare(
    'INSERT INTO bot_events (bot_id, source_id, event_type, payload_json, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(bot.id, source?.id || null, event_type || 'unknown', JSON.stringify(payload), 'processed').run();

  return json({ success: true });
}
