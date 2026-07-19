## Diagnóstico (confirmado no banco)

Consultei o banco real com `psql`. Todos os sintomas relatados têm **uma única raiz**: a migration `supabase/migrations/20260719230000_complete_split_expense_flow.sql` **nunca foi aplicada** (e o patch `docs/patches/20260720120000_split_pgcrypto_qualified_and_user_edited.sql` também não).

Evidências:

- `pg_proc` só tem os RPCs antigos: `split_create`, `split_add_payment`, `split_reverse_payment`, `split_send_reminders`, `split_claim_pending`. **Faltam** todos os v2 usados pelo frontend atual: `split_create_v2`, `split_update`, `split_cancel`, `split_add_payment_v2`, `split_reverse_payment_v2`, `split_message_status`, `split_summary`, `split_enqueue_message`, `split_token`, `split_assert_financial_source`, `claim_reminder_jobs`, gatilhos de vínculo com `transactions`.
- Tabela `shared_expenses` está sem as colunas `source_account_id`, `source_credit_card_id`, `reimbursement_account_id`, `category_id`, `cancelled_at`, `cancellation_reason`.
- Tabela `transactions` está sem `shared_expense_id` e `split_transaction_role` (por isso o gasto vinculado **não aparece em Lançamentos** nem impacta saldos/relatórios).
- `reminder_jobs` está sem a coluna `kind` e sem o índice único idempotente — por isso o dispatcher que envia via `outbound_messages` nunca teve como ser acionado corretamente pelo fluxo novo.
- `extracted_items` está sem `user_edited_at` (guarda anti-destrutiva do assessor, incluída no mesmo patch pendente).

Consequências observáveis (batem 1:1 com o relato):

1. **Editar dá erro / salvar dá erro**: `DivisaoDoRoleNova` chama `supabase.rpc("split_update", …)` → função inexistente → PostgREST devolve erro → toast "Não consegui salvar".
2. **Não dá para excluir/cancelar**: `DivisaoDoRoleDetalhe` chama `supabase.rpc("split_cancel", …)` → função inexistente.
3. **Lançamento não aparece em Lançamentos e não reflete nos valores**: sem colunas `source_account_id`/`source_credit_card_id` em `shared_expenses`, sem `shared_expense_id`/`split_transaction_role` em `transactions`, e sem a lógica de `split_create_v2`/`split_update` que grava a transação-espelho, nenhum lançamento é criado.
4. **Mensagem não foi enviada**: sem `split_send_reminders` novo + `claim_reminder_jobs` + coluna `kind` + índice idempotente, o `split-reminders-dispatch` não claima nada e o outbound nunca é enfileirado.

O frontend, os testes de contrato (`src/test/split-flow-contract.test.ts`) e a edge function `split-reminders-dispatch` **já estão alinhados** com o esquema v2. O gap é 100% no banco.

## Correção (uma única rodada, uma única migration)

Criar **um único arquivo de migration novo** que aplica, de forma atômica e idempotente, o conteúdo consolidado dos dois SQLs pendentes. Nada de frontend, nada de edge functions, nada de deploy WAHA/webhook.

### Arquivo único a criar

`supabase/migrations/20260720170000_apply_split_v2_and_pending_patch.sql`

Conteúdo (concatenado, na ordem correta, com `IF NOT EXISTS`/`CREATE OR REPLACE` para ser seguro em re-execuções):

1. **Bloco 1 — schema base do fluxo v2** (do arquivo `20260719230000_complete_split_expense_flow.sql`, integral):
   - `ALTER TABLE public.shared_expenses ADD COLUMN IF NOT EXISTS` para `source_account_id`, `source_credit_card_id`, `reimbursement_account_id`, `category_id`, `cancelled_at`, `cancellation_reason`.
   - Constraint `shared_expenses_exactly_one_financial_source` **`NOT VALID`** (não quebra a linha antiga já existente `63275232-…` sem origem).
   - `ALTER TABLE public.transactions` adicionando `shared_expense_id` e `split_transaction_role` com CHECK `('original_expense','reimbursement')`.
   - Índices `transactions_split_original_uniq` e `transactions_split_idx`.
   - `ALTER TABLE public.reminder_jobs ADD COLUMN IF NOT EXISTS kind` + índice `split_jobs_idempotent_uniq`.
   - Funções: `split_token`, `split_assert_financial_source`, `split_create_v2`, `split_update`, `split_cancel`, `split_add_payment_v2`, `split_reverse_payment_v2`, `split_message_status`, `split_summary`, `split_enqueue_message`, `split_send_reminders` (nova versão), `claim_reminder_jobs`, gatilhos de auditoria em `shared_expense_events`.
   - `REVOKE` de `PUBLIC`/`anon` + `GRANT EXECUTE ... TO authenticated, service_role` em cada função nova.
   - RLS/policies necessárias para `shared_expense_events` e `reminder_jobs` conforme o SQL original.

2. **Bloco 2 — patch pgcrypto qualificado + user_edited** (do `docs/patches/20260720120000_split_pgcrypto_qualified_and_user_edited.sql`, integral):
   - Recria `split_token` e qualquer função que use `gen_random_bytes` com `extensions.gen_random_bytes(...)` e `SET search_path = public, extensions` (garante que rode mesmo quando `pgcrypto` está em `extensions`).
   - `ALTER TABLE public.extracted_items ADD COLUMN IF NOT EXISTS user_edited_at timestamptz` (não afeta split, mas é o mesmo patch pendente citado no arquivo).

3. **Bloco 3 — reconciliação de dados legados** (mínima e segura):
   - Para a divisão existente `63275232-9058-4844-94cb-e0abf114c6d9` (única no banco, `status='active'`, sem origem): **não** forçar backfill de origem (a constraint é `NOT VALID`, ela sobrevive). Nenhum `UPDATE` destrutivo é feito. Se o usuário abrir para editar, ele passa a poder escolher origem e salvar normalmente.
   - Nenhuma manipulação de `transactions` legadas: o vínculo só é criado no próximo `split_create_v2`/`split_update`.

### Ordem de checagem pós-migration

Feita imediatamente após a migration ser aprovada e executada:

1. `SELECT proname FROM pg_proc WHERE proname LIKE 'split_%'` → deve listar todos os v2.
2. `\d public.shared_expenses` → deve ter as 6 colunas novas.
3. `\d public.transactions` → deve ter `shared_expense_id` + `split_transaction_role`.
4. `\d public.reminder_jobs` → deve ter `kind` e o índice único.
5. Rodar `bunx vitest run src/test/split-flow-contract.test.ts src/test/split-math.test.ts` para confirmar que o contrato bate.

### Fora de escopo (explícito)

- Nenhuma mudança em `whatsapp-webhook`, `whatsapp-send`, `_shared/messaging/waha*`, sessão, QR, ou qualquer coisa de WAHA.
- Nenhum deploy de edge function (o `split-reminders-dispatch` já está deployado e alinhado; ele só precisa das RPCs/colunas que a migration cria para começar a claimar jobs).
- Nenhuma publicação do frontend (o frontend já está correto).
- Nenhum backfill destrutivo em dados existentes.

### Detalhes técnicos relevantes

- A constraint `shared_expenses_exactly_one_financial_source` entra como `NOT VALID` para não rejeitar a linha antiga sem origem — igual ao SQL original — mas passa a valer para novos `INSERT`/`UPDATE`.
- Todas as funções novas rodam com `SECURITY DEFINER`, `SET search_path = public` (e `extensions` onde necessário), e resolvem `owner_user_id` internamente via `auth.uid()`; o frontend nunca envia `user_id`.
- `split_cancel` recebe `p_remove_transaction` — o frontend já decide com base em `received>0` (preservar lançamentos quando já houve pagamento).
- `split_add_payment_v2` gera automaticamente a transação de reembolso quando `reimbursement_account_id` está preenchido, marcada como `split_transaction_role='reimbursement'`.
- `split-reminders-dispatch` já enfileira em `outbound_messages` com `idempotency_key` — depende de `claim_reminder_jobs`, `reminder_jobs.kind`, e do índice único idempotente que esta migration cria.

Depois da migration aprovada e aplicada, os quatro sintomas relatados desaparecem juntos — não há segundo passo.
