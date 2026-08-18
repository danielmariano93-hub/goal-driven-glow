# Integridade do motor de cartões — auditoria e correção (card_truth.v3)

## 1. Causa raiz confirmada (com evidência no banco)

Cartão auditado: fechamento 25, vencimento 30. Única fatura oficial existente: competência 2026-07, período 26/06–25/07, vencimento 30/07, **status `paid`**, total 4.636,08.

Consultas executadas mostram:

- 42 transações confirmadas do cartão com `competence_date` em agosto/2026, somando **5.691,17**; delas **5.149,94** ocorreram ANTES de 26/07 (início do ciclo em formação).
- 41 dessas transações têm parcela em `credit_card_installments` com `status = 'paid'` e `absorbed_by_statement_id` = a fatura de julho **já paga**, além de linha em `credit_card_statement_items` daquela fatura. Total absorvido indevidamente recontado: **5.689,71**.
- Ou seja: praticamente toda a "fatura de agosto estimada" é a fatura de julho já paga, contada duas vezes.

Duas falhas somadas produzem o número inflado:

**(a) Competência legada errada no ledger.** As transações nasceram da importação da fatura de julho quando a competência era derivada do mês do vencimento/entrada do documento, e ficaram com `competence_date = 2026-08-01`. A correção `invoice_cycle_truth.v2` (18/08) passou a derivar competência do fechamento, mas **não corrigiu o histórico**.

**(b) `card_exposure.v2` não tem guarda de absorção.** `estimateFromTxs` filtra apenas `credit_card_id`, `settles_card_id`, `status` e `competence_date`. Não verifica se a transação já foi absorvida por statement anterior. `installmentsOfCompetence` já verifica `absorbed_by_statement_id`, mas o caminho por transações não — então a proteção existe só na metade do cálculo.

**(c) Não existe matcher de parcelas.** `sync_card_accounting_from_transaction` deriva identidade da compra de `coalesce(purchase_group_id, NEW.id)`. Cada linha nova de fatura ("TURBI 02/03") cria um `credit_card_purchases` novo e um cronograma inteiro de parcelas novo. Há evidência disso: `credit_card_purchases` contém séries duplicadas e um registro com `merchant` igual a um prompt inteiro colado. Além disso, a competência das parcelas geradas é calculada por deslocamento de mês a partir da competência da transação — herdando o erro de (a).

## 2. Tabelas inconsistentes

| Tabela | Problema |
|---|---|
| `transactions` | `competence_date` legado divergente da fatura que absorveu a parcela (41 linhas, 1 usuário hoje; regra é sistêmica) |
| `credit_card_purchases` | compras recriadas por importação; sem merchant canônico; sem chave de identidade da série |
| `credit_card_installments` | cronogramas duplicados por série; competência derivada da competência errada |
| `credit_card_statement_items` | ok (tem unicidade por `legacy_transaction_id` e `source_extracted_item_id`) |

Unicidade `purchase_id + installment_number` **já existe** — o problema não é a constraint, é a resolução da identidade da compra.

## 3. Arquitetura proposta

### 3.1 Precedência canônica única (nova regra escrita em código e SQL)
```text
statement oficial fechado/pago  >  installment absorvida  >  cronograma de parcelas  >  ciclo por data da compra  >  competence_date legado
```

### 3.2 Guardas estruturais no `card_exposure` (v3)
`estimateFromTxs` e `estimateFromCycle` passam a receber um conjunto de exclusão derivado dos dados já carregados:
- transação com parcela `absorbed_by_statement_id` cujo statement é `paid/settled/closed`;
- transação com `credit_card_statement_items` ligada a statement de competência anterior;
- parcela em `paid/settled/refunded/cancelled/reversed/anticipated`;
- `movement_kind` em `card_payment`, `debt_payment`, `internal_transfer`, `external_transfer_*`;
- `settles_card_id` preenchido; `status <> 'confirmed'`.

Saída ganha decomposição explicável (`breakdown`): `newPurchases`, `contractedInstallments`, `feesInterest`, `refunds`, `credits`, `excludedAbsorbed`, `excludedCount`, e a lista de ids que formaram o número. Espelhado em `supabase/functions/_shared/finance-core/cardExposure.ts` via `scripts/sync-finance-core.mjs`.

### 3.3 Installment Matcher determinístico (SQL + TS compartilhado)
Nova função `public.match_card_installment(...)` usada pela importação, retornando decisão + score + candidatos:
`NEW_PURCHASE | MATCHED_EXISTING_INSTALLMENT | MATCHED_EXISTING_TRANSACTION | REFUND | FEE | INTEREST | PAYMENT | ADJUSTMENT | AMBIGUOUS | NEEDS_REVIEW`.

Evidências combinadas (nunca só merchant + valor): `credit_card_id`, merchant canônico, `purchase_id/legacy_purchase_group_id`, id de origem do documento, `installment_number`, `installments_total`, valor da parcela, total da compra, data da compra original, sequência esperada (`n-1` absorvida), competência esperada pelo ciclo, descrição normalizada, referência do documento. Match único e consistente → concilia; mais de um candidato plausível → `AMBIGUOUS` + `needs_review` com candidatos, **nunca vínculo arbitrário**.

### 3.4 Importação de fatura = conciliação
`finalize_invoice_statement` e a rota de gravação de itens passam a chamar o matcher antes de criar compra. Parcelas futuras são materializadas uma única vez (`ON CONFLICT (purchase_id, installment_number) DO NOTHING`) e a chegada de `02/06` apenas marca `absorbed_by_statement_id` da ocorrência existente.

## 4. Migrations (incrementais, sem DROP destrutivo)

1. `card_truth_v3_identity.sql` — colunas `merchant_canonical`, `series_key` em `credit_card_purchases`; índices de matching (`credit_card_id, merchant_canonical, installments_total`, `purchase_date`); colunas `match_decision`, `match_confidence`, `needs_review`, `match_candidates jsonb` em `credit_card_installments`.
2. `card_truth_v3_matcher.sql` — `match_card_installment`, revisão de `sync_card_accounting_from_transaction` (resolve identidade via matcher em vez de `purchase_group_id` cru) e de `finalize_invoice_statement` (absorção idempotente + eventos).
3. `card_truth_v3_events.sql` — tabela `card_reconciliation_events` (append-only, RLS por `user_id`, GRANTs) com `event_type` cobrindo `installment_matched|created|ambiguous|absorbed|anticipated|reconciled|duplicate_prevented`, `statement_reconciled|mismatch`, `card_exposure_calculated`.
4. `card_truth_v3_backfill.sql` — funções de backfill (não executa nada por si).

## 5. Backfill (idempotente, auditável, com dry-run)

`public.backfill_card_competence(p_user_id uuid default null, p_dry_run boolean default true)`:

1. Para cada transação de cartão, resolve competência pela precedência da seção 3.1.
2. Se a parcela está absorvida por statement, a competência da transação passa a ser a do statement — **o documento vence**.
3. Se não há statement nem parcela, usa `card_cycle_for(closing_day, due_day, coalesce(purchase_date, occurred_at))`.
4. Caso ambíguo (sem `closing_day`, sem parcela, sem statement, ou divergência inexplicada) → marca `needs_review`, **não altera**.
5. Cada alteração grava linha em `card_reconciliation_events` com valor antigo e novo → reversível por `ledger_corrections`/evento.
6. Retorna JSON: `changed`, `unchanged`, `ambiguous`, `by_user`, e no dry-run a amostra antes/depois.

Deduplicação de séries duplicadas de parcelas é feita **sem apagar histórico**: a série redundante é marcada `status='superseded'` + `needs_review`, apontando para a série canônica. Nada é deletado.

## 6. Testes

Unitários (`src/test/`): `cardExposure` v3 com fixtures dos casos A–L do pedido, incluindo o caso J (fechamento 25 / compra 25 vs 26) e o caso F (competência legada errada vs statement pago).

Fixture do incidente real (dados anonimizados, sem IDs hardcoded na regra): fatura julho paga 4.636,08 + 41 parcelas absorvidas + transações com competência agosto + ciclo 26/07–25/08 em formação. Antes: estimada ~5.691,17. Depois: apenas o que ocorreu no ciclo e não foi absorvido, com parcelas realmente futuras preservadas.

E2E/integração (SQL): reimportação do mesmo documento duas vezes → 0 novas compras, 0 novas parcelas, 0 alteração no total; pagamento parcial não gera consumo; antecipação remove parcela da exposição futura; estorno neutraliza obrigação.

Invariantes 1–10 do pedido viram asserções em `src/test/card-invariants.test.ts` + verificação SQL `assert_card_invariants(p_user_id)`.

## 7. Riscos de regressão

- **Baixar demais a fatura estimada**: mitigado por manter parcelas não absorvidas e por relatório antes/depois no dry-run.
- **Mexer em `reconcile_card_competence` legada**: ela reescreve competência por data de compra, o que quebra parcelas; será restringida à nova precedência (não removida).
- **Superfícies divergentes**: `Home`, `Cartões`, relatórios, MCP, Nino app/WhatsApp já consomem `computeCardExposure`; o espelho `finance-core` será regerado no mesmo commit para não divergir.
- **Trigger de sincronia**: alteração de `sync_card_accounting_from_transaction` afeta todo lançamento de cartão; será coberta por testes SQL antes/depois e mantém o comportamento atual quando o matcher devolve `NEW_PURCHASE`.

## 8. Entrega final

Matriz REQUISITO / IMPLEMENTAÇÃO / ARQUIVO-MIGRATION / TESTE / RESULTADO / EVIDÊNCIA, mais ANTES/DEPOIS (fatura estimada, registros considerados, absorvidos excluídos, parcelas futuras, casos `needs_review`). Cenário sem prova E2E será declarado explicitamente como não verificado.
