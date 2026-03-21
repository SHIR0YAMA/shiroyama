import { ingestBotPayload } from '../../../server/bot-ingest.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function authenticateSingleBot(env, request) {
  const configuredSecret = String(env.BOT_WEBHOOK_SECRET || '').trim();
  if (!configuredSecret) return true;
  const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token') || request.headers.get('x-bot-secret') || '';
  return receivedSecret === configuredSecret;
}

export async function onRequestPost(context) {
  const { env, request } = context;

  if (!authenticateSingleBot(env, request)) {
    return json({ message: 'Bot não autorizado.' }, 401);
  }

  const rawPayload = await request.json();
  const result = await ingestBotPayload({ env, bot: { id: null, bot_name: 'single_bot' }, rawPayload, source: 'webhook' });

  if (!result?.success) {
    return json({ message: result?.message || 'Falha ao processar evento.' }, result?.status || 400);
  }

  return json(result);
}
