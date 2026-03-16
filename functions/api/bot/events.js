import { ingestBotPayload } from '../../../server/bot-ingest.js';

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

  const rawPayload = await request.json();
  const result = await ingestBotPayload({ env, bot, rawPayload, source: 'webhook' });

  if (!result?.success) {
    return json({ message: result?.message || 'Falha ao processar evento.' }, result?.status || 400);
  }

  return json(result);
}
