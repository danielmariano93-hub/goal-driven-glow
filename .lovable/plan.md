
# Correção de Conciliação Financeira — plano mínimo

Escopo: 4 arquivos de código + 1 migration + testes. Nada de novos módulos, nada de reimportação, nada de alteração no snapshot manual já criado (`380b5a34…`) nem na fatura de R$ 271,88.

## 1. Snapshot de saldo idempotente vindo do extrato

**Arquivo**: `supabase/migrations/<novo>_reconciliation_hardening.sql`

- `CREATE UNIQUE INDEX IF NOT EXISTS account_balance_snapshots_unique_doc_idx ON public.account_balance_snapshots(source_document_id, account_id) WHERE source_document_id IS NOT NULL;` — impede duplicidade em reprocessamento.
- Substituir `public.confirm_document_import` para, quando `v_doc.statement_closing_balance` e `statement_balance_date` estiverem presentes, executar `INSERT ... ON CONFLICT (source_document_id, account_id) DO UPDATE SET balance = EXCLUDED.balance, balance_date = EXCLUDED.balance_date, reconciliation = EXCLUDED.reconciliation, status = 'pending_review', updated_at = now()`.
- Snapshot criado pelo import fica sempre com `status='pending_review'`; só passa a `confirmed` via ação explícita do usuário (função `public.confirm_balance_snapshot(p_snapshot_id uuid)` já existente é reutilizada — sem alteração).
- `source='statement'`, `source_document_id` = documento importado, `account_id` obrigatório (resolver via `document_imports.account_id`; se nulo, `RAISE EXCEPTION 'account_required_for_snapshot'`).
- Reforçar CHECK: `balance_date` = `statement_balance_date` (não pode ser deslocada).
- Nenhuma linha de `transactions` deve ser criada a partir de saldo (garantido pela quarentena `informational` já existente em `_shared/documents/types.ts` — apenas adicionar teste de contrato).

**Sem backfill de dados**: o snapshot manual `380b5a34…` fica intocado (índice único é `WHERE source_document_id IS NOT NULL`; snapshot manual tem `source='manual'`, `source_document_id NULL`).

## 2. Datas preservadas no extrato

**Arquivo**: `supabase/functions/_shared/documents/dates.ts`

Ajuste único em `resolveDocumentDate`:
- Quando `raw` for uma data completa válida (ISO ou dd/mm/yyyy) dentro do calendário e não futura, **retornar a data mesmo se cair fora da `inPeriodWindow`**, apenas rebaixando `confidence` para 0.6 e marcando `source: 'iso'|'br_full'`. Hoje `iso`/`br_full` só retorna se `inPeriodWindow` — isso é o que empurra datas legítimas para o `period_end_fallback`.
- Datas ambíguas (`brPartial` sem `year` inferível) permanecem indo para `period_end_fallback`, mas passamos `needs_review: true` no retorno para o pipeline sinalizar no `extracted_items.needs_review`.

**Arquivo**: `supabase/functions/assistant-ingest-document/index.ts`
- Ao mapear `occurred_at`, se `resolveDocumentDate` retornar `needs_review`, marcar `extracted_items.needs_review=true` e `notes` explicando ambiguidade. Nenhuma outra mudança.

Nenhuma correção de fuso — `resolveDocumentDate` já opera em `America/Sao_Paulo` via string ISO e não usa `new Date(local)`.

## 3. Patrimônio ancorado no snapshot mais recente

`src/lib/engine/facts.ts` e `supabase/functions/_shared/engine/facts.ts` já implementam corretamente:
- snapshot confirmado vira âncora (`map[account_id] = balance`);
- só transações posteriores a `cutoff` entram;
- despesas de cartão não afetam `cash` (via `txOrigin`);
- fatura é subtraída separadamente em `computeNetWorth`;
- cancelados/rejeitados/duplicados já excluídos (status ≠ 'confirmed').

**Única mudança**: `computeAccountBalances` hoje inclui `snapshots.filter((x) => !x.status || x.status === "confirmed")`. Adicionar teste de contrato dedicado ao cenário Itaú/danielmariano93:
- opening_balance = 0, snapshot confirmado `2026-07-18` = 139.95, sem tx posteriores;
- fatura em aberto = 271.88 (dois itens);
- `computeNetWorth` deve retornar `cash=139.95`, `cardsOwed=271.88`, `net=-131.93`.

**Arquivo**: `src/test/facts-networth-scenario.test.ts` — adicionar `describe` "cenário Itaú julho/26 (danielmariano93)".

Espelhar cobertura no shared se relevante.

## 4. Insight "Este mês tá apertado" alinhado à regra oficial

**Arquivo**: `supabase/functions/insights-generate/index.ts` (linhas ~80-134)

Reescrever a query `recentTx` e o cálculo `income`/`expense`:
- **Remover** `.limit(300)` — usar `.range()` paginado ou `head:false` sem limite artificial (a query já é filtrada por `status=confirmed` e mês corrente; volume é pequeno).
- Adicionar filtros equivalentes aos relatórios:
  - `.neq('type','transfer')`
  - `.not('movement_kind','in','(internal_transfer,investment_application,investment_redemption,informational)')`
  - `.is('settles_card_id', null)` na soma de despesa (pagamento de fatura já é contabilizado pelas compras do cartão — evita double-count);
  - estorno (`type='income'` com `reversal_of` populado) subtrai da despesa em vez de somar à renda.
- Extrair helper `computeMonthlyTotals(txs, ym)` em `supabase/functions/_shared/engine/facts.ts` (já existe `computeMonthlyIncomeExpense` — estender para aplicar os filtros acima) e usá-lo tanto no insights quanto no relatório e no `PeriodFilter` da Home (`src/pages/Index.tsx` linhas 45-59). Uma única fonte de verdade.
- Espelhar no client `src/lib/engine/facts.ts`.

## 5. Transparência de UI

**Arquivo**: `src/components/home/PatrimonioCard.tsx`
- Adicionar prop opcional `cashAnchor?: { date: string; source: 'statement'|'manual' }`.
- Sob "Em conta", exibir chip discreto: `Saldo conciliado em {dd/mm/yyyy}` (visual: `text-[10px] text-white/60`). Se nulo, não renderiza.

**Arquivo**: `src/pages/Index.tsx`
- Selecionar snapshot confirmado mais recente por conta e passar `cashAnchor` (a maior `balance_date` entre snapshots confirmados; se múltiplas contas, mostrar do total agregado ou omitir — MVP: exibe quando houver **exatamente 1** conta com snapshot).
- Manter "Na fatura" com sufixo já existente. Adicionar `title` (tooltip) "estimativa até o fechamento".
- Copy do `PeriodFilter` (linha 141) já esclarece que o filtro não altera patrimônio — manter.

Sem mensagens técnicas: nenhum novo texto expõe termos como `snapshot`, `RPC`, etc.

## 6. Backfill / validação (sem migration de dados)

Nenhuma alteração em dados reais. Após deploy:
- SQL de validação (executado manualmente via `supabase--read_query`):
  ```sql
  select balance, balance_date, status, source from account_balance_snapshots
   where account_id='6c1cf814-2a25-4b3d-980d-c6454ccd35e0' order by balance_date desc;
  -- esperado: 139.95 / 2026-07-18 / confirmed / manual
  ```
- Rodar `bunx vitest run src/test/facts-networth-scenario.test.ts` e ver os 3 asserts do novo cenário Itaú verdes.
- Consulta de sanidade do insight (após deploy da function) — validar que `expense_month` do usuário reflete a nova regra (transfer/internal/pagamento de fatura excluídos).

## Arquivos afetados (resumo)

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/<novo>_reconciliation_hardening.sql` | índice único + `confirm_document_import` idempotente + snapshot `pending_review` |
| `supabase/functions/_shared/documents/dates.ts` | preservar datas completas fora do período; sinalizar `needs_review` |
| `supabase/functions/assistant-ingest-document/index.ts` | propagar `needs_review` para `extracted_items` |
| `supabase/functions/_shared/engine/facts.ts` | estender `computeMonthlyIncomeExpense` (filtros movement_kind, settles_card_id, estorno) |
| `src/lib/engine/facts.ts` | espelhar |
| `supabase/functions/insights-generate/index.ts` | usar helper compartilhado; remover `.limit(300)` |
| `src/components/home/PatrimonioCard.tsx` | prop `cashAnchor` + chip |
| `src/pages/Index.tsx` | passar `cashAnchor`; consumir helper compartilhado no `periodSummary` |
| `src/test/facts-networth-scenario.test.ts` | cenário Itaú julho/26 |
| `src/test/documents-dates.test.ts` | data completa fora do período preservada |
| `src/test/insights-monthly-rule.test.ts` (novo) | regra oficial (transfer, internal, settles_card_id, estorno) |

## Ordem de implantação

1. Migration (`reconciliation_hardening`) → aprovação → aplicar.
2. Editar helpers puros (`dates.ts`, `_shared/engine/facts.ts`, `src/lib/engine/facts.ts`) + testes → `bunx vitest run`.
3. Editar `insights-generate` + `assistant-ingest-document` → deploy das duas edge functions.
4. Editar UI (`PatrimonioCard`, `Index`) → build.
5. Validar via SQL o snapshot Itaú intacto e Home retornando `-R$ 131,93`.

## Riscos

- **Índice único** em `source_document_id` pode conflitar se já existirem 2 snapshots do mesmo doc — verificar antes de aplicar (`select source_document_id, account_id, count(*) from account_balance_snapshots where source_document_id is not null group by 1,2 having count(*)>1`); se houver, migration marca duplicatas como `status='canceled'` antes de criar o índice.
- Alteração em `computeMonthlyIncomeExpense` muda números exibidos em Home/Relatórios/Insights simultaneamente — desejado, mas o usuário verá totais diferentes dos anteriores. É o comportamento correto pedido no plano.
- `needs_review` na tabela `extracted_items` já existe (usado pela quarentena). Reusar o mesmo campo — nenhuma migration adicional.
- Nada muda no fluxo WhatsApp/assessor além do sinal `needs_review`.
