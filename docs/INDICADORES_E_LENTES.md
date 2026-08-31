# Indicadores e lentes de data (`reporting_competence.v1`)

Fonte única de consulta: qual indicador aparece em cada superfície, qual motor o
produz e qual lente de data ele usa. Nenhuma superfície recalcula fórmula.

## As duas lentes (e só duas)

| Lente | Função | Regra |
| --- | --- | --- |
| Competência de relatório | `reportingCompetenceDate(t)` | Cartão pertence ao mês da fatura (`competence_date`); demais meios seguem `occurred_at`. Toda soma **mensal ou por categoria** usa esta lente. |
| Data do lançamento | `t.occurred_at` | Extrato, histórico, ritmo diário e leituras comportamentais (dia da semana, hábito). Nunca usada para total de mês/categoria. |

Terceira lente não existe. Se uma tela precisa de outro recorte, ela declara o
recorte na interface — não inventa soma própria.

## Indicadores por superfície

| Superfície | Indicador | Motor | Lente |
| --- | --- | --- | --- |
| Home / Categorias | despesa do mês por categoria | `computeCategoryBreakdown` (`engine/facts.ts`) | competência |
| Home | totais do mês (receita/despesa/saldo) | `computeMonthlyTotals` | data do lançamento (comportamental) |
| Metas por categoria | gasto realizado, projeção e teto | `evaluateCategoryGoal` (`engine/metrics.ts`) | competência |
| Detalhe da meta | lista "Lançamentos considerados" | mesma lente do teto | competência (mostra "fatura de …" quando difere) |
| Relatórios Inteligentes | totais, categorias, comparação | `buildIntelligentReport` (`reports/intelligent/engine.ts`) | competência |
| Relatórios (CSV/gráficos) | agregações do período | `reports/aggregations.ts` | competência |
| Nino / WhatsApp | comparação e desempenho de metas | `goalPerformanceAssessment`, `financialComparison` | competência |
| MCP (`monthly_summary`) | resumo mensal e top categorias | mesmo `computeCategoryBreakdown` | competência |
| Extrato / Lançamentos | ordem e agrupamento por dia | leitura direta | data do lançamento |
| Ritmo diário, emoções, hábitos | média/dia, padrões | `spendingRhythm`, `emotionFinance` | data do lançamento |

## Verdade gravada tem versão

Relatório de período fechado é resultado **gravado**. Cada mudança de lente sobe
`REPORT_TEMPLATE_VERSION` (`src/lib/reports/intelligent/types.ts`). A tela de
detalhe compara a versão gravada com a atual (`isReportStale`) e pede recálculo
em vez de apresentar número de outra régua como verdade atual. A função de
geração também regenera automaticamente relatórios de template antigo.

## Guardas automáticas

- `scripts/check-tx-selects.mjs`
  - colunas do `SELECT` precisam existir em `transactions`;
  - agregação mensal precisa carregar `competence_date`;
  - toda definição de `computeCategoryBreakdown` precisa usar `reportingCompetenceDate`.
- `src/test/category-single-truth-surfaces.test.ts` — breakdown, meta e relatório
  precisam devolver o mesmo total para o mesmo mês, incluindo cartão de ciclo
  anterior e estorno.
- `src/test/finance-core-parity.test.ts` — espelho das edge functions idêntico à fonte.

## Leitura completa (`paged_select.v1`)

A Data API devolve no máximo **1.000 linhas por requisição** e ignora limites
maiores sem erro. Foi o que fez o relatório mostrar Transporte R$ 1.603,76
enquanto a verdade de agosto/2026 era R$ 2.389,99: o loader pedia 8.000 linhas,
recebia as 1.000 mais antigas e somava um pedaço do mês.

Toda leitura de `transactions` que alimenta número exibido, agregação, dedupe ou
motor de análise usa `fetchAllPages` (`supabase/functions/_shared/derived/pagedSelect.ts`
e `src/lib/db/pagedSelect.ts`) com `.range()` e ordenação estável.

Guarda: `findTruncatedTransactionReads` em `scripts/check-tx-selects.mjs`
(`.limit(N > 1000)` sobre `transactions` falha o contrato).
