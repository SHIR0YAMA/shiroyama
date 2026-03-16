import crypto from 'node:crypto';
import { ingestBotPayload } from './bot-ingest.js';

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

  if (raw.length >= 32) return crypto.createHash('sha256').update(raw).digest();
  return null;
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

async function callTelegram(botToken, method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export function startBotPolling(env) {
  const hasWebhookBase = Boolean(String(env.BOT_WEBHOOK_BASE_URL || '').trim());
  if (hasWebhookBase) {
    console.log('[bot-polling] BOT_WEBHOOK_BASE_URL configurado; polling será usado apenas para bots sem webhook confirmado.');
  } else {
    console.log('[bot-polling] BOT_WEBHOOK_BASE_URL ausente; iniciando modo polling para bots ativos.');
  }

  const offsets = new Map();
  const tokenWarningByBot = new Set();

  let schemaWarningPrinted = false;

  const ensureSchemaReady = async () => {
    try {
      const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'telegram_bots' LIMIT 1").first();
      return !!table;
    } catch {
      return false;
    }
  };

  const runCycle = async () => {
    try {
      const ready = await ensureSchemaReady();
      if (!ready) {
        if (!schemaWarningPrinted) {
          console.warn('[bot-polling] tabela telegram_bots não encontrada. Execute db:init + db:migrate para habilitar polling.');
          schemaWarningPrinted = true;
        }
        return;
      }
      schemaWarningPrinted = false;

      const { results: bots } = await env.DB.prepare(
        'SELECT id, bot_name, webhook_secret, bot_token_enc, is_active FROM telegram_bots WHERE is_active = 1 ORDER BY id ASC'
      ).all();

      for (const bot of bots) {
        const token = decryptBotToken(bot.bot_token_enc, env);
        if (!token) {
          if (!tokenWarningByBot.has(bot.id)) {
            console.warn('[bot-polling] token indisponível para bot ativo', { bot: bot.bot_name, botId: bot.id });
            tokenWarningByBot.add(bot.id);
          }
          continue;
        }
        tokenWarningByBot.delete(bot.id);

        let canPoll = !hasWebhookBase;
        if (hasWebhookBase) {
          try {
            const webhookInfo = await callTelegram(token, 'getWebhookInfo');
            const webhookUrl = webhookInfo?.result?.url || '';
            canPoll = webhookInfo?.ok ? !webhookUrl : true;
            if (!canPoll) {
              console.log('[bot-polling] webhook ativo; polling ignorado para bot', { bot: bot.bot_name, webhookUrl });
            }
          } catch (error) {
            console.warn('[bot-polling] falha ao verificar webhook; fallback para polling', { bot: bot.bot_name, error: error?.message || String(error) });
            canPoll = true;
          }
        }

        if (!canPoll) continue;

        const offset = offsets.get(bot.id) || 0;
        console.log('[bot-polling] bot em polling', { bot: bot.bot_name, offset });

        let updatesResp;
        try {
          updatesResp = await callTelegram(token, 'getUpdates', {
            offset,
            timeout: 20,
            allowed_updates: ['message', 'channel_post', 'edited_message', 'edited_channel_post', 'my_chat_member', 'chat_member']
          });
        } catch (error) {
          console.error('[bot-polling] erro ao chamar getUpdates', { bot: bot.bot_name, error: error?.message || String(error) });
          continue;
        }

        if (!updatesResp?.ok) {
          console.warn('[bot-polling] getUpdates falhou', { bot: bot.bot_name, description: updatesResp?.description || null });
          continue;
        }

        const updates = Array.isArray(updatesResp.result) ? updatesResp.result : [];
        for (const update of updates) {
          const updateId = Number(update.update_id || 0);
          offsets.set(bot.id, updateId + 1);

          const updateType = update?.message ? 'message' : update?.channel_post ? 'channel_post' : update?.my_chat_member ? 'my_chat_member' : 'custom';
          const chatId = update?.message?.chat?.id || update?.channel_post?.chat?.id || update?.my_chat_member?.chat?.id || null;
          console.log('[bot-polling] update recebido', { bot: bot.bot_name, updateId, updateType, chatId });

          const result = await ingestBotPayload({
            env,
            bot: { id: bot.id, bot_name: bot.bot_name },
            rawPayload: update,
            source: 'polling'
          });

          if (!result?.success) {
            console.warn('[bot-polling] falha ao processar update', { bot: bot.bot_name, updateId, message: result?.message || 'erro desconhecido' });
          }
        }
      }
    } catch (error) {
      console.error('[bot-polling] erro no ciclo de polling', error);
    } finally {
      setTimeout(runCycle, 1500);
    }
  };

  runCycle();
}
