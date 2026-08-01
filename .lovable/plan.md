# Plano de implantação — pendências reais do Meu Nino (base: `3028d2c` publicado)

## A. Comprovadamente concluído — NÃO refazer

| Item | Prova |
|---|---|
| Suíte de testes | `bunx vitest run` → **130 arquivos / 826 testes, 0 falhas**, exit 0 |
| `spending_rhythm.v3` | `src/lib/engine/spendingRhythm.ts`: `grossAmount`/`refundAmount`/`netAmount`/`typicalAmount` por dia, sem clamp, `clampRangeToToday`, período anterior de igual tamanho, `excludedByReason`. Caso 31/07 do Daniel (despesa 84,28 × reembolso 135,31) preserva o bruto |
| `card_exposure.v1` | `src/lib/engine/cardExposure.ts`: precedência statement oficial > estimativa, `paid/settled` ⇒ obrigação 0, 5 números separados |
| Espelho determinístico | `scripts/sync-finance-core.mjs` + `src/test/finance-core-parity.test.ts` (cobre 2 módulos) |
| Fatura do Daniel quitada | `credit_card_statements` `f89d85b2…`: `stated_total=paid_amount=4636.08`, `outstanding=0.00`, `status=paid` |
| Julho R$ 2.593,49 como gasto de período | 20 transações com `occurred_at` em 07/2026; nunca entra em dívida |
| Escopo por usuário nas tools do assessor | todas as leituras auditadas em `_shared/agent/tools.ts` aplicam `.eq("user_id", ctx.user_id)`; categorias globais via `.is("user_id", null)` |
| `edge_error.v1` | `_shared/http.ts` com `request_id` e persistência em `edge_incidents` (7 funções) |
| `docs/FINANCIAL_SOURCES.md` | publicado |

## Causa raiz dos R$ 1.055,09 — resolvida na auditoria (não precisa mais investigar)

`credit_card_statement_items` do statement `f89d85b2…` (42 itens, soma 4.636,08):

| item_kind | n | soma | tx vinculada |
|---|---|---|---|
| purchase | 23 | 3.582,19 | 23 |
| installment | 18 | 2.107,52 | 18 |
| **adjustment** | **1** | **−1.053,63** | **0** |

- **R$ 1.053,63 = plug contábil.** Item `adjustment` "Ajuste de conciliação — Problema de conciliação do Nino", `occurred_at=2026-08-01`, sem `legacy_transaction_id` e sem `installment_id`. Foi criado pelo `force_reconcile_credit_card_statement` para forçar `reconciliation_difference=0`: o statement "fecha", mas as transações continuam 1.053,63 acima. Classificação: **item não contábil / plug de conciliação**.
- **R$ 1,46 = sinal incorreto.** Transação `d7c2e47e…`, 13/07/2026, "Cancelamento Parcial De…", R$ 1,46 lançada como `type='expense'` positiva, `origin='import'`, **sem item correspondente no statement**. Classificação: **crédito/estorno com sinal invertido**.
- 1.053,63 + 1,46 = **1.055,09**, igual a `v_card_double_counting.transactions_vs_official`. Nenhuma duplicidade de compra, nenhuma competência incorreta.

## B. Backlog restante

| P | Problema | Evidência | Impacto | Causa raiz | Afetados | Solução | Dep. | Risco | Aceite |
|---|---|---|---|---|---|---|---|---|---|
| **P0-1** | Plug de conciliação de −1.053,63 mascara divergência | item `adjustment` sem lastro | fatura "conciliada" com base falsa; auditoria impossível | `force_reconcile` permite plug sem exigir contrapartida | RPC `force_reconcile_credit_card_statement`, `credit_card_statement_items`, `Cartoes.tsx` | exigir `reason_code` + contrapartida; converter plug atual em item auditado e reprocessar | — | médio | `v_card_double_counting` vazia sem plug |
| **P0-2** | Estorno de 1,46 com sinal de despesa | tx `d7c2e47e…` `type=expense` | inflaciona gasto e ritmo | parser de fatura não reconhece "Cancelamento Parcial" como crédito | `_shared/documents/invoiceParser.ts`, `assistant-ingest-document`, `ledger/canonical.ts` | dicionário de créditos (cancelamento/estorno/crédito/reversão) → `type=income`+`movement_kind=refund`; corrigir a linha existente por UPDATE auditado | — | baixo | soma por competência = soma dos itens ± 0,00 |
| **P0-3** | Nino (app+WhatsApp) usa 2º motor para cartão | `_shared/engine/metrics.ts:315` `cardsOwed=computeCreditCardOutstanding(txs)` → 5691,17−4636,08 = **1.055,09** vs 0,00 na Home | resposta errada no canal principal; "disponível hoje" e projeção contaminados | E5 não levou `cardExposure` ao backend | `_shared/engine/{metrics,facts}.ts`, `scripts/sync-finance-core.mjs` | mover `facts`+`metrics` para `finance-core` espelhado; snapshot do agente passa a usar `computeCardExposure`/`totalCardDebtOf` | P0-1/2 | alto | `get_financial_snapshot` == Home no mesmo instante |
| **P0-4** | MCP expõe 3ª definição | `financial_position` usa só `credit_cards.total_limit`+`debts`; `list_card_statements` devolve linha crua | agente externo contradiz o app | tools MCP fora do motor | `src/lib/mcp/tools/financial-position.ts`, `list-card-statements.ts` | consumir o snapshot canônico; rótulo oficial/estimado | P0-3 | médio | 3 superfícies com números idênticos |
| **P1-1** | Ciclo real do cartão não modelado | cartão Itaú: `closing_day=25`, `due_day=1`; motor usa `currentYM`/`nextYM`; statement com `period_start`/`period_end` **NULL** | compras de 26–31 caem na fatura errada; "fatura em formação" inexistente | ausência de função de ciclo | `cardExposure.ts`, ingestão, RPC de finalização | `cycleFor(card, date)` → `{competence, period_start, period_end, closing, due}`; backfill de `period_*`; separar *fatura atual* de *fatura em formação* | P0-3 | alto | compras 24/25/26/31 caem no ciclo correto |
| **P1-2** | Absorção E6 incompleta e frágil | 41 parcelas de 2026-08 com `absorbed_by_statement_id=NULL`, `installments_absorbed_total=0.00`; só 18 itens `installment` têm `installment_id` | dupla contagem volta se um `status` mudar; risco de absorver parcela futura por existir fatura posterior | regra usa competência, não vínculo item↔parcela | migration E6, `credit_card_installments` | absorver **apenas** por `credit_card_statement_items.installment_id` de statement fechado/pago; nunca por competência | P1-1 | médio | 0 parcelas absorvidas sem item; 0 parcelas futuras absorvidas |
| **P1-3** | Contrato de erro em 17 de 24 funções | sem `_shared/http`: `mcp`, `whatsapp-send`, `whatsapp-session`, `whatsapp-ack-watchdog`, `whatsapp-official-number`, `split-reminders-dispatch(-v2)`, `shared-goal-notify-invite`, `agent-run`, `agent-proactive-tick`, `artifact-render`, `user-data-export`, `user-ai-preferences`, `admin-*`, `documents-cleanup`. `whatsapp-send:23` e `:160` devolvem `ok:true` fixo; `split-…-v2:426` `ok:true` no fim do lote | falso sucesso; `edge_incidents` com **0 linhas** | migração parcial | as 17 funções | migrar; `partial_success` explícito com `failed[]`; 4xx/5xx real em falha financeira ou de entrega | — | médio | teste força falha e grava `edge_incidents` |
| **P1-4** | V1 morta validada por testes | `split_message_pipeline_tick` chama **-v2**; `split-flow-contract.test.ts` e `split-delivery-tracking.test.ts` leem o `index.ts` da **V1** | testes verdes sobre código não executado | migração sem remoção | `supabase/functions/split-reminders-dispatch/`, 3 testes, `config.toml` | reapontar testes para v2 e remover V1 após 1 semana de observação | P1-3 | baixo | nenhum teste referencia V1 |
| **P1-5** | `insights-generate` e `whatsapp-ack-watchdog` sem cron | `cron.job` tem 8 jobs, nenhum os aciona | insights e watchdog de ACK só manuais | deploy sem agendamento | migration de cron | criar jobs com `INTERNAL_CRON_SECRET` | P1-3 | baixo | `job_heartbeats` com `last_ok` recente |
| **P1-6** | Invalidação de cache não centralizada | `src/lib/db/queryKeys.ts` tem **24 linhas** para Home/Cartões/Relatórios/Nino | Home velha enquanto Cartões já atualizou | keys ad-hoc | `queryKeys.ts`, `invalidation.ts`, `commitMovement.ts`, `creditCards.ts` | árvore `finance.*` + `invalidateFinance(scope)` único em toda mutação | P0-3 | médio | após pagar fatura, 4 telas mudam sem reload |
| **P2-1** | Fatos derivados vazios | `financial_daily_facts`, `financial_current_snapshots`, `financial_daily_category_facts` = **0 linhas**; `credit_card_purchases` (44) sem consumidor | risco de ler tabela vazia como verdade | backfill nunca concluído | `finance-backfill-runner`, `FINANCIAL_SOURCES.md` | **C** (estrutura futura): marcar legado e bloquear leitura | — | baixo | doc + guard |
| **P2-2** | Fluxos sem jornada real | `debt_payments`, `recurring_entries/rules/occurrences`, `shared_goals`, `user_challenges`, `xp_events` = **0 linhas** (`debts`=2, `challenges_catalog`=4) | superfície sem função | não exercitados | páginas correspondentes | **A** recorrências e `debt_payments`; **B** ocultar gamificação e metas conjuntas atrás de flag; **C** o resto | — | baixo | flags aplicadas |
| **P2-3** | Ritmo típico do backend sem classificação estrutural | `_shared/analytics/dailyAverage.ts:81` chama `computeRhythm(txs, range)` sem `categoryKindById`/`structuralCategoryIds` | Nino informa ritmo típico maior que a Home | `opts` não propagadas | `dailyAverage.ts` | carregar categorias e passar as mesmas `opts` | P0-3 | baixo | typical igual em ambas |
| **P2-4** | Timezone/datas sem padrão único | `todaySP()` só em `analytics/periods.ts`; `isoLocal` usa TZ do browser; `competence_date` do Daniel colapsada em `2026-08-01` para compras de jan–jul | fim de mês e meia-noite divergem | sem contrato de data | `periods.ts`, `spendingRhythm.ts`, ingestão | `America/Sao_Paulo` como única âncora; `competence_date` derivada de `cycleFor`, nunca do statement | P1-1 | médio | testes 31/01, 30/04, 25/26 do mês, meia-noite |
| **P2-5** | Segurança residual | tools rodam com **service role** e dependem de filtro explícito; `edge_incidents` e `v_card_double_counting` novas | vazamento se um filtro faltar | sem backstop de RLS no caminho service-role | `_shared/agent/tools.ts`, views novas | lint que barra `.from(` sem `user_id` no caminho do agente; `security_invoker=on` nas views; RLS de `edge_incidents` só `service_role` | — | médio | lint verde + policies confirmadas |

## C/D. Ondas (pequenas, reversíveis)

**Onda 0 — diagnóstico e testes vermelhos.** Risco **baixo**. Sem migration, sem deploy, sem publicação. Fixtures reais do Daniel: statement `f89d85b2…`, tx `d7c2e47e…`, item `555d6414…`. Testes que devem **falhar** agora: divergência de competência = 0; `adjustment` sem lastro proibido; "Cancelamento Parcial" ⇒ crédito; snapshot do agente == Home. Rollback: n/a.

**Onda 1 — saneamento dos dados do cartão.** Risco **médio**. Migration: `reason_code`+`requires_offset` em `credit_card_statement_items`, tabela `card_reconciliation_audit`, view `v_card_double_counting` com detalhe por item. Dados alterados: tx `d7c2e47e…` (expense→refund) e item `555d6414…` (reclassificado, **nunca deletado**). Deploy: `assistant-ingest-document`, `assistant-review-actions`. Publicação: não. Flag: `card_reconciliation_v2`. Rollback: reverter UPDATE pelo registro de auditoria.

**Onda 2 — ciclo por fechamento.** Risco **alto**. `cycleFor` em `cardExposure.ts` + espelho; backfill de `period_start/period_end` e recálculo de `competence_date`; absorção por `installment_id`. Deploy: funções de ingestão/revisão. Publicação: sim, após Onda 2 verde. Flag: `card_cycle_v2` com fallback para `currentYM`.

**Onda 3 — contrato financeiro único.** Risco **alto**. `finance_contract.v1` com `facts`+`metrics` no espelho; `_shared/engine/*` vira re-export; MCP e `dailyAverage` passam a consumir. Deploy: `agent-chat`, `agent-run`, `insights-generate`, `mcp`, `artifact-render`, `pulse-compute`. Publicação: sim. Rollback: flag `finance_contract_v1=false`.

**Onda 4 — erros, cache, observabilidade.** Risco **médio**. 17 funções para `_shared/http`; `partial_success`; crons de `insights-generate` e `whatsapp-ack-watchdog`; árvore `queryKeys.finance.*`. Publicação: sim.

**Onda 5 — fluxos incompletos e limpeza.** Risco **baixo**. Flags de gamificação/metas conjuntas; remoção da V1 de split; marcação de fatos derivados como legado. Publicação: sim.

## E. Matriz de verdade financeira final

| Conceito | Fonte oficial | Fallback | Fórmula | Superfícies | Rótulo |
|---|---|---|---|---|---|
| Gasto no cartão no período | `transactions.occurred_at` | — | `behavioralMetricAmount` bruto | Home, Relatórios, Nino, MCP | "Gasto no cartão no período" |
| Fatura atual | `credit_card_statements` do ciclo fechado | estimativa por ciclo | `outstanding`; 0 se `paid/settled` | Cartões, Home, Nino, MCP | "Fatura atual (oficial)" |
| Fatura em formação | compras do ciclo aberto | — | Σ do ciclo em curso | Cartões, Nino | "Fatura em formação (parcial)" |
| Próxima fatura | statement da próxima competência | estimativa | idem | Cartões, Nino | "Próxima fatura (estimada)" |
| Parcelas futuras | `credit_card_installments` sem absorção, ciclo > atual | — | Σ | Cartões, Nino | "Compromisso futuro — não é dívida" |
| Dívida atual do cartão | faturas não liquidadas | tx só sem statement | `totalCardDebtOf` | todas | "Dívida do cartão hoje" |
| Disponível hoje | `accounts`+snapshots | — | caixa − obrigações vencidas | Home, Nino | "Disponível hoje" |
| Patrimônio líquido | `computeNetWorth` com `cardDebtToday` | — | ativos − obrigações | Home, Nino | "Patrimônio líquido" |
| Bruto / reembolso / líquido / típico | `spending_rhythm.v3` | — | ver módulo | Home, Relatórios, Nino, artefatos | "Consumo bruto / Reembolsos / Líquido / Ritmo típico" |

## F. Correção dos dados do Daniel (sem apagar histórico)

1. Snapshot pré-correção em `card_reconciliation_audit` (statement, itens, tx, valores da view).
2. Tx `d7c2e47e…` (1,46): `type=income`, `movement_kind=refund`, `category_source='reconciliation'`; cria item de crédito no statement. Histórico preservado por `previous_*` + auditoria.
3. Item `555d6414…` (−1.053,63): reclassificado como `adjustment` com `reason_code='forced_plug_legacy'` e `requires_offset=true`, mantido para rastreabilidade; a reconciliação real passa a vir do detalhe item↔tx.
4. Absorção: vincular as 18 parcelas com `installment_id`; as demais permanecem não absorvidas por não terem item — sem absorção por competência.
5. Recalcular `period_start/period_end` (hoje NULL) via `cycleFor(closing_day=25, due_day=1)` e reprocessar `competence_date` das compras de jan–jul hoje colapsadas em `2026-08-01`.
6. Aceite: `v_card_double_counting` sem linhas; Home, Cartões, Relatórios e Nino respondendo dívida R$ 0,00 e julho R$ 2.593,49 como gasto.

## G. Sequência e proibições de paralelismo

0 → 1 → 2 → 3 → 4 → 5, estritamente serial. **Não** rodar em paralelo: Onda 1 com Onda 2 (ambas mexem em `competence_date`); Onda 2 com Onda 3 (contrato mudaria durante o backfill); qualquer onda com importação de documento em andamento. Ondas 4 e 5 podem se sobrepor parcialmente entre si.

## H. Decisões de produto que precisam da sua aprovação

1. O plug de −1.053,63 deve ser **mantido como item auditado** (recomendado) ou estornado, deixando a fatura oficial divergente do total informado?
2. "Fatura em formação" passa a ser um card visível em Cartões e resposta do Nino, ou métrica interna?
3. Gamificação/desafios e metas conjuntas: ocultar atrás de flag até haver jornada (recomendado) ou concluir agora?
4. Recorrências e `debt_payments`: concluir nesta rodada ou ocultar?
5. Fatos derivados vazios: declarar legado (recomendado) ou concluir o backfill?
6. Remoção da V1 de split: imediata após reapontar os testes, ou com janela de observação de 7 dias?
7. Autorização para publicar frontend ao fim das Ondas 2, 3, 4 e 5 (hoje o publicado é `3028d2c`).

Nada foi implementado. Aprove para eu começar pela Onda 0.
