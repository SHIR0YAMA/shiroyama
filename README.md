# Shiroyama Files — arquitetura híbrida local (Debian + Node.js + SQLite + Telegram)

## Visão geral

Esta versão roda localmente em Debian mantendo a estrutura do projeto:
- `public/` (front-end)
- `functions/api/*` (rotas/handlers)
- middleware existente
- runtime local Node.js
- SQLite local

## Arquitetura final

### Bot Telegram único (somente sync/eventos administrativos)
Um único bot é usado no backend via `.env` (`TELEGRAM_BOT_TOKEN`) para:
- ingestão/sincronização de grupos/canais
- eventos de entrada/saída
- metadados de mensagens/arquivos
- download otimizado via Bot API local para arquivos menores

**O token do bot nunca passa pelo frontend e não é salvo no painel.**

No painel admin (aba **Fontes Telegram**) você consegue:
- cadastrar/editar fontes monitoradas
- definir `telegram_chat_id` e `folder_path`
- ativar/desativar cada fonte
- excluir vínculo de monitoramento

### Conta/perfil Telegram autenticada (MTProto)
Conta/perfil autenticado é usado para:
- upload real via site
- download real via site

Ou seja, transferências grandes de arquivo passam pelo perfil Telegram autenticado.

## Variáveis de ambiente

### Obrigatórias (produção real)
- `JWT_SECRET`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`

### Opcionais
- `PORT` (default: `3000`)
- `DB_PATH` (default: `./data/app.db`)
- `KV_PATH` (legado)
- `TELEGRAM_USE_MOCK` (`true|false`, default `false`)
- `TELEGRAM_MOCK_DIR` (somente quando `TELEGRAM_USE_MOCK=true`)
- `BOT_WEBHOOK_BASE_URL` (URL pública HTTPS do seu servidor para registrar webhook real; se ausente, o bot único entra em polling `getUpdates`)
- `TELEGRAM_BOT_TOKEN` (token do bot usado internamente no backend para stream de download <= 2000 MiB via Bot API local)
- `BOT_API_BASE` (default: `http://127.0.0.1:8081`, endpoint do Bot API server local)

## Gerando e reutilizando sessão Telegram

```bash
npm run telegram:session
```

O script solicita API ID/HASH, telefone, código e 2FA (se houver), e imprime:
`TELEGRAM_SESSION=...`

Armazene em `.env` com permissão restrita (`chmod 600`) e reutilize nos reinícios.

## Banco local

```bash
npm run db:init
npm run db:migrate
```

## Subir servidor

```bash
npm run start
```

ou dev:

```bash
npm run dev
```

## Endpoints principais

### Horário exibido no front
- O banco mantém timestamps em UTC (`CURRENT_TIMESTAMP`).
- O front converte e exibe em `America/Sao_Paulo` (UTC-3/Brasília) para consistência visual local.


### Upload real via perfil Telegram (MTProto)
`POST /api/files/upload`
- Auth JWT
- multipart/form-data:
  - `file`
  - `telegram_chat_id`
  - `folder_path` (opcional)
  - `caption` (opcional)

### Download híbrido (`GET /api/files/:id/download`)
- Auth JWT + validação de permissão por pasta
- decisão por tamanho (`file_size`):
  - `<= 2000 MiB` + `telegram_file_id` presente: `bot_api_stream` (backend abre stream no Bot API local e retransmite ao navegador, sem expor token/URL interna)
  - `<= 2000 MiB` sem `telegram_file_id`: fallback `mtproto_stream` (`fallback=mtproto_missing_file_id`)
  - `> 2000 MiB` e `<= 4000 MiB`: `mtproto_stream` (stream Telegram -> servidor -> navegador)
  - `> 4000 MiB`: bloqueado com HTTP 413 (`Arquivo excede limite máximo de download (4000 MiB)`)
- logs de decisão:
  - `[download] fileId=... sizeMiB=... mode=...` (inclui `bot_api_local_file_stream`, `bot_api_http_stream` e fallbacks)
  - `[download-auth]` para negativas de autorização

### Bot único (eventos autenticados)
`POST /api/bot/events`
- autenticação por secret opcional do webhook:
  - header `x-telegram-bot-api-secret-token` (quando `BOT_WEBHOOK_SECRET` estiver configurado)
  - sem `BOT_WEBHOOK_SECRET`, o endpoint aceita webhook sem header extra
- eventos aceitos (`event_type`):
  - `source_joined`
  - `source_left`
  - `file_detected`

### Admin (fontes monitoradas)
- `GET/POST /api/admin/bot-mappings`


## Modo de ingestão do bot único (webhook x polling)

### Webhook (preferencial)
- Requisito: `BOT_WEBHOOK_BASE_URL` configurado e acessível publicamente via HTTPS.
- Quando configurado, o backend registra webhook para o bot único e confirma com `getWebhookInfo`.
- Se o webhook estiver confirmado, **polling não é usado**.

### Polling local (fallback automático)
- Quando `BOT_WEBHOOK_BASE_URL` **não** está configurado, o bot único usa `getUpdates` em loop no servidor local.
- O pipeline de persistência é o mesmo do webhook: update -> resolução por `telegram_chat_id` -> insert em `files`.

## Fluxo recomendado (bot único)

1. Configure `TELEGRAM_BOT_TOKEN` no backend.
2. Configure `BOT_WEBHOOK_BASE_URL` (opcional) e `BOT_WEBHOOK_SECRET` (recomendado).
3. No painel, abra **Fontes Telegram** e cadastre `chat_id -> pasta`.
4. Adicione o bot único aos grupos/canais monitorados.
5. Verifique ingestão por webhook/polling e downloads pelo endpoint `/api/files/:id/download`.

## Arquitetura de Bot Único

- O sistema usa apenas um bot configurado no backend (`TELEGRAM_BOT_TOKEN`).
- O painel não cadastra token de bot; apenas configura fontes monitoradas (`telegram_chat_id -> folder_path`).
- Se `BOT_WEBHOOK_BASE_URL` estiver definido e webhook ativo, polling fica em standby; sem webhook, usa polling.
