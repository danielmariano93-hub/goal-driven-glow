# Verdade financeira única — correção sistêmica (finance_truth.v1)

Preflight somente leitura já executado. Abaixo, primeiro a evidência, depois a correção em bloco único.

## A. Evidência confirmada (produção + código)

Produção, usuário de validação, agosto/2026 (query sobre `transactions` + vínculo `refund_of_transaction_id`):

| Categoria | Bruto | Estornos vinculados | Líquido |
| --- | --- | --- | --- |
| Transporte | 674,75 | 213,93 | 460,82 |
| Alimentação | 416,43 | 21,10 | 395,33 |
| Assinaturas | 103,40 | 0 | 103,40 |

Dívidas do usuário: 3 ativas, todas com `first_due_date = NULL` e `start_date = NULL` (Banco Pan: `due_day=10`, `installments_paid=18`, criada em 30/07/2026; Cartao Atacadao `due_day=30`; Celular `due_day=28`). Confirma que `debtStatus.v1` não tem âncora para calcular vencimento.

Causas raiz confirmadas em código:

1. `src/lib/reports/aggregations.ts` → `byCategory()` agrupa por `t.category_name` bruto; estorno cai em "Estornos" e não abate a categoria original.
2. `supabase/functions/_shared/analytics/compare.ts:43` → total usa `behavioralMetricAmount`, mas o breakdown agrupa por `t.category_id` bruto: total certo, driver errado.
3. `supabase/functions/financial-reports-generate/index.ts:49` → select de `transactions` sem `refund_of_transaction_id`: o motor sabe atribuir, o dado não chega.
4. `supabase/functions/_shared/engine/metrics.ts:185` → `AGENT_TRANSACTION_SELECT` sem `refund_of_transaction_id`; e `account_balance_snapshots` selecionado apenas com `account_id,balance_date,balance,status` — sem `anchor_kind`, `source_document_id`, `reconciliation_delta`, logo o agente não reconhece a âncora bancária da Home.
5. `src/lib/mcp/tools/monthly-summary.ts:18` → `TX_COLUMNS` sem `refund_of_transaction_id` (a query de snapshots já lê os campos de âncora; o mapper descarta).
6. `src/lib/engine/metrics.ts:624` → `computeCategoryBaseline()` filtra `t.category_id !== categoryId` e soma `amount` bruto: baseline de meta inflada por estorno.
7. `refresh_financial_daily_facts` em produção não menciona `refund_of_transaction_id` (verificado em `pg_proc`): `financial_daily_category_facts` agrupa refund na categoria "Estornos".
8. `supabase/functions/insights-generate/index.ts:452` e `financial-reports-generate/catalogHighlights.ts:151` → `availableToday` somando `accounts.current_balance`, fora do contrato bank_cash_truth; e projeção linear `expense/dayOfMonth*daysInMonth` (linha 438).
9. `pulse-compute/index.ts:154-160` → `paymentsOnTime90d=0`, `paymentsTotal90d=0`, `outstanding30dAgo = outstandingToday` (fator de dívida fictício).
10. `ProactiveEngineV2.ts:221` → ainda usa `runAllDetectors` do motor legado; os 9 motores determinísticos não são consumidos por proatividade, Home, insights nem relatórios.
11. Cache: diagnóstico usa a query key `["n", userId]` (`src/lib/nino/diagnosis.ts`), ausente de `FINANCIAL_QUERY_KEYS`.

## B. Correção — camada de fatos canônicos

Criar em `src/lib/engine/` (espelhado por `scripts/sync-finance-core.mjs`) um contrato único de período, `canonicalFacts.ts` (`finance_truth.v1`), com uma implementação para: totais do período; categorias (líquido, bruto, refunds atribuídos, contagem, participação, merchants); categoria específica; comparação com drivers por categoria e merchant; caixa (âncora + movimentos + `reconciliation_id`); dívidas. Toda saída carrega `engine`, `formula_version`, `period`, `as_of`, `confidence`, `evidence`.

Regra de refund incorporada no núcleo (não opcional): `buildRefundAttribution()` + `effectiveCategoryId()` passam a ser aplicados dentro do contrato; refund entra no caixa, não é renda, abate categoria/merchant/meta/relatório/comparação da compra original; `superseded` nunca entra.

Contrato de leitura: um único `TRANSACTION_FACT_SELECT` e `BANK_ANCHOR_SELECT` exportados pelo core. Todo consumidor passa a usá-los; teste de contrato falha se um consumidor canônico receber `TransactionRow` sem `refund_of_transaction_id` ou snapshot sem os campos de âncora.

## C. Consumidores migrados (eliminando cálculo paralelo)

- Relatórios padrão: `Relatorios.tsx` + `reports/aggregations.ts` passam a delegar ao contrato (ranking, "para onde foi o dinheiro", percentuais, contagem, CSV, comparações). Query keys locais entram na invalidação canônica.
- Metas: `evaluateCategoryGoal` e `computeCategoryBaseline` passam a usar categoria econômica efetiva; Home, Metas e Assessor consomem uma única avaliação canônica de CategoryGoal.
- Provenance de limite: novo campo distinguindo limite `auto_computed` de `manual_override`; recomputo apenas do que for comprovadamente automático; legado ambíguo é preservado e marcado.
- Relatórios inteligentes (`reports/intelligent/engine.ts` + `_shared/reports-core/*`): essencial/flexível, comparação, health score, highlights e narrativa passam a ler o mesmo valor líquido.
- Edge `financial-reports-generate`: select completo; `catalogHighlights.ts` deixa de somar `current_balance` e passa a consumir snapshot canônico, Recurring Discovery, Anomaly Engine, Merchant Intelligence, Debt Status e Forecast.
- `compare.ts` e `explain_spending_change`: agrupamento por categoria efetiva; nunca gerar driver "Estornos".
- Assessor (`agent/tools.ts`): `analyze_spending`, `get_spending_highlights`, `compare_periods`, `get_financial_snapshot`, `list_category_spending_goals` migrados para o contrato.
- Snapshot do agente (`_shared/engine/metrics.ts`): select de transações e de âncora bancária alinhados a `useFinancialSnapshot()`.
- MCP: `monthly-summary`, `financial-position` e demais tools financeiras usam o contrato; status/atraso de dívida via Debt Status.
- `insights/facts.ts` legado é substituído (categoria líder, crescimento, weekday, merchant, ritmo de meta) pelos motores canônicos; `insights-generate` vira orquestrador, sem fórmula própria de saldo, ritmo ou projeção.
- Proatividade: claims financeiros passam a vir dos motores determinísticos; a camada proativa decide o que comunicar, não recalcula quanto foi.
- Pulso: sem placeholder — posição histórica de dívida calculada ou fator marcado como neutro/missing; Debt Status para vencido/em dia/atraso.
- Home: números canônicos preservados; toda situação do diagnóstico passa a expor engine/period/formula_version/evidence, com o SQL como composição.

## D. Dívidas — modelo, tela e ecossistema

- Migration: contrato de monitoramento (`tracking_started_at`, `baseline_installments_paid`, `next_monitored_due_date` ou equivalente), sem inventar histórico. Legado: data de cadastro como início de monitoramento, `installments_paid` como baseline, apenas ciclos monitorados posteriores.
- `debtStatus` passa a resolver a agenda por esse contrato: Em atraso / Vence hoje / Vence em X dias / Em dia / Agenda incompleta / Quitada, com parcelas vencidas, valor e dias de atraso, próximo vencimento e último pagamento. Ambiguidade mostra "Precisamos confirmar o próximo vencimento" — nunca "Continue assim" sem evidência.
- Formulário de dívida passa a capturar o próximo vencimento monitorado.
- `Dividas.tsx`: status visual vindo do motor; botões dos cards com hitbox ~40x40, `shrink-0`, ícone 16–18px, contraste, `aria-label`/`title`, overflow em telas estreitas (validado em largura de iPhone).
- `record_debt_payment` invalida Dívidas, Snapshot, Commitment Agenda, Debt Status, diagnóstico, Home, Insights, Proatividade, Pulso, Assessor e WhatsApp; alerta de atraso fecha sozinho.

## E. SQL, materializações e reprocesso

- Nova migration corrigindo `refresh_financial_daily_facts`: refund com vínculo válido é atribuído à categoria da transação original via JOIN restrito ao mesmo `user_id`; sem atribuição cross-user.
- Materialização tratada como cache: teste de paridade centavo por centavo entre finance-core TS, espelho Edge e SQL para o mesmo fixture; divergência quebra o release.
- Reprocesso após aplicar: `financial_daily_facts`, `financial_daily_category_facts`, diagnóstico, situações, insights, Pulso, caches e relatórios do período aberto. Relatórios de período fechado permanecem imutáveis com `as_of` + `formula_version`; período aberto ganha semântica de stale/regenerar.
- Nenhuma transação financeira é alterada, criada ou apagada para fazer tela bater.

## F. Cache e invalidação

`nino-diagnosis` (`["n", userId]`) e as chaves próprias de Relatórios entram em `FINANCIAL_QUERY_KEYS`; ilhas de query eliminadas ou incorporadas.

## G. Testes e gates

Nova matriz `financial_truth_surface_parity` com o mesmo dataset cobrindo: totais (Home/Report/Agent/MCP/Insights); categoria (Report/Goal/Agent/MCP/Relatório Inteligente); refund 100/30 → 70; refund total → 0; refunds parciais múltiplos → 50; herança de categoria; `superseded` fora de todo cálculo; pagamento de fatura fora do consumo; resgate de investimento fora da receita; mesma âncora bancária em App, Agent e MCP. Mais os gaps sem cobertura hoje: `engineTools`, `answerFormat`, `debtStatus`, tool de forecast, roteamento `money_leaks` e `debt_status`, paridade factual App × WhatsApp, e testes de contrato de select. Fecho com Vitest completo, typecheck e build.

## H. Validação E2E e entrega

Após deploy, consultas somente leitura provando, para o mesmo `as_of` e período agosto/2026: Transporte 460,82 · Alimentação 395,33 · Assinaturas 103,40 em canonical facts, Relatórios, Metas, Relatório Inteligente, Agent e MCP; `availableToday` idêntico em Home, Agent e MCP; e status de dívida idêntico em tela, `get_debt_status`, diagnóstico e detector proativo — com prova matemática do caso Banco Pan. Relatório final com causa raiz por divergência, arquivos alterados, migrations, caminhos legados removidos, motores adotados por superfície, dados reprocessados, resultados de teste, evidência de produção, tabela de paridade e gaps remanescentes. Se qualquer superfície divergir, não declaro concluído.

## Notas técnicas

Sem hardcode de valores, sem lançamento artificial, sem uma tela consultando a outra, sem motor duplicado e sem fallback legado silencioso. Preserva bank_cash_truth, Category Truth V2, refund links, superseded auditável, Card Exposure, Commitment Agenda, Spending Rhythm, Before Spending e os motores determinísticos existentes, além de App e WhatsApp no mesmo `handleTurn`. Migrations envolvidas: correção de `refresh_financial_daily_facts`, contrato de monitoramento de dívida e provenance de limite de meta. Sem alteração de identidade visual e sem publicação em produção sem autorização.
