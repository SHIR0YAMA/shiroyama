import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const rl = readline.createInterface({ input, output });

try {
  const apiId = Number(await rl.question('TELEGRAM_API_ID: '));
  const apiHash = (await rl.question('TELEGRAM_API_HASH: ')).trim();

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
  await client.start({
    phoneNumber: async () => (await rl.question('Telefone (ex: +5511999999999): ')).trim(),
    password: async () => (await rl.question('Senha 2FA (se houver, senão Enter): ')).trim(),
    phoneCode: async () => (await rl.question('Código recebido no Telegram: ')).trim(),
    onError: (err) => console.error('Erro de autenticação:', err.message)
  });

  const session = client.session.save();
  console.log('\nSessão gerada com sucesso.');
  console.log('TELEGRAM_SESSION=' + session);
  await client.disconnect();
} finally {
  rl.close();
}
