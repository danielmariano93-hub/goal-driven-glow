# Plano único e final — Verdade de caixa bancária, reparo dos dados do Daniel e prevenção de recorrência

Decisões do usuário (1–6) incorporadas. Nada implementado nesta rodada.

## 1. Diagnóstico confirmado (leitura de código e banco)

Banco:
- `public.transactions` tem 40 colunas e **não possui `posted_at`** (só `occurred_at`, `purchase_date`, `competence_date`). Impossível hoje separar data econômica de data bancária.
- Snapshots da conta Itaú: `380b5a34…` 18/07/2026 R$ 139,95 `confirmed` (source `manual`) e `629b7088…` 20/07/2026 R$ 49,91 **`pending_review`** (extrato oficial diz R$ 39,97 nesse dia).
- Investimentos: `CDB DI Itaú` R$ 5.576,79 (ref. 18/07), `Fundo de Investimentos` R$ 3.000,00 e o duplicado **`CDB DI` R$ 0,00 (ref. 31/07)**.
- 373 transações no usuário; `extracted_items` usa `document_id` + `idx`, **sem** `posted_at`, `external_id` ou `source_line_index`.

Código:
- `src/lib/engine/facts.ts:122-165` (`computeAccountBalances`): âncora = snapshot confirmado, corte por **`occurred_at <= cutoff`**, soma income/expense por `occurred_at`. Reproduz exatamente R$ 2.447,58 (139,95 + 2.307,63). Espelhado em `supabase/functions/_shared/finance-core/facts.ts` via `scripts/sync-finance-core.mjs`.
- `tf_transactions_investment_link` (lido de `pg_proc`): canonicaliza para o literal `'CDB DI'` quando a descrição contém “CDB”, casa por `name ILIKE`, e **cria investimento zerado com `applied=true`** quando não acha; `GREATEST(0, current_value - amount)` faz o resgate “sumir”. Não trata `UPDATE` de valor/kind.
- `_shared/import/dedupe.ts`: classifica por tipo+valor+janela+comerciante, **sem chave documental** (`document_id+idx`/`external_id`); `import/schema.ts` não tem o estado `repeated_legitimate`. Daí o colapso de linhas legítimas repetidas (2× R$ 600, 2× Uber R$ 12,95).

A verificar como passo 0 da execução (read-only): as 42 linhas do lote `6e768b47-…`, vínculos do reembolso R$ 135,31 (`shared_expense_id`, contribuições de metas), e alocações existentes do `card_payment` de R$ 4.636,08.

## 2. Migrations

**M1 — `posted_at` com qualidade de origem (decisão 6)**
- `transactions`: `ADD COLUMN posted_at date`, `ADD COLUMN posted_at_source text` (`statement | import | inferred | manual`).
- `extracted_items`: `ADD COLUMN posted_at date, posted_at_source text, external_id text, source_line_index int`.
- Backfill provisório idempotente: `posted_at = occurred_at`, `posted_at_source = 'inferred'` apenas onde nulo. Itens de cartão ficam com `posted_at` nulo (não movem caixa).
- Todo o período do extrato (03/07–02/08) e os itens de maior impacto recebem `posted_at` real (`statement`) no reparo, **antes** da reconciliação.
- Índices: `transactions(user_id, account_id, posted_at)`, `extracted_items(document_id, source_line_index)`; trigger de validação `posted_at >= occurred_at - 5 dias`.

**M2 — transferências externas (decisão 4)**
- `external_transfer_in` / `external_transfer_out` no vocabulário de `movement_kind` (constraint atualizada), incluídos no conjunto neutro em resultado em `src/lib/ledger/canonical.ts` e no espelho `_shared/ledger/canonical.ts`. Afetam caixa; **não** entram em renda/despesa comportamental; **não** usam `transfer_group_id` nem geram duas pernas (distintas de transferência entre contas próprias).

**M3 — estados explícitos de importação**
- `extracted_items.status`: `ready_to_import | repeated_legitimate | probable_duplicate | exact_duplicate | needs_review | confirmed | rejected`.
- Trigger impedindo `document_imports.status='completed'` com qualquer item sem estado final.

**M4 — trigger de investimentos reescrito**
- Matching por nome normalizado (unaccent+lower, remoção de instituição), tabela nova `investment_aliases(user_id, investment_id, alias)`, categoria e similaridade `pg_trgm` (limiar ≥ 0,55): “CDB DI”, “CDB DI Itaú”, “RESGATE CDB DI” = mesmo ativo.
- **Nunca** cria investimento zerado para resgate; sem match seguro → `investment_movements.applied=false` + revisão, sem alterar saldos.
- Resgate acima do `current_value` → `applied=false` + revisão.
- Unicidade em `investment_movements(transaction_id)`; `UPDATE` reverte delta antigo e aplica novo; `DELETE` reverte só se `applied=true`.

**M5 — snapshots e reconciliação**
- Status `superseded` em `account_balance_snapshots` (decisão 3).
- RPC `reconcile_account_from_statement(account_id, balance_date, balance, source, period_start, period_end, issued_at)`: grava snapshot `confirmed`, marca conflitantes como `superseded`, registra em `financial_reconciliation_audit`.

## 3. Contratos e tipos

- `finance_contract.v3`: `TransactionRow.posted_at?: string | null`; helper canônico `cashDateOf(t) = t.posted_at ?? t.competence_date ?? t.occurred_at`.
- `import_item.v2`: `posted_at` (nullable) + `posted_at_source`, `source_document_id`, `source_line_index`, `external_id`, status `repeated_legitimate`.
- `DupeVerdict` ganha `repeated_legitimate` e recebe a chave de identidade documental.

## 4. Código

**Motor de caixa** (`src/lib/engine/facts.ts` + espelho, via `scripts/sync-finance-core.mjs`):
- Âncora = snapshot **`confirmed`** mais recente com `balance_date <= asOf`; `pending_review`/`superseded` ignorados.
- Aplica só transações confirmadas de origem conta com `cashDateOf(t) > cutoff` **e** `cashDateOf(t) <= asOf`; pernas de transferência própria também por `cashDateOf`.
- `card_payment` reduz caixa uma vez e não é consumo; aplicação/resgate afetam caixa e investimentos, não consumo; `external_transfer_*` afetam caixa e não são renda/despesa; estorno afeta caixa por `posted_at` e abate consumo por `occurred_at`.
- Comportamento, categorias, ritmo e relatórios seguem em `occurred_at` — sem mudança.
- Consumidores unificados: `useFinancialSnapshot`, `pulse-compute`, `reports-core/engine.ts`, MCP (`financial-position`, `monthly-summary`).

**Importador único (PDF/JSON/CSV/OFX)** (`_shared/import/{schema,dedupe,stage,commit}.ts`, `assistant-ingest-document`, `BulkEntry.ts`, `src/lib/import/{csv,ofx}.ts`, `assistant-review-actions`, `ReviewSheet.tsx`):
- Identidade: `external_id` → `document_id + source_line_index`. Linhas repetidas do mesmo documento nunca colapsam entre si; comparação apenas contra transações pré-existentes, com consumo 1:1.
- Grava `occurred_at` (econômica) e `posted_at` (bancária, `posted_at_source='statement'`) separadamente.
- Confirmação individual ou em lote de `needs_review`; resposta sempre com `criados / ignorados / em revisão / falhos`; nunca “sucesso completo” em importação parcial; `completed` só com todos os itens em estado final.

## 5. Reparo dos dados (SQL transacional e idempotente — descrito, não executado)

Uma transação única; cada bloco guardado por `WHERE NOT EXISTS`, com `notes` marcada `REPAIR-2026-08-02` e linha do extrato, e entrada em `financial_reconciliation_audit`.

- **R1 — 13/07 PIX (efeito líquido zero, três movimentos reais):** 2× +600,00 `external_transfer_in` (PIX TRANSF VERA LU) e 1× −1.200,00 `external_transfer_out` (PIX TRANSF LUCI HA), `occurred_at=2026-07-11`, `posted_at=2026-07-13` (`statement`), `external_id = stmt:2026-07-13:<idx>` distintos.
- **R2 — 23/07 Uber:** inserir a segunda despesa real R$ 12,95 com `external_id` próprio; despesa + estorno existentes preservados; líquido −12,95.
- **R3 — 31/07 needs_review:** materializar +2.802,03 `external_transfer_in` (não é renda comportamental) e −3.760,82 despesa real (L S PRADO, categoria Serviços, `payment_method=account`), `posted_at=2026-07-31`; itens de staging correspondentes → `confirmed` com `transaction_id` vinculado.
- **R4 — pagamentos de fatura (decisão 5):** corrigir `709237d7…` para R$ 4.639,73 com `occurred_at/posted_at=2026-07-27`, mantendo `movement_kind=card_payment` e `settles_card_id`; inserir os quatro parciais (300,00 em 22/07; 50,00 e 220,00 em 23/07; 200,00 em 31/07). Se a alocação interna da fatura permanecer em R$ 4.636,08, a diferença de **R$ 3,65** é registrada em `financial_reconciliation_audit` como `manual_review` — sem classificar como consumo, juros ou tarifa, sem ajuste fictício e sem distorcer o caixa. Nenhuma reabertura artificial da fatura.
- **R5 — reembolso R$ 135,31 (decisão 1):** verificar `shared_expense_id`, `shared_goal_contributions`, `goal_contributions`. Sem evidência → `status='planned'` + nota de auditoria (sai do caixa, permanece rastreável). Nenhuma exclusão física. O R$ 135,30 de 30/07 (PIX LINCOLN) é preservado intacto.
- **R6 — Farmácia R$ 60,01 (decisão 2):** remover `account_id`, `status='planned'`, nota “origem bancária não comprovada”; não atribuir a cartão automaticamente; aguarda indicação do usuário.
- **R7 — itens processados em 03/08:** `posted_at='2026-08-03'` (`statement`) nos 16 movimentos listados, mantendo `occurred_at='2026-08-01'`. Soma de controle obrigatória: **−R$ 334,46**.
- **R8 — investimentos:** desmarcar `applied` do movimento `f7101603…` no duplicado zerado (sem alterar saldo), religar `investment_id` para `39c13ca8…`, aplicar o resgate (5.576,79 → **4.576,61** em `current_value` e `invested_amount`, `reference_date=2026-07-31`), `applied=true`; criar alias “CDB DI” → CDB DI Itaú; remover o duplicado `12092c98…` após confirmar zero movimentos remanescentes, com merge auditado. Fundo permanece R$ 3.000,00.
- **R9 — snapshots (decisão 3):** registrar snapshot histórico `confirmed` de **R$ 39,97 em 20/07/2026** (source `statement`) e marcar `629b7088…` (R$ 49,91) como `superseded` com auditoria; criar o snapshot oficial mais recente via RPC: `6c1cf814…`, `2026-08-02`, **R$ 589,39**, `statement`, `confirmed`, período 03/07–02/08/2026, emissão 02/08/2026 14:27:44.
- **R10 — cache:** `invalidateFinancialQueries` + recomputo de `financial_current_snapshots` e `pulse-compute`.

## 6. Ordem de execução

1. Verificação read-only pré-reparo + backup das tabelas tocadas.
2. M1 → M2 → M3 → M4 → M5.
3. Sync do core + motor de caixa + importador; suíte de testes verde.
4. `posted_at` real para todo o período do extrato (03/07–02/08) e itens de alto impacto.
5. Reparo R1…R9 em transação única, validando os 11 checkpoints antes do `COMMIT`.
6. Deploy das Edge Functions (`assistant-ingest-document`, `assistant-review-actions`, `agent-chat`, `insights-generate`, `pulse-compute`, `mcp`, `financial-reports-generate`).
7. R10 e validação E2E. Publicação **somente com autorização explícita**.

## 7. Rollback

- Backup pré-reparo (`repair_20260802_backup_*`) de `transactions`, `investments`, `investment_movements`, `account_balance_snapshots`, `extracted_items` do usuário.
- Reparo em transação única: checkpoint divergente → `ROLLBACK`.
- Reversão pós-commit por `notes LIKE 'REPAIR-2026-08-02%'` + restauração de UPDATEs a partir do backup.
- M1–M3 aditivas e reversíveis (`DROP COLUMN`); M4 guarda a versão anterior do trigger.

## 8. Testes

Unitários: motor de caixa com `posted_at` (itens 1, 2, 3, 6); dedupe preservando repetidas legítimas (4, 5); neutralidade de `external_transfer_*` e `card_payment`; `pending_review`/`superseded` fora do cálculo oficial.
Integração SQL: trigger de investimentos (alias, sem criação de zerado, resgate acima do saldo em revisão, idempotência INSERT/UPDATE/DELETE) — itens 10, 11; RPC de snapshot; reimportação do mesmo arquivo sem duplicar (14); rollback e reexecução seguros (15).
E2E: recomputo dia a dia comparado aos 11 checkpoints (20/07→02/08) e paridade em centavos entre Home, Contas, Patrimônio, Investimentos, Relatórios, Nino, WhatsApp, MCP e Pulso (13). Itens 7, 8, 9, 12 como asserções de estado final.

## 9. Critérios de aceite

- Itaú em 02/08 = **R$ 589,39**; em 03/08 = **R$ 254,93**.
- Os 11 checkpoints do extrato reproduzidos exatamente.
- CDB DI Itaú R$ 4.576,61 + Fundo R$ 3.000,00 = **R$ 7.576,61**; duplicado removido.
- Total guardado em 02/08 = **R$ 8.166,00**.
- Lote `6e768b47…` com 42 linhas rastreáveis e nenhum item sem estado final.
- Diferença de R$ 3,65 visível como reconciliação manual, não como consumo.
- Nenhum ajuste artificial, nenhum consumo novo, nenhum pagamento duplicado.

## 10. Arquivos e tabelas afetados

Arquivos: `src/lib/engine/facts.ts`, `src/lib/engine/metrics.ts`, `src/lib/hooks/useFinancialSnapshot.ts`, `src/lib/ledger/canonical.ts`, `src/lib/db/invalidation.ts`, `src/lib/import/{csv,ofx}.ts`, `src/components/assessor/ReviewSheet.tsx`, `supabase/functions/_shared/finance-core/*`, `_shared/import/{schema,dedupe,stage,commit}.ts`, `_shared/ledger/canonical.ts`, `_shared/agent/**/BulkEntry.ts`, funções `assistant-ingest-document`, `assistant-review-actions`, `pulse-compute`, `mcp`, `financial-reports-generate`, `insights-generate`, `scripts/sync-finance-core.mjs`, `docs/FINANCIAL_SOURCES.md`.
Tabelas: `transactions`, `extracted_items`, `document_imports`, `account_balance_snapshots`, `investments`, `investment_movements`, `investment_aliases` (nova), `credit_card_payments`, `credit_card_payment_allocations`, `financial_reconciliation_audit`, `financial_current_snapshots`.

## 11. Riscos remanescentes

- As 4 linhas `needs_review` e as 2 linhas perdidas do lote `6e768b47…` serão confirmadas na leitura do passo 0; se o conteúdo divergir do extrato, o reparo para e reporta antes do `COMMIT`.
- `posted_at` fora do período do extrato permanece `inferred`; futuros extratos sobrescrevem com `statement`.
- Reprocessar alocações de fatura depende da reversão limpa das alocações já gravadas para os R$ 4.636,08 — se houver estado inconsistente, entra em `manual_review` em vez de forçar.
- Farmácia R$ 60,01 e reembolso R$ 135,31 seguem pendentes de informação do usuário; ficam visíveis como `planned` até então.
