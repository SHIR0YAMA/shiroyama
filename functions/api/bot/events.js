function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function authenticateBot(env, botName, botSecret) {
  if (!botName || !botSecret) return null;
  return env.DB.prepare(
    'SELECT id, bot_name, is_active FROM telegram_bots WHERE bot_name = ? AND webhook_secret = ?'
  ).bind(botName, botSecret).first();
}

export async function onRequestPost(context) {
  const { env, request } = context;

  const url = new URL(request.url);
  const botName = request.headers.get('x-bot-name') || url.searchParams.get('bot_name');
  const botSecret = request.headers.get('x-bot-secret') || url.searchParams.get('bot_secret');
  const bot = await authenticateBot(env, botName, botSecret);
  if (!bot || bot.is_active !== 1) return json({ message: 'Bot não autorizado.' }, 401);

  const payload = await request.json();
  const { event_type, telegram_chat_id, source_name, source_type = 'channel' } = payload;

  const allowedEventTypes = new Set(['source_joined', 'source_left', 'file_detected']);
  if (!allowedEventTypes.has(event_type)) {
    return json({ message: 'event_type inválido.' }, 400);
  }

  let source = await env.DB.prepare('SELECT id, is_active FROM telegram_sources WHERE telegram_chat_id = ?').bind(String(telegram_chat_id)).first();
  if (!source && telegram_chat_id) {
    const { meta } = await env.DB.prepare(
      'INSERT INTO telegram_sources (source_type, telegram_chat_id, source_name, is_active) VALUES (?, ?, ?, 1)'
    ).bind(source_type, String(telegram_chat_id), source_name || `chat_${telegram_chat_id}`).run();
    source = { id: meta.last_row_id, is_active: 1 };
  }

  if (event_type === 'source_joined' && source) {
    await env.DB.prepare('UPDATE telegram_sources SET is_active = 1, source_name = COALESCE(?, source_name), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(source_name || null, source.id).run();
  }

  if (event_type === 'source_left' && source) {
    await env.DB.prepare('UPDATE telegram_sources SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(source.id).run();
  }

  if (event_type === 'file_detected') {
    if (!telegram_chat_id || !payload.telegram_message_id) {
      return json({ message: 'telegram_chat_id e telegram_message_id são obrigatórios para file_detected.' }, 400);
    }

    const mapping = source ? await env.DB.prepare(
      'SELECT id, folder_path FROM bot_source_mappings WHERE bot_id = ? AND source_id = ? AND is_active = 1'
    ).bind(bot.id, source.id).first() : null;

    const folderPath = payload.folder_path || mapping?.folder_path || 'Inbox';

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

    return json({ success: true, file_id: insert.meta.last_row_id });
  }

  await env.DB.prepare(
    'INSERT INTO bot_events (bot_id, source_id, event_type, payload_json, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(bot.id, source?.id || null, event_type || 'unknown', JSON.stringify(payload), 'processed').run();

  return json({ success: true });
}
