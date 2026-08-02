# Visão Financeira Completa e Reconciliável — `finance_contract.v4`

## 1. Diagnóstico do estado atual (verificado em leitura)

- `src/lib/engine/facts.ts` (756 linhas) já tem: `cashDateOf` (posted_at), `computeAccountBalances` ancorado em snapshot, `EXCLUDED_MOVEMENT_KINDS`, `EXTERNAL_TRANSFER_KINDS`, `computeAccountStatementTotals` (bruto), `computeNetWorth`, `computeMonthlyIncomeExpense`. Falta: decomposição por natureza de movimento, ponte de caixa fechada, ponte patrimonial, posição inicial/final de investimentos e dívidas.
- `src/lib/ledger/canonical.ts` já define 13 `movement_kind` com `cash_effect` / `result_effect` / `liability_effect`. Falta `investmentImpact` e `netWorthImpact` explícitos, e o mapa não é reutilizado nas leituras (só na ingestão).
- `metrics.ts` expõe `FINANCE_CONTRACT_VERSION = finance_contract.v3` e `computeFinancialSnapshot` (posição atual + ritmo). Não produz blocos B/C/D.
- `PonteCaixaCard.tsx` é uma ponte **derivada** (`opening = closing − income + expense`), não uma ponte reconciliada por natureza — é o gap central da pergunta 3.
- `Relatorios.tsx` (234 linhas) mostra "Resultado do período" isolado; sem saldo inicial/final nem bloco patrimonial.
- Relatórios inteligentes: `ReportPayload.totals` não tem opening/closing nem naturezas; `healthBreakdown` pune saldo negativo do período; **não existe exclusão** de relatório.
- MCP `financial_position` cobre só cartões/dívidas/metas.
- `pulse-compute`, insights e Nino consomem income/expense — não distinguem caixa vs. patrimônio.

## 2. Modelo canônico novo (núcleo do trabalho)

Novo módulo `src/lib/engine/bridges.ts` (espelhado para Edge por `scripts/sync-finance-core.mjs`):

- `MOVEMENT_SEMANTICS`: mapa único `movement_kind × type →` `{ cashImpact, performanceImpact, investmentImpact, debtImpact, netWorthImpact, bridgeLine }`. Substitui toda classificação ad-hoc.
- `computeCashBridge({accounts, txs, snapshots, period})` → linhas: `opening_cash`, `operational_income`, `operational_account_expense`, `investment_redemptions`, `investment_applications`, `external_transfers_in/out`, `internal_transfers_net`, `loan_proceeds`, `debt_principal_payments`, `debt_interest_and_fees`, `card_payments`, `refunds_and_reimbursements`, `adjustments`, `calculated_closing_cash`, `confirmed_closing_cash`, `reconciliation_difference`, `confidence`, `formula_version`, `evidence`. Windowing por `cashDateOf` (posted_at → occurred_at).
- `computeNetWorthBridge(...)` → `opening_*`, `operational_result`, `investment_return`, `applications/redemptions`, `debt_principal_change`, `interest_and_fees`, `valuation_adjustments`, `closing_*`, `reconciliation_difference`.
- `computePeriodPerformance(...)` → receitas reais, gastos reais líquidos de estorno, `operational_gap`, taxa de sobra — nenhum movimento patrimonial incluído.
- `explainBalanceChange(bridge)` → texto determinístico em PT-BR (template com os números reais, sem LLM), mais `tone` e `headline` orientados a leigo.
- Invariantes com tolerância de 1 centavo; divergência vira `reconciliation_difference` + `confidence: low`.

`metrics.ts`: `FINANCE_CONTRACT_VERSION = "finance_contract.v4"`; `computeFinancialSnapshot` passa a devolver `{ currentPosition, periodPerformance, cashBridge, netWorthBridge }` mantendo os campos atuais como aliases (compatibilidade).

## 3. Migrations

1. `financial_cash_bridges` — todas as colunas listadas no pedido + `formula_version`, `evidence jsonb`, `confidence`, `computed_at`, `unique(user_id, account_id, period_start, period_end, formula_version)`. GRANT `authenticated` (SELECT/INSERT/UPDATE/DELETE) + `service_role` ALL; RLS por `auth.uid()`.
2. `financial_net_worth_bridges` — colunas de abertura/fechamento e variações; mesmos GRANT/RLS.
3. `financial_report_metrics`: garantir as 22 chaves canônicas (registro em `intelligence_metric_registry`).
4. `report_deletion_audit` (ou reuso de `platform_admin_audit` com `scope='report'`) + RPC `delete_financial_report(p_report_id uuid)` `SECURITY DEFINER` que valida `user_id = auth.uid()` e apaga em transação `financial_report_metrics`, `financial_report_highlights`, `financial_report_deliveries` e o relatório, gravando auditoria.
5. RPC `upsert_cash_bridge` / `upsert_net_worth_bridge` (service_role + owner) usadas pelas Edge Functions.
6. Backfill: recomputa pontes dos últimos 13 meses por usuário a partir de `transactions` + `account_balance_snapshots` (idempotente por unique key).
7. `movement_kind` sem valor em transações antigas: inferência conservadora (`settles_card_id` → `card_payment`; contrapartida de investimento → application/redemption; resto → `transaction`), gravando `movement_kind_source='inferred'`.

## 4. Alterações por tela

**Home** (`Index.tsx`, `HeroDisponivelCard`, `PatrimonioSheet`, `PonteCaixaCard`, `PrevisaoFechamentoCard`, `RitmoCard`, `RitmoGastosCard`)
- "Disponível hoje" ganha selo "não muda com o período".
- `PonteCaixaCard` reescrito sobre `computeCashBridge`: cascata resumida (início → naturezas agrupadas → final) + link "Entenda como esse saldo foi formado" abrindo sheet com a ponte completa e a explicação determinística.
- `PatrimonioSheet`: "Total guardado" → "Seus recursos hoje"; blocos Dinheiro em conta / Investido / Recursos totais / Obrigações (fatura aberta + dívidas) / Parcelas futuras (compromisso) / Patrimônio líquido.
- `PrevisaoFechamentoCard`: premissas explícitas (saldo atual, receitas previstas, compromissos, fatura, projeção de consumo, movimentações patrimoniais programadas).

**Relatórios tradicionais** (`Relatorios.tsx`, `lib/reports/aggregations.ts`) — quatro blocos A/B/C/D; tabela mensal → cards expansíveis mobile-first com saldo inicial, receitas, gastos, movimentações patrimoniais, pagamentos financeiros, saldo final e divergência; copy sem "Resultado: −R$ X".

**Relatórios inteligentes** (`reports/intelligent/{types,engine,highlights,narrative,numericGuard}.ts`, `ReportMetricsGrid`, `ReportCharts`, `RelatoriosInteligentes.tsx`, `RelatorioInteligenteDetalhe.tsx`, `financial-reports-generate`)
- `ReportPayload` ganha `cashBridge`, `netWorthBridge`, `position`; as 22 métricas canônicas persistidas.
- `healthBreakdown` passa a 6 dimensões (rotina, liquidez, compromissos, patrimônio, dívidas, qualidade dos dados); uso planejado de reserva não penaliza.
- Novas famílias de highlight de ponte; `mergeHighlights` mantém dedupe por família.
- `REPORT_TEMPLATE_VERSION` → `report_template.v3` (auto-heal já existente regenera relatórios antigos).
- **Exclusão**: botão em listagem e detalhe, `AlertDialog` de confirmação, chamada da RPC, `invalidateFinancialQueries` + remoção otimista, toast.

**Contas** (`Contas.tsx`) — por conta: saldo atual, última conciliação, origem, confiança, calculado pós-snapshot, diferença, histórico; aba "Movimentação do período" (inicial, créditos, débitos, final, divergência).

**Lançamentos** (`Lancamentos.tsx`, `LancamentoDetalhe.tsx`) — badge de natureza a partir de `MOVEMENT_SEMANTICS` + painel "O que isso afeta" (caixa / resultado / investimento / dívida / patrimônio) e datas econômica vs. bancária.

**Investimentos** (`Investimentos.tsx`) — por ativo: saldo inicial, aplicações, resgates, rentabilidade, saldo final; explicação de efeito patrimonial neutro; endurecer matching de alias (normalização + `investment_aliases`) para não criar ativo zerado duplicado.

**Cartões / Dívidas / Metas** — semântica unificada (compra = consumo + obrigação, pagamento = caixa + obrigação); dívidas separam principal, saldo, amortização, juros/tarifas; metas separam contribuição registrada, dinheiro reservado, investimento vinculado e saldo em conta, com guarda anti-dupla-contagem.

**Insights** (`insights-generate`, `insights/fallbacks.ts`) — 11 novas famílias listadas no pedido, cada uma com evidência numérica e distinção caixa/resultado/patrimônio.

**Nino / WhatsApp / Agente** (`AgentCore`, `IntentRouter`, `tools.ts`, `ResponseValidator`) — 4 intents novas (posição, rotina, formação do saldo, variação patrimonial); validador bloqueia resposta de saldo/patrimônio derivada de `income − expense`.

**MCP** (`src/lib/mcp/tools/*`) — novas tools `get_current_position`, `get_period_result`, `get_cash_bridge`, `get_net_worth_change`, `explain_balance_change`, todas com `formula_version`, `confidence` e explicação; `financial_position` mantida como alias.

**Pulso** (`pulse-compute`, `pulse/rules.ts`) — 5 fatores: rotina, caixa, patrimônio, dívidas, qualidade dos dados.

## 5. Testes e critérios de aceite

- Unitário por natureza de movimento (13 kinds × income/expense) em `src/test/movement-semantics.test.ts`.
- `cash-bridge.test.ts` e `net-worth-bridge.test.ts`: invariantes de fechamento ≤ R$0,01.
- Paridade em centavos entre Home, Relatórios, Relatórios Inteligentes, Contas, Investimentos, MCP, Pulso e Nino (teste de contrato cruzado, estendendo `finance-contract.test.ts`).
- Asserts negativos: resgate ≠ receita; aplicação ≠ gasto; compra no cartão não reduz caixa; pagamento de fatura não gera consumo; empréstimo ≠ receita.
- Exclusão de relatório: RLS (usuário não apaga de outro), cascata completa, auditoria.
- E2E Playwright mobile (390×844) nas telas alteradas + verificação de ausência de "Resultado: −R$".

## 6. Sequência de execução (uma rodada)

1. `bridges.ts` + `MOVEMENT_SEMANTICS` + testes unitários.
2. `metrics.ts` v4 e sync do core para Edge (`npm run sync` no prebuild).
3. Migrations 1–5 (uma migration consolidada), depois backfill (migration 6–7) com verificação de reconciliação.
4. Camada de leitura: hooks, Home, Relatórios, Contas, Lançamentos, Investimentos, Cartões, Dívidas, Metas.
5. Relatórios inteligentes + exclusão.
6. Edge Functions: `financial-reports-generate`, `insights-generate`, `pulse-compute`, `agent-chat`, `mcp`, `assistant-review-actions`.
7. Suíte completa de testes, deploy das Edge Functions, rebuild e publicação.

**Rollback**: contrato v4 é aditivo (aliases v3 preservados); tabelas de ponte são derivadas e podem ser truncadas/recomputadas; `report_template.v3` regenera sob demanda; revert de código restaura leituras v3 sem perda de dados. Backfill de `movement_kind` grava `movement_kind_source='inferred'` para reversão seletiva.

**Riscos**: (a) transações legadas sem `movement_kind` → mitigado por inferência conservadora + `confidence` na ponte; (b) snapshots antigos/ausentes → ponte marca `confidence: low` e a UI mostra "conciliação pendente" em vez de número falso; (c) custo de recomputo → pontes persistidas e cache invalidado centralmente por `invalidateFinancialQueries`.
