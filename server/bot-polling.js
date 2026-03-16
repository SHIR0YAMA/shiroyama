import { ingestBotPayload } from './bot-ingest.js';

async function callTelegram(botToken, method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export function startBotPolling(env) {
  const botToken = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) {
    console.warn('[bot-polling] TELEGRAM_BOT_TOKEN não configurado; polling/webhook desativado.');
    return;
  }

  const hasWebhookBase = Boolean(String(env.BOT_WEBHOOK_BASE_URL || '').trim());
  if (hasWebhookBase) {
    console.log('[bot-polling] BOT_WEBHOOK_BASE_URL configurado; polling será usado apenas se webhook estiver ausente.');
  } else {
    console.log('[bot-polling] BOT_WEBHOOK_BASE_URL ausente; iniciando modo polling com bot único.');
  }

  let offset = 0;

  const runCycle = async () => {
    try {
      let canPoll = !hasWebhookBase;
      if (hasWebhookBase) {
        try {
          const webhookInfo = await callTelegram(botToken, 'getWebhookInfo');
          const webhookUrl = webhookInfo?.result?.url || '';
          canPoll = webhookInfo?.ok ? !webhookUrl : true;
          if (!canPoll) {
            console.log('[bot-polling] webhook ativo; polling ignorado para bot único', { webhookUrl });
          }
        } catch (error) {
          console.warn('[bot-polling] falha ao verificar webhook; fallback para polling', { error: error?.message || String(error) });
          canPoll = true;
        }
      }

      if (!canPoll) return;

      const updatesResp = await callTelegram(botToken, 'getUpdates', {
        offset,
        timeout: 20,
        allowed_updates: ['message', 'channel_post', 'edited_message', 'edited_channel_post', 'my_chat_member', 'chat_member']
      });

      if (!updatesResp?.ok) {
        console.warn('[bot-polling] getUpdates falhou', { description: updatesResp?.description || null });
        return;
      }

      const updates = Array.isArray(updatesResp.result) ? updatesResp.result : [];
      for (const update of updates) {
        const updateId = Number(update.update_id || 0);
        offset = updateId + 1;

        const updateType = update?.message ? 'message' : update?.channel_post ? 'channel_post' : update?.my_chat_member ? 'my_chat_member' : 'custom';
        const chatId = update?.message?.chat?.id || update?.channel_post?.chat?.id || update?.my_chat_member?.chat?.id || null;
        console.log('[bot-polling] update recebido', { bot: 'single_bot', updateId, updateType, chatId });

        const result = await ingestBotPayload({
          env,
          bot: { id: null, bot_name: 'single_bot' },
          rawPayload: update,
          source: 'polling'
        });

        if (!result?.success) {
          console.warn('[bot-polling] falha ao processar update', { updateId, message: result?.message || 'erro desconhecido' });
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
