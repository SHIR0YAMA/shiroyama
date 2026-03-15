# Shiroyama Files — arquitetura híbrida local (Debian + Node.js + SQLite + Telegram)

## Visão geral

Esta versão roda localmente em Debian mantendo a estrutura do projeto:
- `public/` (front-end)
- `functions/api/*` (rotas/handlers)
- middleware existente
- runtime local Node.js
- SQLite local

## Arquitetura final

### 1) Bots Telegram (somente sync/eventos)
Bots são usados apenas para:
- ingestão/sincronização de grupos/canais
- eventos de entrada/saída
- notificação de metadados de mensagens/arquivos
- organização da listagem por grupo/canal/pasta

Bots **não** fazem upload/download real de arquivos grandes.

No painel admin (aba **Bots & Canais**) você consegue:
- cadastrar bot
- ativar/desativar bot
- remover bot
- criar/remover vínculo bot -> canal/grupo -> pasta

### 2) Conta/perfil Telegram autenticada (MTProto)
Conta/perfil autenticado é usado para:
- upload real via site
- download real via site

Ou seja, transferências grandes de arquivo sempre passam pelo perfil Telegram autenticado.

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
- Headers:
  - `x-bot-name`
  - `x-bot-secret`
- Body (`event_type`):
  - `source_joined`
  - `source_left`
  - `file_detected`

### Admin (bots e mapeamentos)
- `GET/POST /api/admin/bots`
- `GET/POST /api/admin/bot-mappings`

## Fluxos legados de bot removidos do fluxo principal
As rotas antigas retornam `410 Gone`:
- `/api/single-forward`
- `/api/bulk-forward`
- `/api/webhook`
- `/api/download`
- `/api/user/prepare-link-code`
- `/api/user/unlink-telegram`
- `/api/admin/unlink-user-telegram`

## Teste rápido (local)

1. Criar bot:
```bash
curl -X POST http://localhost:3000/api/admin/bots -H "Authorization: Bearer <JWT>" -H "content-type: application/json" -d '{"action":"create","bot_name":"animes_bot"}'
```
2. Vincular bot/canal/pasta:
```bash
curl -X POST http://localhost:3000/api/admin/bot-mappings -H "Authorization: Bearer <JWT>" -H "content-type: application/json" -d '{"action":"upsert","bot_id":1,"telegram_chat_id":"-100123","source_name":"Animes","folder_path":"Animes"}'
```
3. Ingestão por bot:
```bash
curl -X POST http://localhost:3000/api/bot/events -H "x-bot-name: animes_bot" -H "x-bot-secret: <SECRET>" -H "content-type: application/json" -d '{"event_type":"file_detected","telegram_chat_id":"-100123","telegram_message_id":101,"file_name":"ep1.mkv","file_size":123}'
```
4. Upload via perfil:
```bash
curl -X POST http://localhost:3000/api/files/upload -H "Authorization: Bearer <JWT>" -F "file=@./video.mp4" -F "telegram_chat_id=-100123" -F "folder_path=Animes"
```
5. Listar e baixar:
```bash
curl -H "Authorization: Bearer <JWT>" http://localhost:3000/api/files
curl -H "Authorization: Bearer <JWT>" -OJ http://localhost:3000/api/files/1/download
```
