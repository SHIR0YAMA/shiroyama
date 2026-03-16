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
- `BOT_WEBHOOK_BASE_URL` (URL pública HTTPS do seu servidor para registrar webhook real; se ausente, bots ativos entram em polling `getUpdates`)
- `BOT_TOKEN_ENC_KEY` (recomendado para criptografar token do bot no SQLite; 32 bytes em base64 ou 64 hex)
- `DOWNLOAD_BOT_TOKEN` (token do bot usado para redirect de download <= 2000 MiB via Bot API local)
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
  - `<= 2000 MiB` + `telegram_file_id` presente: `bot_api_redirect` (HTTP 302 para Bot API local, sem proxy no Node)
  - `<= 2000 MiB` sem `telegram_file_id`: fallback `mtproto_stream` (`fallback=mtproto_missing_file_id`)
  - `> 2000 MiB` e `<= 4000 MiB`: `mtproto_stream` (stream Telegram -> servidor -> navegador)
  - `> 4000 MiB`: bloqueado com HTTP 413 (`Arquivo excede limite máximo de download (4000 MiB)`)
- logs de decisão:
  - `[download] fileId=... sizeMiB=... mode=...` (inclui fallback quando necessário)
  - `[download-auth]` para negativas de autorização

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


## Modos de ingestão de bots (webhook x polling)

### Webhook (preferencial)
- Requisito: `BOT_WEBHOOK_BASE_URL` configurado e acessível publicamente via HTTPS.
- Ao cadastrar/ativar bot, o sistema tenta `setWebhook` e confirma com `getWebhookInfo`.
- Se o webhook estiver confirmado para o bot, **polling não é usado** para esse bot.

### Polling local (fallback automático)
- Quando `BOT_WEBHOOK_BASE_URL` **não** está configurado, bots ativos usam `getUpdates` em loop no servidor local.
- O polling também pode atuar como fallback por bot quando webhook não estiver confirmado.
- O pipeline de persistência é o mesmo do webhook: update -> mapeamento bot/source/folder -> insert em `files`.

## Fluxo recomendado de bots

1. Criar bot no BotFather.
2. Cadastrar no site informando:
   - nome local (organizacional)
   - token do bot
3. Criar vínculo bot -> chat_id -> pasta (com seletor de pasta na UI).
4. Se o bot estiver ativo, o sistema chama `setWebhook` automaticamente (quando `BOT_WEBHOOK_BASE_URL` estiver configurado).
5. Bot envia updates para `/api/bot/events` autenticado.

### Webhook automático (recomendado)
Se `BOT_WEBHOOK_BASE_URL` estiver definido, ao cadastrar/ativar o bot o sistema registra webhook no Telegram para:
`<BASE_URL>/api/bot/events?bot_name=<...>&bot_secret=<...>`.

Para validar integração real:
1. Rode `getWebhookInfo` do bot no Telegram API e confirme que `url` não está vazio.
2. Envie arquivo no grupo/canal mapeado e acompanhe logs do Node (`[bots]`, `[bot-polling]` e `[bot-events]`).
3. Verifique listagem em `/api/files` na pasta vinculada.

### Teste rápido do modo polling
1. Remova/ignore `BOT_WEBHOOK_BASE_URL`.
2. Inicie servidor (`npm run start`/`npm run dev`).
3. Confirme logs `[bot-polling] bot em polling`.
4. Envie arquivo no grupo/canal mapeado e valide logs de ingestão + persistência.

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
