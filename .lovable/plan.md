
# Correção definitiva — Metas de controle de gasto por categoria

## 1. Causa-raiz confirmada (verificada no banco e no código)

Banco (`public.category_spending_goals`) da meta de Transporte do usuário:
- `start_date = 2026-07-22` (dia da criação), `end_date = NULL`, `baseline_value = 1000`, `computed_limit = 700`, `frequency = monthly`.

Código (`src/lib/engine/metrics.ts::evaluateCategoryGoal`):
- Define `period.start = max(goal.start_date, mês corrente início)` → 2026-07-22.
- Só soma transações com `occurred_at ≥ 2026-07-22`, ignorando os gastos de 01–21/jul.

Formulário (`CategoryGoalForm.tsx`): não oferece seletor de período; hook `useSaveCategorySpendingGoal` grava sem `start_date/end_date` explícitos e o insert passa `start_date` implícito = hoje (evidência: registro real). Logo:
- **R$ 21,60 gasto** = somente movimentações a partir de 22/jul.
- **Projeção R$ 216,00** = `21,60 / 1 dia × 10 dias`.
- **Status "No ritmo"** = `utilization 0,03 < daysProgress 0,03` (regra atual não trata `spent > limit` do período real e nem “ultrapassada”).

## 2. Regra de negócio oficial (nova)

- Meta mensal padrão = **mês civil corrente** (`start = 1º do mês`, `end = último dia`), incluindo gastos retroativos do mês.
- Meta pode ser: `this_month`, `next_month`, `next_30_days`, `custom`, `monthly_recurring` (com `recurrence_end_date` opcional).
- Timezone: `America/Sao_Paulo` para todas as comparações de dia (usar helpers civis, sem UTC drift).
- `actualSpend` = mesma definição de despesa comportamental usada em relatórios/Home: exclui receita, transferência entre contas próprias, aplicação/resgate/aporte de investimento, pagamento de fatura, itens `deleted_at` ou cancelados, e Divisão do Rolê que não seja a parcela do usuário. Usa **sempre `category_id`**.
- Status obedece prioridade: `paused`/`cancelled` → `scheduled` (hoje<start) → `exceeded` (spent>limit) → `limit_reached` (spent==limit e dias restam) → `completed_ok` / `completed_over` (após end) → `on_risk` (projeção >110% limit) → `attention` (projeção >100%) → `on_track`. Ultrapassada NUNCA vira “No ritmo”.
- `dailyAllowance = max(limit - spent, 0) / max(remainingDays,1)`; zero quando ultrapassada.
- `projectedFinalSpend = actualSpend + currentDailyRate × remainingDays`; nunca menor que `actualSpend`.

## 3. Mudanças

### 3.1 Banco (uma migration)
- `ALTER TABLE public.category_spending_goals` adicionar:
  - `period_type text NOT NULL DEFAULT 'this_month'` (check: this_month, next_month, next_30_days, custom, monthly_recurring)
  - `recurrence_end_date date NULL`
  - `timezone text NOT NULL DEFAULT 'America/Sao_Paulo'`
  - `paused_at timestamptz NULL`, `cancelled_at timestamptz NULL`
  - Tornar `end_date` NOT NULL para metas não recorrentes via CHECK condicional.
- Índice `idx_csg_period (user_id, category_id, start_date, end_date)`.
- Nova tabela `public.category_spending_goal_cycles` (histórico de ciclos recorrentes) com `goal_id, start_date, end_date, baseline_snapshot, target_snapshot, actual_spend, projected_spend, final_status, closed_at`, GRANTs + RLS por `user_id` via join, trigger de fechamento no fim do ciclo.
- **Backfill obrigatório**: para toda meta existente com `start_date` != 1º do mês e `end_date IS NULL`, setar `start_date = date_trunc('month', start_date)` e `end_date = (start_date + interval '1 month - 1 day')`, `period_type='this_month'`. Log de linhas afetadas retornado no relatório final.

### 3.2 Camada central de métricas (fonte única)
`src/lib/engine/metrics.ts` + porta `supabase/functions/_shared/engine/metrics.ts`:
- Novo `evaluateCategoryGoal(goal, txs, today, tz, categoryName)` retornando **exatamente** o contrato exigido: `baselineAmount, targetAmount, actualSpend, remainingAmount, percentageUsed, elapsedDays, remainingDays, currentDailyRate, projectedFinalSpend, projectedDifference, projectedOverage, currentOverage, dailyAllowance, requiredDailyReduction, status, calculationReferenceDate, includedTransactionCount, projectionMethod`.
- Filtro de transações reutiliza `isBehavioralExpense` (mesma função usada por relatórios/`computeMonthlyTotals`) — deduplicada entre app e edge.
- Projeção `weekday_weighted` opcional quando `elapsedDays ≥ 14`, senão `linear`.
- Nova função `resolveGoalPeriod(goal, today, tz)` — resolve start/end respeitando `period_type` e ciclo corrente para `monthly_recurring`.

### 3.3 Formulário `CategoryGoalForm.tsx`
Reordenar conforme spec (Categoria → Como definir → Base → Valor base → % ou limite → Limite calculado → **Período da meta** → Frequência → Prévia → Alertas → Ações).
- Seletor de período com chips: Este mês (default), Próximo mês, Próximos 30 dias, Personalizado, Mensal recorrente.
- Datas via `Popover + Calendar` do shadcn (com `pointer-events-auto`).
- Bloco “Prévia da meta” com cálculo em tempo real via `evaluateCategoryGoal` sobre o período selecionado, mostrando quanto já foi gasto e situação.
- Inputs 16px, altura 48–54, radius 14, modal `max-w-[640px] max-h-[90dvh]` com scroll interno e safe-area.

### 3.4 Card `CategoryGoalCard.tsx`
- Header: nome categoria + pill de status com cores do design system.
- Linha secundária: “1–31 jul · Redução de 30%”.
- Barra: cor por status; permite renderização visual até 100% mas mostra % real ao lado; cor de risco quando > 100%.
- Bloco principal condicional por status (mensagens da spec 17.x/18).
- Ações: Editar / Pausar-Retomar / Excluir + link “Ver gastos considerados” → `/app/lancamentos?category=<id>&start=<>&end=<>`.

### 3.5 Página `src/pages/Lancamentos.tsx`
- Ler query params `category`, `start`, `end` no mount e aplicar como filtros iniciais persistindo em `periodStore` sobreposto.

### 3.6 Home (`EvolucaoFinanceiraCard.tsx`)
- Consumir `useFinancialSnapshot` já existente que passa a receber os novos contratos.
- Priorizar meta: ultrapassada > em risco > atenção > mais próxima do limite > progresso positivo > Pulso.
- Mensagens conforme spec 22.

### 3.7 Agente (`_shared/agent/tools.ts` + `FinancialContext360.ts`)
- `list_category_spending_goals` retorna o snapshot completo por meta usando a mesma engine.
- Nova tool opcional `get_category_goal(goal_id | category_name)` para respostas específicas.
- Prompt do agente ganha bloco `[METAS DE CATEGORIA]` com números formatados; **proibido** recalcular via LLM.

### 3.8 Dicas/Highlights/Próxima ação
- `_shared/insights/facts.ts` e `src/lib/insights/fallbacks.ts` ganham sinais `goal_exceeded`, `goal_at_risk`, `goal_on_track_finish` com os textos da spec 25.
- Próxima melhor ação em `AssistantTipCard.tsx` ordenada com meta ultrapassada acima de dicas comportamentais gerais (abaixo de integridade e risco de saldo).

### 3.9 Invalidação
- `src/lib/db/invalidation.ts::invalidateFinancialQueries` já invalida transações — adicionar chave `category_spending_goals` e `financial_snapshot`. Todas as mutações listadas na spec 27 usam esse helper.

## 4. Testes (obrigatórios)

Novo arquivo `src/test/category-goals-metrics.test.ts` cobrindo cada caso das seções 31/32/33, incluindo o **teste de regressão exato**:
- Transporte, período 01–31 jul, base R$ 1.000, redução 30%, limite R$ 700, criação em 22/jul, gastos reais R$ 1.042,60 → `actualSpend = 1042.60`, `status = 'exceeded'`, `currentOverage = 342.60`, `dailyAllowance = 0`, projeção ≥ 1042,60, sem “No ritmo”.

Ajustar `src/test/facts-*` e edge tests para novo contrato. Rodar `bunx vitest run` (target ≥ 435 pass, incluindo novos).

## 5. Detalhes técnicos

```text
DB
 └─ ALTER category_spending_goals + backfill + cycles
Engine (app + edge, mesma lógica)
 └─ resolveGoalPeriod + evaluateCategoryGoal (contrato completo)
UI
 ├─ CategoryGoalForm (período + prévia)
 ├─ CategoryGoalCard (status + deep link)
 ├─ Metas.tsx (usa novo eval)
 ├─ Lancamentos.tsx (query params)
 └─ EvolucaoFinanceiraCard/AssistantTipCard (priorização)
Agente
 └─ list_category_spending_goals + prompt block
Invalidação
 └─ invalidateFinancialQueries inclui category_spending_goals
```

Todos os cálculos permanecem determinísticos e no servidor/engine; LLM só narra.

## 6. Entrega

- Migration + backfill;
- Engine unificada app/edge;
- UI redesenhada de formulário e card;
- Deep link em lançamentos;
- Home, agente App/WhatsApp, dicas, highlights e próxima ação alinhados;
- Testes unitários + regressão do caso real Transporte;
- Deploy das edge functions `agent-chat`, `agent-run`, `whatsapp-webhook`, `insights-generate`;
- Relatório final com causa-raiz, contagem de metas migradas e paridade validada.
