## 1. Sincronização confirmada

Main local em `5ea8019` (merge do PR #12) sobre `5b52b57 feat(finance): add accounting core for cards and debts`. Os 12 arquivos do commit estão íntegros, incluindo:

- `supabase/migrations/20260730020000_financial_accounting_cards_debts.sql` (620 linhas) — **existe**.
- `supabase/functions/assistant-review-actions/index.ts` — **atualizado**: `ALLOWED_PATCH_KEYS` passou a aceitar `historical_installments_paid_assumption` (única alteração, 1 linha).
- Frontend: `ReviewSheet.tsx`, `Cartoes.tsx`, `Dividas.tsx`, `Relatorios.tsx`, `finance.ts`, `validation/finance.ts`, novo `src/lib/finance/accounting.ts`.
- Testes novos: `accounting-core.test.ts`, `financial-accounting-contract.test.ts`.

## 2. Testes e build da main

- **Testes:** 753 aprovados / 0 falhos (116 arquivos).
- **Build:** sucesso em 20,27s (apenas o aviso pré-existente de chunk > 500 kB).

## 3. Análise de segurança da migration contra o banco atual

Estado atual conferido no banco conectado:

| Verificação | Resultado |
|---|---|
| Tabelas novas (`debt_payments`, 6 × `credit_card_*`) | Nenhuma existe — sem colisão |
| Funções `record_debt_payment`, `reconcile_imported_installment_history`, `sync_card_accounting_from_transaction` | Nenhuma existe |
| Trigger `trg_sync_card_accounting_from_transaction` | Não existe; nomes dos 11 triggers atuais de `transactions` não colidem |
| Colunas novas em `debts` | Nenhuma existe (tabela tem 13 colunas legadas) |
| `extracted_items.historical_installments_paid_assumption` | Não existe |
| Colunas exigidas pelo backfill (`purchase_group_id`, `competence_date`, `installment_number`, `installments_total`, `settles_card_id`, `movement_kind`) | Todas presentes |
| Colunas de `credit_cards` usadas (`closing_day`, `due_day`) | Presentes |
| `transactions_movement_kind_check` | Hoje aceita 7 valores; a migration **amplia** para 11 (inclui `debt_payment`). Todos os `movement_kind` em uso hoje (7 distintos) continuam válidos → sem violação |

Riscos sobre dados existentes: **muito baixos**.
- `debts` tem **0 linhas** → o `UPDATE` retroativo e o `SET NOT NULL` em `contract_total_amount`/`principal_amount` não podem falhar.
- Apenas **3 transações** com `credit_card_id` e **1 cartão** → backfill de compras/parcelas/faturas é minúsculo e reversível; faturas reconstruídas nascem marcadas para revisão.
- `document_imports` (35 docs) só ganha a coluna opcional em `extracted_items`; importações concluídas não são reescritas.
- Migration é aditiva: só usa `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP CONSTRAINT IF EXISTS` antes de recriar. Reexecução é idempotente, exceto os `INSERT ... SELECT` de backfill, que são protegidos por índices únicos parciais em `legacy_purchase_group_id` e `legacy_transaction_id`.

Conformidade de segurança: as 7 tabelas novas recebem `ENABLE ROW LEVEL SECURITY`, policy `auth.uid() = user_id` e `GRANT` para `authenticated` + `service_role` (o bloco `DO` no fim cobre as 6 de cartão; `debt_payments` tem grants explícitos). As duas funções `SECURITY DEFINER` têm `search_path = public` e `REVOKE ... FROM PUBLIC, anon`.

Dependências: nenhuma migration pendente. Todas as anteriores (até `20260730003000`) já foram aplicadas, e todos os objetos referenciados existem.

Ponto de atenção único: o trigger `trg_sync_card_accounting_from_transaction` é `AFTER INSERT OR UPDATE` em `transactions` — passa a rodar em toda escrita de lançamento (app, agente, importação). O volume atual é baixo, mas é o item a observar no smoke test.

Backup/reconciliação prévia: não é obrigatório dado o volume, mas o plano abaixo captura um snapshot de contagens antes/depois.

## 4. Plano de implantação (aguardando sua aprovação)

**Ordem exata**

1. Snapshot pré-migration (somente leitura):
   ```sql
   select (select count(*) from transactions) tx,
          (select count(*) from transactions where credit_card_id is not null) tx_card,
          (select count(*) from debts) debts,
          (select count(*) from extracted_items) items;
   ```
2. Aplicar `20260730020000_financial_accounting_cards_debts.sql` pela ferramenta de migration (execução única, transacional).
3. Deploy da Edge Function `assistant-review-actions` (única alterada; nenhuma outra função importa código tocado).
4. Rodar o linter de segurança do banco e comparar com a linha de base (hoje só avisos INFO pré-existentes).
5. Frontend: **não publicar** — a main já compila e passa nos testes; publicação só sob autorização explícita.

**Validações SQL pós-migration**

```sql
-- objetos criados
select tablename from pg_tables where schemaname='public'
  and tablename in ('debt_payments','credit_card_purchases','credit_card_installments',
    'credit_card_statements','credit_card_statement_items','credit_card_payments',
    'credit_card_payment_allocations');
-- RLS + policies + grants
select relname, relrowsecurity from pg_class where relname like 'credit_card_%' or relname='debt_payments';
select tablename, policyname from pg_policies where schemaname='public' and tablename like 'credit_card%';
-- funções e trigger
select proname, prosecdef from pg_proc where proname in
  ('record_debt_payment','reconcile_imported_installment_history','sync_card_accounting_from_transaction');
select tgname from pg_trigger where tgrelid='public.transactions'::regclass and tgname like 'trg_sync_card%';
-- constraint ampliada
select pg_get_constraintdef(oid) from pg_constraint where conname='transactions_movement_kind_check';
-- integridade do backfill: nenhuma transação de cartão órfã, nenhum valor duplicado
select count(*) from transactions t where t.credit_card_id is not null
  and not exists (select 1 from credit_card_installments i where i.legacy_transaction_id=t.id);
select credit_card_id, competence_month, count(*) from credit_card_statements
  group by 1,2 having count(*)>1;
-- contagens iguais às do snapshot
select (select count(*) from transactions) tx, (select count(*) from debts) debts;
```

**Smoke tests**

- Criar um lançamento de cartão parcelado no app → conferir que aparecem 1 linha em `credit_card_purchases`, N em `credit_card_installments` e a fatura correspondente em `credit_card_statements`.
- Editar valor/data desse lançamento → conferir atualização das parcelas e recálculo de `reconciled_total`.
- Chamar `record_debt_payment` em uma dívida de teste com principal + juros + tarifa → conferir transação com `movement_kind='debt_payment'`, linha em `debt_payments` e saldo atualizado; repetir com a mesma `idempotency_key` → deve retornar `idempotent: true` sem duplicar.
- `assistant-review-actions` action `update` enviando `historical_installments_paid_assumption` → deve persistir (antes era descartado).
- Tela Cartões, Dívidas e Relatórios no preview: carregar sem erro de console e conferir totais versus os valores pré-migration.
- Registrar um gasto pelo WhatsApp/agente → confirmar que o trigger novo não introduziu latência nem erro nos logs.

**Rollback**

Como é aditiva, o rollback é reverso e não destrói dados legados:
```sql
DROP TRIGGER IF EXISTS trg_sync_card_accounting_from_transaction ON public.transactions;
DROP FUNCTION IF EXISTS public.sync_card_accounting_from_transaction();
DROP FUNCTION IF EXISTS public.record_debt_payment(uuid,uuid,date,numeric,numeric,numeric,integer,text,text);
DROP FUNCTION IF EXISTS public.reconcile_imported_installment_history(uuid);
DROP TABLE IF EXISTS public.credit_card_payment_allocations, public.credit_card_payments,
  public.credit_card_statement_items, public.credit_card_statements,
  public.credit_card_installments, public.credit_card_purchases, public.debt_payments CASCADE;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_movement_kind_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_movement_kind_check
  CHECK (movement_kind IN ('transaction','refund','internal_transfer','investment_application',
    'investment_redemption','investment_yield','loan_proceeds'));
ALTER TABLE public.debts ALTER COLUMN contract_total_amount DROP NOT NULL,
  ALTER COLUMN principal_amount DROP NOT NULL;
NOTIFY pgrst, 'reload schema';
```
As colunas novas de `debts`/`extracted_items` podem ficar (inertes) ou ser removidas com `DROP COLUMN IF EXISTS`. Transações e dívidas legadas permanecem intactas em qualquer cenário. Para reverter a Edge Function, basta redeployar a versão anterior (remoção da chave extra em `ALLOWED_PATCH_KEYS`).

Nada foi executado: migration não aplicada, Edge Function não implantada, frontend não publicado.