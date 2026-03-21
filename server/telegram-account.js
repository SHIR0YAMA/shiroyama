import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

let telegramLib;

function toBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

async function loadTelegramLib() {
  if (!telegramLib) telegramLib = await import('telegram');
  return telegramLib;
}

function resolveMessageFileMeta(message) {
  const media = message?.media;
  const document = media?.document || null;
  if (document) {
    return {
      mediaRef: media,
      contentLength: Number(document.size || 0) || null
    };
  }

  const photo = media?.photo || null;
  if (photo) {
    return {
      mediaRef: media,
      contentLength: null
    };
  }

  return null;
}

export async function downloadTelegramMedia({ apiId, apiHash, session, chatId, messageId, mockDir, useMock, chunkSize = 1024 * 1024 }) {
  const shouldUseMock = toBool(useMock);

  if (shouldUseMock) {
    if (!mockDir) throw new Error('TELEGRAM_USE_MOCK=true requer TELEGRAM_MOCK_DIR configurado.');
    const safeChat = String(chatId).replace(/[^0-9-]/g, '');
    const safeMessage = String(messageId).replace(/[^0-9]/g, '');
    const filePath = path.resolve(mockDir, `${safeChat}_${safeMessage}`);
    const expectedBase = path.resolve(mockDir);
    if (!filePath.startsWith(expectedBase)) throw new Error('Caminho de mock inválido.');
    if (!fs.existsSync(filePath)) throw new Error(`Arquivo mock não encontrado: ${filePath}`);
    const stat = fs.statSync(filePath);
    return { stream: fs.createReadStream(filePath), contentLength: stat.size, cleanup: async () => {} };
  }

  if (!apiId || !apiHash || !session) {
    throw new Error('Configuração Telegram ausente. Defina TELEGRAM_API_ID, TELEGRAM_API_HASH e TELEGRAM_SESSION.');
  }

  const { TelegramClient } = await loadTelegramLib();
  const { StringSession } = await import('telegram/sessions/index.js');

  const client = new TelegramClient(new StringSession(session), Number(apiId), apiHash, { connectionRetries: 3 });
  await client.connect();

  try {
    const messages = await client.getMessages(chatId, { ids: [Number(messageId)] });
    const message = Array.isArray(messages) ? messages[0] : messages;
    if (!message) throw new Error('Mensagem não encontrada no Telegram.');

    const fileMeta = resolveMessageFileMeta(message);
    if (!fileMeta?.mediaRef) throw new Error('Mensagem não contém mídia suportada para download.');

    const iterator = client.iterDownload({
      file: fileMeta.mediaRef,
      requestSize: Number(chunkSize) || 1024 * 1024
    });

    const stream = Readable.from((async function* generate() {
      for await (const chunk of iterator) {
        yield chunk;
      }
    })());

    return {
      stream,
      contentLength: fileMeta.contentLength,
      cleanup: async () => {
        try {
          await client.disconnect();
        } catch {
          // ignore disconnect errors
        }
      }
    };
  } catch (error) {
    try {
      await client.disconnect();
    } catch {
      // ignore disconnect errors
    }
    throw error;
  }
}

export async function uploadTelegramMedia({ apiId, apiHash, session, chatId, filePath, fileName, caption, mockDir, useMock }) {
  const shouldUseMock = toBool(useMock);

  if (shouldUseMock) {
    if (!mockDir) throw new Error('TELEGRAM_USE_MOCK=true requer TELEGRAM_MOCK_DIR configurado.');
    const messageId = Date.now();
    const safeChat = String(chatId).replace(/[^0-9-]/g, '');
    const target = path.resolve(mockDir, `${safeChat}_${messageId}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(filePath, target);
    return { messageId, chatId: String(chatId), fileRef: fileName || path.basename(filePath) };
  }

  if (!apiId || !apiHash || !session) {
    throw new Error('Configuração Telegram ausente. Defina TELEGRAM_API_ID, TELEGRAM_API_HASH e TELEGRAM_SESSION.');
  }

  const { TelegramClient } = await loadTelegramLib();
  const { StringSession } = await import('telegram/sessions/index.js');
  const client = new TelegramClient(new StringSession(session), Number(apiId), apiHash, { connectionRetries: 3 });
  await client.connect();

  try {
    const sent = await client.sendFile(chatId, {
      file: filePath,
      caption: caption || '',
      forceDocument: true,
      workers: 1,
      fileName: fileName || path.basename(filePath)
    });

    return {
      messageId: sent?.id,
      chatId: String(chatId),
      fileRef: sent?.media?.document?.id ? String(sent.media.document.id) : null
    };
  } finally {
    await client.disconnect();
  }
}
