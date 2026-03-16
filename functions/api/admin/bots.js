import crypto from 'node:crypto';

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

function deriveCryptoKey(env) {
  const raw = String(env.BOT_TOKEN_ENC_KEY || '').trim();
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');

  try {
    const base64Key = Buffer.from(raw, 'base64');
    if (base64Key.length === 32) return base64Key;
  } catch {
    // ignore
  }

  if (raw.length >= 32) {
    return crypto.createHash('sha256').update(raw).digest();
  }

  return null;
}

function encryptBotToken(token, env) {
  const key = deriveCryptoKey(env);
  const plain = String(token || '').trim();
  if (!plain) return null;

  if (!key) {
    return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptBotToken(tokenBlob, env) {
  if (!tokenBlob) return null;
  const raw = String(tokenBlob);

  if (raw.startsWith('plain:')) {
    try {
      return Buffer.from(raw.slice(6), 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  const [version, ivB64, tagB64, dataB64] = raw.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;

  const key = deriveCryptoKey(env);
  if (!key) return null;

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

async function callTelegramBotApi(botToken, method, payload) {
  const apiUrl = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : '{}'
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = { ok: false, description: 'Resposta inválida da API Telegram.' };
  }

  return body;
}

async function configureWebhook(botToken, botName, botSecret, env) {
  const baseUrl = String(env.BOT_WEBHOOK_BASE_URL || '').trim();
  if (!baseUrl) return { configured: false, reason: 'BOT_WEBHOOK_BASE_URL não configurado' };

  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/bot/events?bot_name=${encodeURIComponent(botName)}&bot_secret=${encodeURIComponent(botSecret)}`;
  console.log('[bots] tentando setWebhook', { botName, webhookUrl });

  const payload = await callTelegramBotApi(botToken, 'setWebhook', {
    url: webhookUrl,
    allowed_updates: ['message', 'channel_post', 'edited_message', 'edited_channel_post', 'my_chat_member', 'chat_member'],
    drop_pending_updates: false
  });

  console.log('[bots] setWebhook response', { botName, ok: payload.ok, description: payload.description || null });
  if (!payload.ok) {
    return { configured: false, reason: payload.description || 'Falha ao configurar webhook' };
  }

  const info = await callTelegramBotApi(botToken, 'getWebhookInfo', {});
  const resultUrl = info?.result?.url || '';
  const configured = Boolean(info?.ok && resultUrl === webhookUrl);

  return {
    configured,
    webhookUrl,
    telegramWebhookUrl: resultUrl,
    reason: configured ? null : 'Webhook não confirmado pelo Telegram.'
  };
}

async function disableWebhook(botToken, botName) {
  const payload = await callTelegramBotApi(botToken, 'deleteWebhook', { drop_pending_updates: false });
  console.log('[bots] deleteWebhook response', { botName, ok: payload.ok, description: payload.description || null });
  return payload.ok ? { configured: false } : { configured: true, reason: payload.description || 'Falha ao remover webhook' };
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

    const me = await callTelegramBotApi(botToken, 'getMe', {});
    if (!me.ok) return json({ message: `Token inválido no Telegram: ${me.description || 'erro desconhecido'}` }, 400);

    const secret = payload.webhook_secret || crypto.randomUUID();
    const tokenRef = maskToken(botToken);
    const tokenEnc = encryptBotToken(botToken, env);

    const stmt = env.DB.prepare(`
      INSERT INTO telegram_bots (bot_name, bot_username, bot_token_ref, bot_token_enc, webhook_secret, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(botName, me.result?.username || null, tokenRef, tokenEnc, secret, payload.is_active === false ? 0 : 1);

    const { meta } = await stmt.run();
    let webhook = { configured: false, reason: 'Bot cadastrado sem ativação de webhook.' };

    if (payload.is_active !== false) {
      webhook = await configureWebhook(botToken, botName, secret, env);
    }

    return json({ success: true, id: meta.last_row_id, webhook_secret: secret, webhook }, 201);
  }

  if (action === 'update') {
    const id = Number(payload.id);
    const botName = String(payload.bot_name || '').trim();
    if (!id || !botName) return json({ message: 'ID e nome local do bot são obrigatórios.' }, 400);

    const current = await env.DB.prepare('SELECT id, bot_name, webhook_secret, bot_token_enc, is_active FROM telegram_bots WHERE id = ?').bind(id).first();
    if (!current) return json({ message: 'Bot não encontrado.' }, 404);

    const nextIsActive = payload.is_active ? 1 : 0;
    await env.DB.prepare(`
      UPDATE telegram_bots
      SET bot_name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(botName, nextIsActive, id).run();

    const token = decryptBotToken(current.bot_token_enc, env);
    if (!token) {
      return json({ success: true, webhook: { configured: false, reason: 'Token do bot indisponível para configurar webhook.' } });
    }

    const webhook = nextIsActive
      ? await configureWebhook(token, botName, current.webhook_secret, env)
      : await disableWebhook(token, botName);

    return json({ success: true, webhook });
  }

  if (action === 'delete') {
    await env.DB.prepare('DELETE FROM telegram_bots WHERE id = ?').bind(payload.id).run();
    return json({ success: true });
  }

  return json({ message: 'Ação inválida.' }, 400);
}
