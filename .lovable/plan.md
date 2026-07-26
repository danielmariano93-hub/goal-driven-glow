## Contexto

Auditoria confirmou:
- `auth.users` = 6, `platform_admins` = 1 → `v_client_users` = 5.
- Você diz: apenas **2 clientes reais**. Os outros 3 são contas de teste (`t-fu-*@t.test`) que hoje entram em toda contagem ("Clientes totais", Crescimento, etc.).
- Onde aparecem "5" e (fontes brutas) "6": Cockpit `total_users`, Crescimento `total_clients`, VisãoGeral `total_users`, banner de integridade `auth_users`.
- Convite de rolê hoje só menciona "sua parte ficou em R$ X" — sem total do rolê nem quantas pessoas participam.

Também restam pendências da Fase 3 da auditoria admin: validar Crescimento/Clientes/Saúde/OCR/Inteligência/Auditoria e remover instrumentação temporária.

## O que este plano entrega, de uma vez

### 1. Conceito de "cliente real" (exclui admin **e** contas de teste)

Migration única `20260726120000_client_universe_excludes_test.sql`:

- Adiciona `profiles.is_test boolean not null default false` (backfill).
- Marca como `is_test = true` os 3 usuários cujo perfil tem `onboarding_completed_at IS NULL` **e** cujo `auth.users.email` termina em `@t.test` (heurística conservadora, dentro de função `security definer` que lê `auth.users`; não deleta ninguém).
- Atualiza `public.is_client_user(uuid)` para adicionar `AND NOT EXISTS (select 1 from profiles where id=_user_id and is_test)`.
- Recria `v_client_users` e `v_client_universe` com o mesmo filtro (as views já usam `is_client_user`, então basta `CREATE OR REPLACE`).
- Adiciona RPC `admin_mark_user_as_test(_user_id uuid, _is_test bool)` restrita a `platform_owner/platform_admin`, para você inverter no futuro (nenhuma UI nova — chamada opcional via SQL/DevTools).

Efeito automático: todas as métricas que já usam `v_client_users` / `is_client_user` passam a contar **2** (Cockpit `total_users`, Crescimento `total_clients`, admin_v2_growth_summary, admin_v2_cockpit, admin_v2_clients_list, admin_v2_daily_evolution, admin_dashboard_stats via VisãoGeral).

- No `admin_v2_contract_health`, o `auth_users` continua sendo `auth.users` bruto (para o banner detectar divergência); adicionamos `test_users` para clareza. O check de mismatch em `Cockpit.tsx` passa a ser `auth_users !== clientsCount + adminsCount + testCount`.

### 2. Convite de rolê mais transparente

Alteração em `supabase/functions/_shared/agent/messageTemplates.ts` e `supabase/functions/split-reminders-dispatch/index.ts`:

- Novos placeholders no template `invite`: `{{participants_count}}` e `{{total_amount}}`.
- Novo texto default:
  > "Oi, {{participant_name}}! 👋 {{owner_name}} incluiu você na divisão "{{title}}" (total do rolê: {{total_amount}}, dividido entre {{participants_count}} pessoas). Sua parte ficou em {{amount}}.{{due_sentence}}{{pix_sentence}}{{link_sentence}}"
- `split-reminders-dispatch/index.ts::messageFor` recebe `participantsCount` e `totalAmount` (calculados uma vez por `shared_expense_id`: `count(shared_expense_participants)` + `sum(amount_due)`), formata em pt-BR (`Intl.NumberFormat`), e injeta nos values.
- Reminder/due_soon/overdue ganham a mesma sentença opcional entre parênteses (mais leve, sem repetição de "total do rolê" no já-pago), para manter tom coerente sem inflar o texto.
- Templates administráveis (`persona.contexts.split_invite.template`) permanecem com precedência — só o fallback DEFAULT muda; não quebra personalizações existentes.

### 3. Encerrar as pendências abertas da auditoria admin

- **Validar RPCs restantes** com impersonação do admin (`SET request.jwt.claims`), rodando `admin_v2_growth_summary`, `admin_v2_clients_list`, `admin_v2_governance_summary`, `admin_v2_operations_health`, `admin_v2_message_intelligence`, `admin_v2_ia_ocr_metrics`, `admin_v2_product_features`, `admin_v2_audit_list`. Registrar retorno em `docs/admin-audit-2026-07-26.md` (append à seção já iniciada).
- **Blindar telas** que ainda usam `Promise.all` puro: aplicar mesmo padrão do Cockpit (`Promise.allSettled` + `adminErrorMessage`) em `Crescimento.tsx`, `Clientes.tsx`, `Operacao.tsx`, `IAInteligencia.tsx`, `GovernancaAuditoria.tsx`. Nada de novo layout — só resiliência a falha parcial.
- **Relatório final de usuários** em `/mnt/documents/admin-audit-users-2026-07-26.csv` (regenerado após marcação `is_test`), listando: id, e-mail mascarado, `is_test`, `is_admin`, `onboarding_completed_at`, `whatsapp_linked`, origem inferida.
- Nenhum registro é apagado — apenas classificado.

## Notas técnicas

Arquivos alterados:
- `supabase/migrations/20260726120000_client_universe_excludes_test.sql` (novo).
- `supabase/functions/_shared/agent/messageTemplates.ts` (DEFAULTS.invite + doc).
- `supabase/functions/split-reminders-dispatch/index.ts` (fetch counts, `messageFor` recebe extras).
- `src/pages/admin/Cockpit.tsx` (usa `client_users + admins + test_users` no check de integridade; label "Clientes reais").
- `src/pages/admin/{Crescimento,Clientes,Operacao,IAInteligencia,GovernancaAuditoria}.tsx` (`Promise.allSettled`).
- `docs/admin-audit-2026-07-26.md` (append de validação end-to-end).
- `/mnt/documents/admin-audit-users-2026-07-26.csv` (regenerado).

Fora de escopo (não mexer): frontend do app do usuário, LP, autenticação, backend financeiro, layout admin. Nenhuma deploy automático — apenas migration + edits.

## Perguntas de segurança antes de executar

1. Posso classificar como `is_test=true` os 3 perfis com `onboarding_completed_at IS NULL` e e-mail `@t.test`? (Reversível via RPC, nada é deletado.)
2. Confirma "2 clientes reais" = Daniel + Lucas? Se sim, seguem assim; se outro par, me diga os IDs.