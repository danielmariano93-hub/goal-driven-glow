# Plano — Configuração WAHA + Bootstrap Admin

Rodada focada em: (a) alinhar naming/arquitetura WAHA com o Sniper AI, (b) portal admin capaz de criar/conectar sessão via QR, (c) crons documentados, (d) criar usuário admin `daniel.assis@nocontrole.com.br`. Sem publicar, sem expor secrets.

## 1. Normalização de secrets (server-side apenas)

- Renomear leitura: `WAHA_API_URL` como principal, com fallback temporário para `WAHA_BASE_URL` em `_shared/messaging/waha.ts` (server only, sem alterar `.env` do cliente).
- `WAHA_SESSION` passa a ter default fixo `"default"` (não obrigatório configurar).
- Segredos exigidos: `WAHA_API_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_SECRET`, `CRON_SECRET`, `LOVABLE_API_KEY`.
- Admin UI lista somente configurado/não configurado; nunca valores.
- Cópia entre projetos: a plataforma Lovable Cloud não permite copiar valores entre projetos sem revelar/redigitar. Portanto NÃO configuro valores automaticamente — o admin verá "não configurado" até o proprietário adicionar em Project Settings → Secrets. Sem invenção de valores.

## 2. Edge Function `whatsapp-session` (evolução)

Estende a atual com ações via `POST { action }` (mantém `GET` legado para health check da tela atual):

- `status` — GET sessão + `/me`, retorna `{status, phone_masked, last_ack_at, last_error}`.
- `create` — `POST /api/sessions` com webhook config (events: `message`, `message.any`, `message.ack`, `session.status`; URL `${SUPABASE_URL}/functions/v1/whatsapp-webhook`; secret via header `X-Webhook-Secret`).
- `start` / `restart` / `stop` / `logout` — endpoints WAHA correspondentes.
- `qr` — `GET /api/{session}/auth/qr` retorna imagem base64 in-memory (nunca persistida, nunca logada).
- `sync_webhook` — `PUT /api/sessions/{session}` reaplica config.
- `test_health` — health profundo (sessão WORKING + `/me` ok).

Gate: JWT + `is_current_user_admin()` server-side antes de qualquer uso do service role. Erros sanitizados (sem body do WAHA cru). Header `X-Api-Key` para autenticação com WAHA (padrão atual).

## 3. Provider `waha.ts`

- Ler `WAHA_API_URL ?? WAHA_BASE_URL`.
- Manter `verifyWebhookSecret` como está (header `x-webhook-secret`, comparação constant-time) — já compatível com o Sniper.
- Adicionar métodos: `createSession(webhookUrl, webhookSecret)`, `startSession`, `stopSession`, `logoutSession`, `getQr`, `getMe`, `syncWebhook`.

## 4. Portal admin `/admin/agente` — aba WhatsApp

Novo componente `WhatsAppSessionPanel` embutido no `Agente.tsx`:

- Card status (badge STOPPED/STARTING/SCAN_QR_CODE/WORKING/FAILED/UNKNOWN), telefone mascarado, último ACK, última falha.
- Botões: Criar sessão, Iniciar, Reiniciar, Parar, Logout (com `AlertDialog` de confirmação forte), Sincronizar webhook, Testar saúde.
- Painel QR: mostra imagem quando status = `SCAN_QR_CODE`; polling a cada 3s até `WORKING`; para polling automático em WORKING ou após 3 min.
- Painel "Enviar teste": input telefone E.164 + checkbox consentimento + confirmação — envia via `whatsapp-send` (uma mensagem marcada `[TESTE]`). Só habilita com status WORKING.
- Sem exibir secrets. Lista de secrets ausentes já existe no card superior.

## 5. Webhook e ACK

- Nenhuma mudança de schema. `whatsapp-webhook` já valida secret por header e trata dedupe.
- `create`/`sync_webhook` na Edge Function cadastra os 4 eventos aceitos. Documentar no código.
- `provider_health_events` continua recebendo pings do `test_health`.

## 6. Crons — documentação + configuração segura

- Não configurar `pg_cron` com secret embutido em SQL visível (fica em `pg_cron.job` como texto).
- Em vez disso: adicionar seção "Operação — Crons" no `/admin/agente` com URLs completas, headers necessários (`x-cron-secret`), frequência recomendada e status "não verificado automaticamente".
- Frequências recomendadas: `whatsapp-send` 30s, `whatsapp-ack-watchdog` 2 min, `split-reminders-dispatch` 5 min, geração de recorrências diária 03:00 SP.
- Cada função já valida `x-cron-secret` ou JWT admin; nenhuma exposição pública.

## 7. Bootstrap do usuário admin

Edge Function **efêmera** `admin-bootstrap` (single-use, temporária):

- `verify_jwt = true`; requer `x-bootstrap-secret` = `CRON_SECRET` (proprietário aciona uma vez pelo `curl` do painel).
- Fluxo:
  1. `auth.admin.listUsers` filtrando por email; se existe → pega `id`, não recria.
  2. Se não existe → `auth.admin.createUser({ email, password, email_confirm: true })`. Senha lida de env var `BOOTSTRAP_ADMIN_PASSWORD` (proprietário adiciona temporariamente e remove após execução) — **senha nunca em código/migration/log**.
  3. Upsert `profiles` (display_name "Daniel Assis", onboarding_completed_at now, timezone America/Sao_Paulo, currency BRL).
  4. Upsert `user_financial_settings` padrão.
  5. Insert `user_roles(user_id, 'admin')` e `(user_id, 'user')` — ON CONFLICT DO NOTHING.
  6. Insere linha em `admin_grants_audit` (nova tabela mínima: `user_id`, `granted_at`, `granted_by='bootstrap'`).
  7. Retorna apenas `{ created: bool, user_id, roles: ['admin'] }` — nunca senha/token.
- Após execução bem-sucedida, o proprietário remove os secrets `BOOTSTRAP_ADMIN_PASSWORD` e opcionalmente a função pode ser deletada em rodada seguinte (o próprio código verifica se a função ainda deve rodar via env `BOOTSTRAP_DISABLED`).

Migration incremental: cria `admin_grants_audit` (`id`, `user_id`, `granted_at`, `granted_by`, `notes`), RLS admin-only, grants para `service_role` apenas.

Alternativa: se o proprietário preferir, indicar no chat como executar via `curl` uma vez e depois deletar a função.

## 8. Testes / QA

- Mocks WAHA: unit tests para `waha.ts` cobrindo `createSession`, `getQr`, `logoutSession`, `getMe`, mapping de status.
- Teste `whatsapp-session`: 403 para user comum, 200 para admin, `not_configured` sem secrets.
- Verificação final por SQL: `select email, email_confirmed_at from auth.users where email='daniel.assis@nocontrole.com.br'` e `select role from user_roles where user_id=...` — apenas confirmação, sem hash/token.
- Rodar `bunx vitest run`, `tsgo`, build.

## 9. Entregáveis

**Arquivos novos**
- `supabase/functions/admin-bootstrap/index.ts`
- `supabase/migrations/<ts>_admin_grants_audit.sql`
- `src/pages/admin/WhatsAppSessionPanel.tsx` (embutido em `Agente.tsx`)
- `src/test/waha-provider.test.ts`

**Editados**
- `supabase/functions/_shared/messaging/waha.ts` (fallback env, novas ações)
- `supabase/functions/whatsapp-session/index.ts` (action-based)
- `supabase/functions/whatsapp-webhook/index.ts` (nenhuma mudança de contrato; ajustes menores se necessário)
- `src/pages/admin/Agente.tsx` (nova aba/painel WhatsApp)
- `supabase/config.toml` (adicionar `admin-bootstrap` com `verify_jwt=true`)

## 10. Critérios de aceite

- Admin comum: user comum recebe 403 em todas ações; admin logado passa.
- Fluxo create → start → QR → WORKING funcional (com credenciais reais posteriormente); sem credenciais retorna `not_configured` claro.
- QR nunca em log/DB.
- Logout com confirmação dupla.
- Secrets ausentes do bundle (grep `WAHA_API_KEY` em `dist/` → 0).
- `daniel.assis@nocontrole.com.br` presente em `auth.users` com `email_confirmed_at` e role `admin`.
- Testes/typecheck/build passam.

## Dependências externas (aceitáveis após esta rodada)

- Proprietário adiciona secrets `WAHA_API_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_SECRET`, `CRON_SECRET`, `LOVABLE_API_KEY` em Project Settings → Secrets.
- Proprietário adiciona `BOOTSTRAP_ADMIN_PASSWORD` temporariamente para executar o bootstrap uma vez, e depois remove.
- Cron scheduler externo (ou pg_cron manual) aciona as URLs listadas no painel Operação.
