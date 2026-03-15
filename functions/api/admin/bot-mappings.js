function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function requirePermission(user, permission) {
  return user?.permissions?.includes(permission) || user?.level === 0;
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!requirePermission(data.user, 'bots:manage')) return json({ message: 'Acesso negado.' }, 403);

  const { results } = await env.DB.prepare(`
    SELECT m.id, m.folder_path, m.is_active,
           b.id as bot_id, b.bot_name,
           s.id as source_id, s.telegram_chat_id, s.source_name, s.source_type
    FROM bot_source_mappings m
    JOIN telegram_bots b ON b.id = m.bot_id
    JOIN telegram_sources s ON s.id = m.source_id
    ORDER BY b.bot_name ASC, s.source_name ASC
  `).all();

  return json({ success: true, mappings: results });
}

export async function onRequestPost(context) {
  const { data, env, request } = context;
  if (!requirePermission(data.user, 'bots:manage')) return json({ message: 'Acesso negado.' }, 403);

  const payload = await request.json();
  const action = payload.action || 'upsert';

  if (action === 'upsert') {
    let source = await env.DB.prepare('SELECT id FROM telegram_sources WHERE telegram_chat_id = ?').bind(String(payload.telegram_chat_id)).first();
    if (!source) {
      const { meta } = await env.DB.prepare(
        'INSERT INTO telegram_sources (source_type, telegram_chat_id, source_name, is_active) VALUES (?, ?, ?, 1)'
      ).bind(payload.source_type || 'channel', String(payload.telegram_chat_id), payload.source_name || payload.folder_path).run();
      source = { id: meta.last_row_id };
    }

    await env.DB.prepare(`
      INSERT INTO bot_source_mappings (bot_id, source_id, folder_path, is_active)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(bot_id, source_id)
      DO UPDATE SET folder_path = excluded.folder_path, is_active = excluded.is_active, updated_at = CURRENT_TIMESTAMP
    `).bind(payload.bot_id, source.id, payload.folder_path || '', payload.is_active === false ? 0 : 1).run();

    return json({ success: true, source_id: source.id });
  }

  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM bot_source_mappings WHERE id = ?').bind(payload.id).run();
    return json({ success: true });
  }

  return json({ message: 'Ação inválida.' }, 400);
}
