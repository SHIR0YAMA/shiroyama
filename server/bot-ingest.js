function normalizeEventPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  if (rawPayload.event_type) return rawPayload;

  const msg = rawPayload.message || rawPayload.channel_post || rawPayload.my_chat_member;
  if (!msg) return null;

  if (rawPayload.my_chat_member) {
    const chatId = String(rawPayload.my_chat_member.chat?.id || '');
    const sourceName = rawPayload.my_chat_member.chat?.title || rawPayload.my_chat_member.chat?.username || `chat_${chatId}`;
    const sourceType = rawPayload.my_chat_member.chat?.type === 'channel' ? 'channel' : 'group';
    const newStatus = rawPayload.my_chat_member.new_chat_member?.status;

    if (['member', 'administrator'].includes(newStatus)) {
      return { event_type: 'source_joined', telegram_chat_id: chatId, source_name: sourceName, source_type: sourceType, metadata: rawPayload.my_chat_member };
    }

    if (['left', 'kicked'].includes(newStatus)) {
      return { event_type: 'source_left', telegram_chat_id: chatId, source_name: sourceName, source_type: sourceType, metadata: rawPayload.my_chat_member };
    }

    return null;
  }

  const msgPayload = rawPayload.message || rawPayload.channel_post || rawPayload.edited_message || rawPayload.edited_channel_post;
  if (!msgPayload) return null;

  const chat = msgPayload.chat || {};
  const threadId = msgPayload.message_thread_id || null;

  let media = null;
  if (msgPayload.document) media = msgPayload.document;
  else if (msgPayload.video) media = msgPayload.video;
  else if (msgPayload.audio) media = msgPayload.audio;
  else if (msgPayload.voice) media = msgPayload.voice;
  else if (Array.isArray(msgPayload.photo) && msgPayload.photo.length > 0) media = msgPayload.photo[msgPayload.photo.length - 1];

  if (!media) return null;

  return {
    event_type: 'file_detected',
    telegram_chat_id: String(chat.id),
    source_name: chat.title || chat.username || `chat_${chat.id}`,
    source_type: chat.type === 'channel' ? 'channel' : 'group',
    telegram_message_id: msgPayload.message_id,
    telegram_file_id: media.file_id || null,
    telegram_file_ref: media.file_id || media.file_unique_id || null,
    file_name: media.file_name || `arquivo_${msgPayload.message_id}`,
    mime_type: media.mime_type || 'application/octet-stream',
    file_size: media.file_size || 0,
    metadata: {
      file_unique_id: media.file_unique_id || null,
      thread_id: threadId,
      chat_type: chat.type || null,
      is_forum: !!chat.is_forum,
      message_id: msgPayload.message_id,
      update_id: rawPayload.update_id || null
    }
  };
}

export async function ingestBotPayload({ env, bot, rawPayload, source = 'webhook' }) {
  const updateType = rawPayload?.message ? 'message' : rawPayload?.channel_post ? 'channel_post' : rawPayload?.my_chat_member ? 'my_chat_member' : 'custom';
  const updateChatId = rawPayload?.message?.chat?.id || rawPayload?.channel_post?.chat?.id || rawPayload?.my_chat_member?.chat?.id || null;
  console.log('[bot-events] update recebido', { source, bot: bot.bot_name, updateType, updateChatId, hasUpdateId: !!rawPayload?.update_id });

  const payload = normalizeEventPayload(rawPayload);
  if (!payload) {
    console.log('[bot-events] update ignorado: sem evento suportado', { source, bot: bot.bot_name });
    return { success: true, ignored: true };
  }

  const { event_type, telegram_chat_id, source_name, source_type = 'channel' } = payload;
  const allowedEventTypes = new Set(['source_joined', 'source_left', 'file_detected']);
  if (!allowedEventTypes.has(event_type)) {
    return { success: false, status: 400, message: 'event_type inválido.' };
  }

  let dbSource = null;
  if (telegram_chat_id) {
    dbSource = await env.DB.prepare('SELECT id, is_active FROM telegram_sources WHERE telegram_chat_id = ?').bind(String(telegram_chat_id)).first();
    if (!dbSource) {
      const { meta } = await env.DB.prepare(
        'INSERT INTO telegram_sources (source_type, telegram_chat_id, source_name, is_active) VALUES (?, ?, ?, 1)'
      ).bind(source_type, String(telegram_chat_id), source_name || `chat_${telegram_chat_id}`).run();
      dbSource = { id: meta.last_row_id, is_active: 1 };
    }
  }

  if (event_type === 'source_joined' && dbSource) {
    await env.DB.prepare('UPDATE telegram_sources SET is_active = 1, source_name = COALESCE(?, source_name), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(source_name || null, dbSource.id).run();
    console.log('[bot-events] source_joined processado', { source, bot: bot.bot_name, chatId: telegram_chat_id, sourceId: dbSource.id });
  }

  if (event_type === 'source_left' && dbSource) {
    await env.DB.prepare('UPDATE telegram_sources SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(dbSource.id).run();
    console.log('[bot-events] source_left processado', { source, bot: bot.bot_name, chatId: telegram_chat_id, sourceId: dbSource.id });
  }

  if (event_type === 'file_detected') {
    if (!telegram_chat_id || !payload.telegram_message_id) {
      return { success: false, status: 400, message: 'telegram_chat_id e telegram_message_id são obrigatórios para file_detected.' };
    }

    const mapping = dbSource ? await env.DB.prepare(
      'SELECT id, folder_path FROM bot_source_mappings WHERE bot_id = ? AND source_id = ? AND is_active = 1'
    ).bind(bot.id, dbSource.id).first() : null;

    const folderPath = payload.folder_path || mapping?.folder_path || 'Inbox';
    console.log('[bot-events] mapeamento aplicado', { source, bot: bot.bot_name, chatId: telegram_chat_id, sourceId: dbSource?.id || null, mappingId: mapping?.id || null, folderPath });

    const insert = await env.DB.prepare(`
      INSERT INTO files (
        folder_path, file_name, mime_type, file_size, telegram_chat_id, telegram_message_id,
        telegram_file_id, telegram_file_ref, metadata_json, origin, status, bot_id, source_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'bot_sync', 'active', ?, ?)
    `).bind(
      folderPath,
      payload.file_name || `arquivo_${payload.telegram_message_id}`,
      payload.mime_type || 'application/octet-stream',
      payload.file_size || 0,
      String(telegram_chat_id),
      payload.telegram_message_id,
      payload.telegram_file_id || null,
      payload.telegram_file_ref || null,
      JSON.stringify(payload.metadata || {}),
      bot.id,
      dbSource?.id || null
    ).run();

    await env.DB.prepare(
      'INSERT INTO bot_events (bot_id, source_id, event_type, payload_json, status) VALUES (?, ?, ?, ?, ?)'
    ).bind(bot.id, dbSource?.id || null, event_type, JSON.stringify(payload), 'processed').run();

    console.log('[bot-events] persistência concluída', {
      source,
      bot: bot.bot_name,
      chatId: telegram_chat_id,
      messageId: payload.telegram_message_id,
      fileId: insert.meta.last_row_id,
      folderPath
    });

    return { success: true, file_id: insert.meta.last_row_id };
  }

  await env.DB.prepare(
    'INSERT INTO bot_events (bot_id, source_id, event_type, payload_json, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(bot.id, dbSource?.id || null, event_type || 'unknown', JSON.stringify(payload), 'processed').run();

  return { success: true };
}
