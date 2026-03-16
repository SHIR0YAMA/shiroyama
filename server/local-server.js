import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { D1Database } from './d1-adapter.js';
import { LocalKVStore } from './kv-store.js';
import { startBotPolling } from './bot-polling.js';

const projectRoot = path.resolve(process.cwd());
const functionsDir = path.join(projectRoot, 'functions');
const publicDir = path.join(projectRoot, 'public');

const env = {
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  DB: new D1Database(path.resolve(process.env.DB_PATH ?? './data/app.db')),
  ARQUIVOS_TELEGRAM: new LocalKVStore(path.resolve(process.env.KV_PATH ?? './data/arquivos-telegram.json')),
  TELEGRAM_API_ID: process.env.TELEGRAM_API_ID ?? '',
  TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH ?? '',
  TELEGRAM_SESSION: process.env.TELEGRAM_SESSION ?? '',
  TELEGRAM_MOCK_DIR: process.env.TELEGRAM_MOCK_DIR ?? '',
  TELEGRAM_USE_MOCK: process.env.TELEGRAM_USE_MOCK ?? 'false',
  BOT_WEBHOOK_BASE_URL: process.env.BOT_WEBHOOK_BASE_URL ?? '',
  BOT_TOKEN_ENC_KEY: process.env.BOT_TOKEN_ENC_KEY ?? ''
};

const middlewareModule = await import(pathToFileURL(path.join(functionsDir, 'api/_middleware.js')).href);
const middlewares = Array.isArray(middlewareModule.onRequest)
  ? middlewareModule.onRequest
  : [];

async function resolveApiRoute(pathname) {
  const exactPath = path.join(functionsDir, `${pathname}.js`);
  try {
    await fs.access(exactPath);
    return { filePath: exactPath, params: {} };
  } catch {
    const segments = pathname.split('/').filter(Boolean);
    for (let i = segments.length; i >= 0; i -= 1) {
      const prefixSegments = segments.slice(0, i);
      const remainder = segments.slice(i);
      const catchallPath = path.join(functionsDir, ...prefixSegments, '[[catchall]].js');
      try {
        await fs.access(catchallPath);
        return { filePath: catchallPath, params: { catchall: remainder } };
      } catch {
        // continue searching
      }
    }
    return null;
  }
}

function methodExportName(method) {
  return `onRequest${method[0]}${method.slice(1).toLowerCase()}`;
}

async function runWithMiddleware(context, handler) {
  async function execute(index) {
    if (index < middlewares.length) {
      const middleware = middlewares[index];
      return middleware({
        ...context,
        next: () => execute(index + 1)
      });
    }
    return handler(context);
  }

  return execute(0);
}

async function serveStatic(pathname) {
  const filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname.slice(1));
  if (!filePath.startsWith(publicDir)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const data = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentTypes[extension] ?? 'application/octet-stream'
      }
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

async function handleFetch(request) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(url.pathname);
  }

  const route = await resolveApiRoute(url.pathname);
  if (!route) {
    return new Response(JSON.stringify({ message: 'Rota não encontrada.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const module = await import(pathToFileURL(route.filePath).href);
  const handler = module.onRequest ?? module[methodExportName(request.method)];

  if (!handler) {
    return new Response(JSON.stringify({ message: `Método ${request.method} não permitido.` }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const context = {
    request,
    env,
    params: route.params,
    data: {}
  };

  return runWithMiddleware(context, handler);
}

const server = http.createServer(async (req, res) => {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url}`;
  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : req,
    duplex: 'half'
  });

  try {
    const response = await handleFetch(request);
    res.statusCode = response.status;

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(response.body);
    stream.on('error', (streamError) => {
      console.error('Erro no stream de resposta:', streamError);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify({ message: 'Erro ao transmitir resposta.' }));
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Erro no servidor local:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Erro interno no servidor local.' }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`Servidor local ativo em http://localhost:${port}`);
  startBotPolling(env);
});
