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
    SELECT b.id, b.bot_name, b.bot_username, b.is_active, b.created_at,
           COUNT(m.id) as mapping_count
    FROM telegram_bots b
    LEFT JOIN bot_source_mappings m ON m.bot_id = b.id
    GROUP BY b.id
    ORDER BY b.bot_name ASC
  `).all();

  return json({ success: true, bots: results });
}

export async function onRequestPost(context) {
  const { data, env, request } = context;
  if (!requirePermission(data.user, 'bots:manage')) return json({ message: 'Acesso negado.' }, 403);

  const payload = await request.json();
  const action = payload.action || 'create';

  if (action === 'create') {
    const secret = payload.webhook_secret || crypto.randomUUID();
    const stmt = env.DB.prepare(`
      INSERT INTO telegram_bots (bot_name, bot_username, bot_token_ref, webhook_secret, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).bind(payload.bot_name, payload.bot_username || null, payload.bot_token_ref || null, secret, payload.is_active === false ? 0 : 1);
    const { meta } = await stmt.run();
    return json({ success: true, id: meta.last_row_id, webhook_secret: secret }, 201);
  }

  if (action === 'update') {
    await env.DB.prepare(`
      UPDATE telegram_bots
      SET bot_name = ?, bot_username = ?, bot_token_ref = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(payload.bot_name, payload.bot_username || null, payload.bot_token_ref || null, payload.is_active ? 1 : 0, payload.id).run();
    return json({ success: true });
  }

  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM telegram_bots WHERE id = ?').bind(payload.id).run();
    return json({ success: true });
  }

  return json({ message: 'Ação inválida.' }, 400);
}
