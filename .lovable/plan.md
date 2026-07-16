# Plano operacional — Configurar secrets, criar admin, validar sem alterar sessão WAHA

Execução imediata após aprovação. Nada aparece em código, migrations, logs ou chat.

## 1. Ajuste mínimo de código (mitiga conflito com Sniper AI)

Antes de gravar `WAHA_SESSION=default` — que é a mesma sessão do Sniper AI — proteger contra sobrescrita acidental:

- `supabase/functions/_shared/messaging/waha.ts`: passar a ler `NOCONTROLE_WAHA_SESSION ?? WAHA_SESSION ?? "default"`, mantendo compatibilidade.
- `src/pages/admin/WhatsAppSessionPanel.tsx`: em `Criar/atualizar sessão`, `Iniciar`, `Reiniciar`, `Sincronizar webhook` e `Logout`, exigir `AlertDialog` extra com aviso:
  > "Esta instância WAHA pode estar em uso por outro projeto (ex.: Sniper AI). Continuar irá alterar a sessão compartilhada."
  O botão só prossegue com confirmação explícita.
- `test_health`, `status` e `qr` seguem sem confirmação (não alteram nada no WAHA).

Nenhuma migração de banco. Nenhum secret em código.

## 2. Gravar secrets via secret manager

- `set_secret`: `WAHA_API_URL=https://waha.sincrofy.com.br`, `WAHA_API_KEY=<fornecido>`, `WAHA_SESSION=default`, `BOOTSTRAP_ADMIN_PASSWORD=<fornecido pelo proprietário>`.
- `generate_secret`: `WAHA_WEBHOOK_SECRET` (48 chars), `CRON_SECRET` (48 chars).
- `LOVABLE_API_KEY`: verificar via `fetch_secrets`; se ausente, `ai_gateway--create`.
- `WAHA_BASE_URL`: não gravo; provider já usa `WAHA_API_URL` com fallback legado, sem operação necessária.
- Valores nunca voltam ao chat.

## 3. Criar admin `daniel.assis@nocontrole.com.br`

- `supabase--curl_edge_functions` `POST /admin-bootstrap` com header `x-bootstrap-secret: $CRON_SECRET`.
- Função lida com idempotência (não recria se existir), grava `profiles`, `user_financial_settings`, `user_roles(admin,user)`, e audit em `admin_grants_audit`.
- Verificar com `supabase--read_query`:
  ```
  select id, email, email_confirmed_at is not null as confirmed
  from auth.users where lower(email)='daniel.assis@nocontrole.com.br';

  select role from public.user_roles
  where user_id=(select id from auth.users where lower(email)='daniel.assis@nocontrole.com.br');
  ```
- Nenhum hash/token consultado ou logado.

## 4. Higienização pós-bootstrap

- `secrets--delete_secret BOOTSTRAP_ADMIN_PASSWORD` imediatamente após sucesso.
- Definir `BOOTSTRAP_DISABLED=1` via `set_secret` para desativar a função (mantém código, mas retorna 410).

## 5. Validar WAHA sem alterar sessão

- `curl_edge_functions GET /whatsapp-session` requer JWT admin. No ambiente do agente eu não tenho sessão do admin recém-criado, então **não vou chamar** para não retornar 401 nem forçar workaround inseguro.
- Reporto ao proprietário: "faça login como Daniel, abra /admin/agente, clique em Testar saúde" — status será mostrado sanitizado no painel.
- Nenhum `create`/`sync_webhook`/`start`/`logout` será executado.

## 6. Crons

- Com `CRON_SECRET` configurado, o painel "Operação — Crons" mostrará `configured`.
- Não vou registrar o valor em SQL/pg_cron (evitar exposição em `pg_cron.job`).
- Scheduler nativo do Lovable Cloud/Supabase para chamadas HTTPS agendadas não está exposto por tool disponível — reporto como ação manual (curl-driven ou pg_cron gerido pelo proprietário com secret via `vault`).

## 7. Conflito de sessão WAHA compartilhada — atenção

- A instância `https://waha.sincrofy.com.br` provavelmente está com a sessão `default` já autenticada pelo número do Sniper AI.
- **Não** vou criar/iniciar/logout no NoControle. O painel agora exibe aviso e confirmação forte antes de qualquer ação destrutiva.
- Se o proprietário quiser usar um número separado para o NoControle, precisará: (a) subir outra instância WAHA (Core aceita 1 sessão), ou (b) usar WAHA Plus com múltiplas sessões e definir `NOCONTROLE_WAHA_SESSION` distinta, ou (c) migrar o Sniper para outra instância. Reporto isso como decisão pendente do proprietário.

## 8. Relatório final (formato)

Somente:
- `admin_criado: sim|nao`, `role_admin_ativa: sim|nao`;
- `secrets_configurados`: lista de nomes (sem valores);
- `bootstrap_password_removido: sim`;
- `bootstrap_disabled: sim`;
- `health_waha`: "não verificado nesta rodada — sessão compartilhada com Sniper AI; validar via /admin/agente após login";
- `conflito_sessao`: descrição curta;
- `acao_manual_restante`: schedulers dos crons + confirmação humana antes de tocar na sessão.

## Critérios de aceite

- daniel.assis@nocontrole.com.br presente em `auth.users` com `email_confirmed_at`, role `admin` em `user_roles`.
- `WAHA_API_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, `WAHA_WEBHOOK_SECRET`, `CRON_SECRET`, `LOVABLE_API_KEY`, `BOOTSTRAP_DISABLED` = configured; `BOOTSTRAP_ADMIN_PASSWORD` = removido.
- Nenhum valor de secret aparece no diff, bundle, chat ou log.
- Sessão WAHA `default` intacta (nenhuma chamada a create/start/sync/logout).
