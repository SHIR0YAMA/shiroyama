function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function requirePermission(user, permission) {
  return user?.permissions?.includes(permission) || user?.level === 0;
}

function maskToken(token) {
  const clean = String(token || '').trim();
  if (!clean) return null;
  return `${clean.slice(0, 8)}...${clean.slice(-6)}`;
}

async function configureWebhook(botToken, botName, botSecret, env) {
  const baseUrl = String(env.BOT_WEBHOOK_BASE_URL || '').trim();
  if (!baseUrl) return { configured: false, reason: 'BOT_WEBHOOK_BASE_URL não configurado' };

  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/bot/events?bot_name=${encodeURIComponent(botName)}&bot_secret=${encodeURIComponent(botSecret)}`;
  const apiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'channel_post', 'edited_message', 'edited_channel_post', 'my_chat_member', 'chat_member'],
      drop_pending_updates: false
    })
  });

  const payload = await response.json();
  console.log('[bots] setWebhook response', { botName, ok: payload.ok, description: payload.description || null });
  if (!payload.ok) {
    return { configured: false, reason: payload.description || 'Falha ao configurar webhook' };
  }

  return { configured: true, webhookUrl };
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!requirePermission(data.user, 'bots:manage')) return json({ message: 'Acesso negado.' }, 403);

  const { results } = await env.DB.prepare(`
    SELECT b.id, b.bot_name, b.bot_username, b.bot_token_ref, b.is_active, b.created_at,
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
    const botName = String(payload.bot_name || '').trim();
    const botToken = String(payload.bot_token || '').trim();
    if (!botName) return json({ message: 'Informe um nome local para o bot.' }, 400);
    if (!botToken || !botToken.includes(':')) return json({ message: 'Token do bot inválido.' }, 400);

    const secret = payload.webhook_secret || crypto.randomUUID();
    const tokenRef = maskToken(botToken);

    const stmt = env.DB.prepare(`
      INSERT INTO telegram_bots (bot_name, bot_username, bot_token_ref, webhook_secret, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).bind(botName, null, tokenRef, secret, payload.is_active === false ? 0 : 1);
    const { meta } = await stmt.run();

    const webhook = await configureWebhook(botToken, botName, secret, env);
    return json({ success: true, id: meta.last_row_id, webhook_secret: secret, webhook }, 201);
  }

  if (action === 'update') {
    const botName = String(payload.bot_name || '').trim();
    if (!botName) return json({ message: 'Nome local do bot é obrigatório.' }, 400);

    await env.DB.prepare(`
      UPDATE telegram_bots
      SET bot_name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(botName, payload.is_active ? 1 : 0, payload.id).run();
    return json({ success: true });
  }

  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM telegram_bots WHERE id = ?').bind(payload.id).run();
    return json({ success: true });
  }

  return json({ message: 'Ação inválida.' }, 400);
}
