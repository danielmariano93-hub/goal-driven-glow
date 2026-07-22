## Objetivo
Adicionar na Home o card **"Gasto médio por dia"** com comparação vs. o mesmo intervalo do mês anterior, reutilizando a fonte de verdade de despesas comportamentais do produto e reagindo ao filtro de período existente.

## Fonte de verdade (sem duplicar lógica)
Reusar `isRealMonthlyMovement` de `src/lib/engine/facts.ts` — já exclui:
- `type='transfer'` (transferências entre contas próprias);
- `movement_kind` de investimento (`investment_application`, `investment_redemption`, `investment_yield`), `internal_transfer`, `loan_proceeds`;
- pagamentos de fatura (`settles_card_id` ≠ null) → evita dupla contagem cartão vs. fatura;
- lançamentos não `confirmed` (cobre cancelled/deleted/planned);
- `refund` entra abatendo despesa (mesma regra de `computeMonthlyTotals`).

Isso significa: a compra no cartão conta como despesa comportamental; o pagamento da fatura não. Divisão do Rolê já grava só a parcela final do usuário como transação normal, herdando a mesma regra.

## Alterações
1. **`src/lib/engine/facts.ts`** — nova função pura `computeBehavioralExpense(txs, { start, end })` que aplica `isRealMonthlyMovement` a lançamentos com `occurred_at` no intervalo inclusivo `[start, end]`, tratando `refund` como negativo e clampeando em 0.
2. **`src/lib/engine/dailyAverage.ts`** (novo) — utilitários puros:
   - `daysInclusive(start, end)` (parse local YYYY-MM-DD, sem UTC drift);
   - `shiftRangePrevMonth({start, end})` — desloca 1 mês com clamp seguro para último dia válido (ex.: 31/mar → 28 ou 29/fev);
   - `computeDailyAverage(txs, range)` → `{ total, days, avg }`;
   - `computeDailyAverageComparison(txs, range)` → `{ current, previous, deltaPct | null, trend: 'up'|'down'|'stable', prevRange }` com `deltaPct=null` quando previous.avg=0 e stable quando |deltaPct|<1%.
3. **`src/components/home/GastoMedioDiarioCard.tsx`** (novo) — card mobile-first no mesmo padrão visual dos demais (`rounded-2xl border bg-card shadow-card`, tokens do design system, sem cor sólida como único sinal). Mostra título, valor `formatBRL(avg)`, chip de variação (ícone `ArrowDown`/`ArrowUp`/`Minus` + texto + `aria-label`), rótulo do intervalo comparado (`1–21 jun.` via `Intl.DateTimeFormat pt-BR`) e mensagem de apoio curta. Toque/clique abre `<details>` inline com total, dias e média de cada período + diferença R$/dia. Trata estados: sem despesas atuais, sem base anterior, ambos zerados, loading (skeleton), único dia.
4. **`src/pages/Index.tsx`** — importar o novo card e montar entre `PatrimonioCard` e `PulseHero` (hierarquia solicitada), passando `txs`, `loading`, e `{start, end}` já derivados do `periodSummary` (mesmo período do filtro persistido em `periodStore`). Nada mais muda na página.
5. **Invalidação** — já coberto por `invalidateFinancialQueries` (chave `["transactions"]`), que roda em criar/editar/excluir/importar/agente/WhatsApp. O card usa o mesmo `useAllTransactions()` já buscado pela Home, então recalcula sozinho via `useMemo`.
6. **Testes** — novo `src/test/daily-average.test.ts` cobrindo:
   - dias corridos inclusivos (mesmo dia = 1, 10→11 = 2);
   - exclusão de transfer, investment_application, pagamento de fatura (settles_card_id), refund abatendo;
   - deslocamento 31/mar → 28/fev (não bissexto) e 29/fev (bissexto);
   - variação positiva, negativa, estável (<1%), previous=0 → `deltaPct=null`, ambos zerados;
   - período de um dia; range invertido retorna days=0 e avg=0 sem divisão por zero;
   - futuro: valores contados até `end` literal (o filtro da Home já não permite fim > hoje via `max`).
   E `home-daily-average.test.tsx` de componente: renderiza estados vazio/comparação indisponível/queda/alta com ícone+texto (a11y).

## Performance e segurança
- Zero query nova: reusa `useAllTransactions` já em cache.
- Cálculo O(n) sobre o array já carregado, dentro de `useMemo`.
- Sem alteração de RLS/backend; nada é enviado ao servidor.

## Fora de escopo
Agent Core, WhatsApp, migrations, redesign da Home, novos endpoints.

## Aceite
Card visível na Home reagindo ao filtro; comparação correta com clamp de fim de mês; sem dupla contagem cartão/fatura; estados especiais tratados; a11y (ícone+texto, não só cor); `tsgo` + `bunx vitest run` verdes (incluindo os dois novos arquivos) antes de encerrar.
