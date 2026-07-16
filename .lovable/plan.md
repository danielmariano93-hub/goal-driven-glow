# Plano — Sessão WAHA isolada `nocontrole` + conexão real

## Causa raiz do estado atual
A arquitetura assumiu erroneamente que WAHA Core permite apenas uma sessão `default`. A documentação vigente confirma múltiplas sessões no mesmo container. O provider e a config no Vault fixaram `session_name=default`, o que impediria coexistir com a sessão do Sniper. Precisamos isolar o NoControle numa sessão dedicada, sem tocar em nenhuma outra.

## Escopo desta rodada
Único número, uma sessão exclusiva chamada `nocontrole` no Manager compartilhado. Nenhuma operação atinge `default`/`sniper`/outras. Conectar agora até QR ou WORKING.

## Mudanças

### 1. Vault / config canônica
- Atualizar registro no Vault (`_vault_upsert`) para `session_name = "nocontrole"`, mantendo `api_url`, `api_key`, `webhook_secret` já armazenados.
- Não expor o nome no frontend como editável (constante de projeto).

### 2. Provider `_shared/messaging/waha.ts`
- Remover fallback `"default"`. Session sempre vem da config carregada do Vault (`loadConfig()`); se ausente ou vazio, retornar erro `config_missing` — nunca cair em default.
- Todas as chamadas (`/api/sessions/{s}`, start/stop/logout/restart, `/api/{s}/auth/qr`, `/me`, sendText, webhook subscribe) usam a variável resolvida em runtime.
- Health/status/QR/me/restart/logout/stop passam a receber/usar o `session_name` da config.
- `listSessions()` (novo helper): apenas para verificar existência de `nocontrole`; nunca modifica outras.
- `ensureSession()`: se não existe → cria com metadata (`app: "nocontrole"`, `environment: production|beta`, `project: "nocontrole"`) e webhook apenas para essa sessão; se existe → PUT idempotente somente nos campos de config/webhook desta sessão (nunca em outras).

### 3. Edge functions
- `whatsapp-session/index.ts`: remover `body.session_name ?? "default"`. Ignorar qualquer `session_name` vindo do cliente; resolver internamente. Ações (`create`, `start`, `stop`, `logout`, `restart`, `qr`, `status`, `me`) sempre operam em `nocontrole`.
- `whatsapp-send/index.ts`: outbox força `session = nocontrole`.
- `whatsapp-webhook/index.ts`:
  - validar assinatura/secret já existente;
  - **rejeitar** payloads cujo `session !== "nocontrole"` (log sanitizado, 202 no-op para não gerar retry hostil);
  - idempotência por `(session, event_id|message_id)`.
- `whatsapp-ack-watchdog/index.ts`: logs/telemetria incluem `session_name`.

### 4. Banco
- Revisar uniques/índices que assumam provider único. Adicionar coluna/valor `session_name` em: `messaging_provider_events` (dedupe key), `messaging_connections` (chave por provider+session), tabelas de outbox/ACK conforme necessário. Migration idempotente com backfill = `'nocontrole'` para linhas existentes deste projeto.
- RLS mantida; nada muda em `platform_admins`.

### 5. Painel admin `/admin/whatsapp`
- Exibe apenas o canal "NoControle" (label fixo). Nenhuma listagem/gestão de sessões externas.
- Status/QR consomem endpoints que já operam em `nocontrole`.
- Manter correções anteriores: `can_manage_config` + wizard estável.
- Estrutura interna preparada para múltiplos canais no futuro (array de canais, mesmo que apenas um item hoje).

### 6. Conexão real agora
- Confirmar segredos no Vault (sem repetir valores).
- `GET /api/version` + `GET /api/sessions` para validar Manager.
- Criar/atualizar sessão `nocontrole` (não tocar `default`), aplicar metadata e webhook.
- Iniciar sessão; se `SCAN_QR_CODE` → expor QR no admin; se `WORKING` → mostrar conectado; sem envio externo.

### 7. Testes
- Unit: provider recusa operar sem config; nunca chama endpoint fora de `nocontrole`.
- Webhook: payload `session="default"` é ignorado; `session="nocontrole"` é processado; assinatura inválida rejeita.
- Send: força session correta mesmo se cliente enviar outro nome.
- Watchdog/telemetria: log inclui session.
- Regressão single-session: fluxos de status/QR continuam funcionando.
- `bun test`, typecheck e build.

## Aceite ao final
Relatar: Vault atualizado (sim/não), Manager validado, sessão `nocontrole` criada/reutilizada sem afetar outras, status real, webhook sincronizado, QR disponível ou WORKING, bloqueios remanescentes. Sem repetir credenciais.

## Detalhes técnicos
- Arquivos-alvo: `supabase/functions/_shared/messaging/waha.ts`, `whatsapp-session/index.ts`, `whatsapp-send/index.ts`, `whatsapp-webhook/index.ts`, `whatsapp-ack-watchdog/index.ts`, `src/pages/admin/WhatsAppSessionPanel.tsx`, migration nova para uniques com `session_name`.
- Constante `NOCONTROLE_SESSION = "nocontrole"` no `_shared`; qualquer divergência do valor no Vault dispara erro de contrato.
- Metadata enviada em `POST/PUT /api/sessions/nocontrole`: `{ config: { metadata: { app, environment, project } , webhooks: [...] } }`.
