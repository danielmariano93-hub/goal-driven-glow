# Plano — Home Comportamental v4 + Metas de Categoria + Paridade Agente

Entrega única, sem etapas futuras. Todos os cálculos determinísticos, testados e centralizados. LLM apenas explica.

## 1. Fonte única de verdade — `FinancialMetricsService`

Novo módulo compartilhado em duas cópias sincronizadas (mesmo código, mesmo comportamento):

- `src/lib/engine/metrics.ts` (frontend / React Query)
- `supabase/functions/_shared/engine/metrics.ts` (Agent Core / Edge Functions)

Ambos re-exportam a partir de um núcleo puro que consome:
- `accounts` + `account_balance_snapshots` + `transactions` (para saldo atual real)
- `recurring_rules` + `recurring_occurrences` (compromissos)
- `investments`, `debts`, `credit_cards`
- `categories` + novas metas de categoria

Assinatura única:
```ts
computeFinancialSnapshot(input, { today, period }) => FinancialSnapshot
```

`FinancialSnapshot` expõe exatamente os campos do item 33 do briefing:
availableToday, availableAccountsBreakdown, netWorth (+breakdown), selectedPeriod,
currentAverageDailyConsumption, previousAverageDailyConsumption, averageDailyVariation,
currentCardSpend, previousCardSpend, cardSpendVariation,
monthToDateAverageConsumption, daysRemainingInMonth, confirmedFutureIncome,
knownFutureCommitments, projectedRemainingConsumption, projectedMonthEndAvailable,
projectionBreakdown, activeCategoryGoals[], categoryGoalStatus[],
categoryGoalProjectedSpend[], categoryGoalDailyAllowance[], categoryGoalRequiredDailyReduction[],
pulse, relevantHighlights[], nextBestAction.

Regras exatas conforme itens 6, 10, 12, 24–31 do briefing (Disponível hoje = saldo líquido atual sem descontar fatura futura; gasto médio exclui aplicações/transferências/pagamento de fatura/estornos; projeção = disponível + entradas futuras − compromissos − consumo projetado sem dupla contagem cartão).

Componentes React consomem via um único hook `useFinancialSnapshot(period)` (React Query, chave por `user_id + period + today`), invalidado por `invalidateFinancialQueries` já existente (estendido).

Agent Core consome via `TurnContext.snapshot({ metrics: true })` — `FinancialContext360` ganha um branch `metrics` que chama `computeFinancialSnapshot` no server e injeta o objeto estruturado no prompt (nunca texto solto).

## 2. Metas de categoria

Nova tabela `category_spending_goals` (única migration necessária):
```
id uuid pk, user_id uuid, category_id uuid,
mode text check ('percent_reduction','fixed_limit'),
reduction_pct numeric, fixed_limit numeric,
baseline_kind text check ('prev_month','avg_3m','custom'),
baseline_value numeric, computed_limit numeric,
frequency text check ('once','monthly','custom'),
start_date date, end_date date, status text ('active','paused','cancelled'),
alerts jsonb, created_at, updated_at
```
Com GRANT completo, RLS por `user_id`, trigger de `updated_at`.

Cálculo em `metrics.ts` seguindo itens 19–21 (T, saldoMeta, %util, limiteDiario, ritmoAtual, projecaoFinal, diferencaProjetada, reducaoNecessariaPorDia; projeção ponderada por dia da semana quando ≥ 8 semanas de histórico, senão linear).

Estados: `on_track | attention | at_risk | exceeded` com mensagens fixas.

## 3. Home — reordenação e refinamento

Ordem final (item 3):
1. `HomeHeader` (único, botões 40×40 padronizados)
2. `HeroDisponivelCard` reescrito → **Disponível hoje** (não desconta fatura), rodapé Patrimônio + "Ver composição" → `PatrimonioSheet`
3. `PeriodPicker` movido para **abaixo** do hero, label "Análise do período"
4. `RitmoCard` (título "Seu ritmo neste período", divisória, único CTA "Ver análise completa")
5. `NextBestActionCard` (novo, substitui `AssistantTipCard`, sem reações/badge)
6. `QuickActions` — Anotar / **Dividir rolê** / Antes de comprar / Mais (remove Guardar)
7. `EvolucaoFinanceiraCard` (novo, integra meta de categoria mais relevante + Pulso secundário)
8. `ProjecaoFimMesCard` (renomeia PrevisaoFechamento, usa `monthToDateAverageConsumption × diasRestantes`, sem duplicar cartão)
9. `EmotionalCheckinCard` (mantém progressive disclosure)
10. BottomTabBar + FAB

`PonteCaixaCard` desmontado da Home; vira `ProjecaoBreakdownSheet` aberto por "Ver cálculo".

Design tokens do item 4 centralizados em `src/index.css` como variáveis `--home-*` (já parcialmente existentes) + padrões de CTA do item 49.

## 4. Metas UI

`src/pages/Metas.tsx`: novo seletor de tipo (Juntar dinheiro / Controlar gasto por categoria). Formulário de categoria com modo (percent/fixed), baseline (padrão média 3m), frequência, preview do limite calculado editável, alertas.

Detalhe da meta: gasto atual, %util, limite diário restante, projeção, estado, CTA "Ajustar".

## 5. Agente / WhatsApp — paridade

Novas tools read-only em `supabase/functions/_shared/agent/tools.ts`:
`get_available_today`, `get_net_worth`, `get_average_daily_consumption`, `get_card_spend`, `get_month_end_projection`, `get_projection_breakdown`, `get_category_goals`, `get_category_goal_status`, `get_financial_highlights`.

Tools de mutação com confirmação: `create_category_spending_goal`, `update_category_spending_goal`, `pause_category_spending_goal`, `cancel_category_spending_goal`.

Todas resolvem `user_id` no servidor (RLS + ownership check) e retornam do mesmo `computeFinancialSnapshot`.

`IntentRouter` reconhece intenções do item 34. `ResponseValidator` já bloqueia números não vindos de tools — mantido.

`FinancialContext360` sempre inclui `snapshot.metrics` quando a intent é analítica/consulta financeira.

## 6. Dicas / Highlights / Próxima ação

`_shared/insights/facts.ts` e `src/lib/insights/fallbacks.ts` reescritos para consumir `FinancialSnapshot` (sem fórmulas próprias). Gatilhos determinísticos do item 39. `NextBestActionCard` usa fila priorizada do item 13, registra candidatos/score/regra em `agent_decisions`.

Rotação com anti-repetição via `sessionStorage` já existente é preservada.

## 7. Invalidação

`src/lib/db/invalidation.ts` — `invalidateFinancialQueries` estendido para invalidar também `["financial-snapshot", user, period]`, metas de categoria e highlights. Todos os fluxos do item 41 (create/edit/delete/import/OCR/WhatsApp/draft confirm/meta CRUD) já chamam essa função — auditar e corrigir os que não chamam.

## 8. Testes (mesma rodada)

Unitários novos:
- `metrics-available-today.test.ts` (contas, fatura não deduzida, ownership)
- `metrics-average-consumption.test.ts` (exclusões, período inclusivo, comparação)
- `metrics-card-spend.test.ts`
- `metrics-projection.test.ts` (dupla contagem cartão, vencimento dentro/fora do mês, negativa/baixa/positiva, ajuste diário)
- `metrics-category-goal.test.ts` (percent, fixed, baselines, projeção linear e por dia da semana, estados)
- `metrics-parity.test.ts` (mesmo input → mesmo output no módulo shared do frontend e do edge)

Integração:
- `agent-metrics-tools.test.ts` — cada tool devolve o mesmo número do snapshot
- `whatsapp-parity.test.ts` — pergunta gera resposta com número idêntico ao Home
- `home-snapshot-invalidation.test.ts` — mutação → snapshot muda sem reload

Meta: suíte completa verde (≥ atual 435 + ~30 novos).

## 9. Segurança

RLS + GRANT na nova tabela. Tools verificam `user_id` do ctx contra `auth.uid()` (nunca do LLM). `ResponseValidator` mantém guardrail anti-alucinação.

## 10. Performance

Um único `useFinancialSnapshot` por render de Home. Cache por `[user, periodKey, today]`. Agent Core memoiza via `TurnContext.once`. Nenhum cálculo financeiro em componente React.

---

### Detalhes técnicos

**Arquivos novos**
- `src/lib/engine/metrics.ts`
- `supabase/functions/_shared/engine/metrics.ts` (mesmo núcleo, imports Deno)
- `src/lib/hooks/useFinancialSnapshot.ts`
- `src/components/home/NextBestActionCard.tsx`
- `src/components/home/EvolucaoFinanceiraCard.tsx`
- `src/components/home/ProjecaoBreakdownSheet.tsx`
- `src/components/metas/CategoryGoalForm.tsx`
- `src/components/metas/CategoryGoalCard.tsx`
- `supabase/migrations/<ts>_category_spending_goals.sql`
- ~10 arquivos de teste

**Arquivos modificados**
- `src/pages/Index.tsx` (nova ordem, hook único)
- `src/components/home/HomeHeader.tsx` (padronização botões)
- `src/components/home/HeroDisponivelCard.tsx` (semântica Disponível hoje)
- `src/components/home/PeriodPicker.tsx` (label + posição)
- `src/components/home/RitmoCard.tsx` (CTA único)
- `src/components/home/QuickActions.tsx` (Divisão substitui Guardar)
- `src/components/home/PrevisaoFechamentoCard.tsx` → renomear para `ProjecaoFimMesCard.tsx`
- Remover uso de `PonteCaixaCard` da Home (mantido só no sheet)
- `src/pages/Metas.tsx` + rotas de detalhe
- `src/lib/db/finance.ts` (CRUD de category_spending_goals + invalidação)
- `src/lib/db/invalidation.ts`
- `src/index.css` (tokens do item 4 e CTAs do item 49)
- `supabase/functions/_shared/agent/tools.ts` (+9 read + 4 write)
- `supabase/functions/_shared/agent/core/FinancialContext360.ts` (branch metrics)
- `supabase/functions/_shared/agent/core/IntentRouter.ts` (intenções item 34)
- `supabase/functions/_shared/insights/facts.ts` (consome snapshot)
- `src/lib/insights/fallbacks.ts` (consome snapshot)

**Deploy pós-implementação**
- Migration `category_spending_goals`
- Edge Functions: `agent-chat`, `agent-run`, `whatsapp-webhook`, `insights-generate`, `pulse-compute`
- Frontend publish

Ao final, relatório com os 30 pontos do item 52.
