# Shiroyama Files — arquitetura híbrida local (Debian + Node.js + SQLite + Telegram)

## Visão geral

Esta versão roda localmente em Debian mantendo a estrutura do projeto:
- `public/` (front-end)
- `functions/api/*` (rotas/handlers)
- middleware existente
- runtime local Node.js
- SQLite local

## Arquitetura final

### Bots Telegram (somente sync/eventos administrativos)
Bots são usados apenas para:
- ingestão/sincronização de grupos/canais
- eventos de entrada/saída
- notificação de metadados de mensagens/arquivos
- organização da listagem por grupo/canal/pasta

**Bots não fazem upload/download real de arquivos grandes.**

No painel admin (aba **Bots & Canais**) você consegue:
- cadastrar bot existente (criado no BotFather)
- ativar/desativar bot
- remover bot
- criar/remover vínculo bot -> canal/grupo -> pasta

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
- `BOT_WEBHOOK_BASE_URL` (opcional: tenta configurar webhook automaticamente ao cadastrar bot)

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

### Upload real via perfil Telegram (MTProto)
`POST /api/files/upload`
- Auth JWT
- multipart/form-data:
  - `file`
  - `telegram_chat_id`
  - `folder_path` (opcional)
  - `caption` (opcional)

### Download real via perfil Telegram (MTProto)
`GET /api/files/:id/download`
- Auth JWT
- stream com `Content-Disposition: attachment`

### Bots (eventos autenticados)
`POST /api/bot/events`
- autenticação por bot:
  - headers `x-bot-name` + `x-bot-secret`
  - ou query params `bot_name` + `bot_secret` (útil para webhook)
- eventos aceitos (`event_type`):
  - `source_joined`
  - `source_left`
  - `file_detected`

### Admin (bots e mapeamentos)
- `GET/POST /api/admin/bots`
- `GET/POST /api/admin/bot-mappings`

## Fluxo recomendado de bots

1. Criar bot no BotFather.
2. Cadastrar no site informando:
   - nome local (organizacional)
   - token do bot
3. Criar vínculo bot -> chat_id -> pasta (com seletor de pasta na UI).
4. Bot envia eventos para `/api/bot/events` autenticado.

### Webhook automático (opcional)
Se `BOT_WEBHOOK_BASE_URL` estiver definido, ao cadastrar o bot o sistema tenta registrar webhook automaticamente no Telegram para:
`<BASE_URL>/api/bot/events?bot_name=<...>&bot_secret=<...>`.

## Fluxos legados de bot removidos do fluxo principal
As rotas antigas retornam `410 Gone`:
- `/api/single-forward`
- `/api/bulk-forward`
- `/api/webhook`
- `/api/download`
- `/api/user/prepare-link-code`
- `/api/user/unlink-telegram`
- `/api/admin/unlink-user-telegram`


## Logs de ingestão (debug)

O servidor registra no stdout:
- webhook recebido em `/api/bot/events`
- source_joined/source_left processado
- arquivo detectado
- pasta mapeada aplicada (`mappingApplied`)

Esses logs ajudam a validar rapidamente o pipeline bot -> evento -> arquivo em ambiente local.
