function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function canManage(user) {
  return user?.permissions?.includes('bots:manage') || user?.level === 0;
}

export async function onRequestGet(context) {
  const { env, data } = context;
  if (!canManage(data.user)) return json({ message: 'Acesso negado.' }, 403);

  const { results } = await env.DB.prepare(`
    SELECT id, source_name, source_type, telegram_chat_id, folder_path, is_active, created_at, updated_at
    FROM telegram_sources
    ORDER BY id DESC
  `).all();

  return json({ success: true, mappings: results });
}

export async function onRequestPost(context) {
  const { env, data, request } = context;
  if (!canManage(data.user)) return json({ message: 'Acesso negado.' }, 403);

  const payload = await request.json();
  const action = payload?.action || 'upsert';

  if (action === 'delete') {
    const id = Number(payload.id || 0);
    if (!id) return json({ message: 'ID inválido.' }, 400);
    await env.DB.prepare('DELETE FROM telegram_sources WHERE id = ?').bind(id).run();
    return json({ success: true });
  }

  const chatId = String(payload.telegram_chat_id || '').trim();
  const sourceName = String(payload.source_name || '').trim();
  const folderPath = String(payload.folder_path || '').trim();
  const sourceType = String(payload.source_type || 'channel').trim();
  const isActive = payload.is_active === false ? 0 : 1;

  if (!chatId) return json({ message: 'telegram_chat_id é obrigatório.' }, 400);
  if (!folderPath) return json({ message: 'folder_path é obrigatório.' }, 400);

  if (payload.id) {
    await env.DB.prepare(`
      UPDATE telegram_sources
      SET source_name = ?, source_type = ?, telegram_chat_id = ?, folder_path = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(sourceName || null, sourceType || 'channel', chatId, folderPath, isActive, Number(payload.id)).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO telegram_sources (source_name, source_type, telegram_chat_id, folder_path, is_active)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_chat_id) DO UPDATE SET
        source_name = excluded.source_name,
        source_type = excluded.source_type,
        folder_path = excluded.folder_path,
        is_active = excluded.is_active,
        updated_at = CURRENT_TIMESTAMP
    `).bind(sourceName || null, sourceType || 'channel', chatId, folderPath, isActive).run();
  }

  return json({ success: true });
}
