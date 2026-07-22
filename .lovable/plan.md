## Objetivo

Substituir a Home atual por uma experiência mais compacta, hierarquizada e acionável, seguindo o protótipo aprovado, mas conectada aos dados reais, hooks, engine financeiro (`src/lib/engine/facts.ts`), Pulso, Ponte de Caixa, dicas, check-in emocional, Divisão do Rolê e sistema de ocultação de valores já existentes. Nenhuma regra financeira é reescrita — apenas reorganizada, reutilizada e complementada onde necessário.

## Princípios que guiam a entrega

- Reutilizar a fonte única de verdade (`computeNetWorth`, `computeAccountStatementTotals`, `isRealMonthlyMovement`, `computeBehavioralExpense`, `computeCreditCardOutstanding`, `usePulse`, `AssistantTipCard`, `PonteCaixaCard`, `EmotionalCheckinCard`).
- Não alterar Agent Core, agente, WhatsApp, RLS, permissões, migrations financeiras ou fórmula do Pulso.
- Progressive disclosure: bottom sheets para composição do patrimônio, detalhes do gasto médio, mais ações, Pulso expandido e assessor.
- `PrivacyModeContext` já ocultará todos os valores via `formatPrivateBRL` — manter.
- Nenhum dado fictício; nenhum card estático.

## Nova ordem visual da Home (mobile-first)

1. Cabeçalho compacto (saudação, subtítulo, olho de privacidade, sino).
2. Chip "Resumo financeiro · <intervalo humano>" que abre bottom sheet de período.
3. **Card principal**: "Disponível até o fim do mês/período" + linha secundária "Patrimônio total" + botão "Ver composição".
4. Grid 2 colunas compactas: **Gasto médio/dia** | **Gastos no cartão** (cada um com variação vs. mesmo intervalo deslocado e ação "Ver detalhes"/"Ver cartões").
5. **Próxima melhor ação** (uma só, com "Fazer agora" e "Agora não").
6. **Ações rápidas** (Anotar gasto, Guardar para meta, Antes de comprar, Mais ações).
7. **Sua evolução financeira** (Pulso compacto expansível).
8. **Ponte de Caixa** compacta (saldo inicial + entradas − saídas = saldo final, fechando).
9. **Check-in emocional** minimalista (só chips, expande após seleção).
10. Botão flutuante do assessor com opções "No app" / "WhatsApp" (remove `WhatsAppCta` e duplicações).

Navegação inferior: **Início · Movimentos · Metas · Mais** (remove duplicação de "Antes de comprar" do bottom bar). `AssessorFab` já existe — apenas ajustar ação para abrir bottom sheet com dois destinos.

## Novos componentes (`src/components/home/`)

- `HomeHeader.tsx` — saudação, subtítulo, toggle privacidade, sino.
- `PeriodChip.tsx` + `PeriodSheet.tsx` — chip compacto e bottom sheet (Este mês, Últimos 7 dias, Mês anterior, Personalizado); persiste via `periodStore`.
- `DisponivelCard.tsx` — card principal; abre `PatrimonioSheet.tsx` para composição.
- `PatrimonioSheet.tsx` — detalhamento (contas, investimentos, cartões, dívidas) usando os mesmos números de `computeNetWorth`.
- `GastoCartaoCard.tsx` — par visual do `GastoMedioDiarioCard` (já reformulado abaixo).
- `ProximaAcaoCard.tsx` — leitura priorizada de dicas.
- `AcoesRapidasGrid.tsx` — 4 ações fixas + `MaisAcoesSheet.tsx`.
- `EvolucaoPulsoCard.tsx` — wrapper compacto sobre `usePulse` com expansão progressiva.
- `AssessorActionSheet.tsx` — bottom sheet acionado pelo `AssessorFab`.

Componentes existentes reaproveitados/adaptados: `GastoMedioDiarioCard`, `PonteCaixaCard`, `EmotionalCheckinCard`, `AssistantTipCard` (reusado internamente pelo `ProximaAcaoCard`), `AssessorFab`, `NotificationBell`.

Removidos da Home (mantidos no restante do app): `WhatsAppCta`, `PatrimonioCard` grande, `PulseHero` grande, `ParaPagarResumo`/`AReceberRoleResumo` (migram para `MaisAcoesSheet`), atalhos duplicados de Divisão do Rolê/Relatórios (vão para "Mais ações").

## Fórmulas (todas reutilizando o engine, sem paralelismo)

### Disponível até o fim do período
`disponivel = saldoContasTransacionais + receitasFuturasConfirmadas(period) − despesasFuturasConfirmadas(period) − próximasRecorrências(period) − faturasCartaoComVencimentoNoPeriodo − outrasObrigacoesConhecidas`
- Base: `computeAccountBalances` (saldo atual real).
- Futuros: `nextRecurringOccurrences` + transações `status='planned'` dentro do período (via `computeUpcomingCommitments`).
- Fatura: `computeCreditCardOutstandingByCard` cruzado com `due_day` de cada cartão dentro do período — evita dupla contagem pois despesas de cartão já não afetam saldo em conta (`txOrigin==='credit_card'`).
- Investimentos: ignorados (não consumíveis).
Nova função pura `computeAvailableUntil(range, {accounts, txs, snapshots, recurring, cards})` em `src/lib/engine/facts.ts` composta 100% pelas funções existentes; testada em `src/test/facts-available-until.test.ts`.

### Gasto médio/dia
Reutiliza `computeAverageDailySpending` (`src/lib/engine/dailyAverage.ts`) — já implementa dias inclusivos, corte pelo dia atual, exclusão de transferências/investimentos/estornos duplicados, comparação com mesmo intervalo deslocado com ajuste para meses curtos. Já coberto por `src/test/daily-average.test.ts`. Ampliar testes para Divisão do Rolê e cancelados.

### Gastos no cartão
Somatório de `type='expense' AND status='confirmed' AND txOrigin==='credit_card'` com `occurred_at` dentro do período efetivo (data econômica, nunca vencimento), excluindo `settles_card_id` e `movement_kind∈EXCLUDED_MOVEMENT_KINDS`. Comparação com mesmo intervalo deslocado, mesma lógica do gasto médio. Testes em `src/test/facts-card-spending.test.ts`.

### Ponte de Caixa
`saldoInicial + entradasReais − saidasReais = saldoFinal` via `computeAccountStatementTotals` (já exclui transferências internas e usa `isGrossAccountMovement`). O ajuste, quando existir, aparece como linha explícita "Ajustes de conciliação".

### Patrimônio
`computeNetWorth` inalterado — mesmo número no card e no detalhamento.

### Próxima melhor ação
Reutiliza pipeline atual (`AssistantTipCard`/`user_insights`). Aplica ordem: integridade > vencidos > risco imediato > meta em risco > gasto anormal > economia > educativo > informativo. Dispensa persiste em `sessionStorage` (`nc:next-action:dismissed`) e chama a mesma invalidação usada hoje.

## Sincronização de dados

- Um único `useHomeData(period)` hook agregando `useAccounts`, `useAllTransactions`, `useAccountBalanceSnapshots`, `useGoals`, `useInvestments`, `useDebts`, cartões e recorrências — evita N+1 e mantém memoização por período.
- Após qualquer mutação, chamar `invalidateFinancialQueries(queryClient)` (já existe em `src/lib/db/invalidation.ts`) — todos os cards reagem sem reload.
- Sem chamadas ao LLM ao abrir a Home; dicas vêm de `user_insights`.

## Estados de UI

Skeletons com dimensões estáveis por card; erro isolado por seção com botão "Tentar novamente"; primeira utilização mantém `ComecePorAqui`; período sem dados exibe copy amigável; nunca renderizar `NaN`/`Infinity`.

## Responsividade e acessibilidade

- `overflow-x-hidden` global mantido; grid 2 col apenas quando `sm+`.
- Inputs de data com `min-w-0` e wrapper `flex-1`.
- Bottom sheets usando `Sheet` do shadcn com `side="bottom"`, respeitando safe area (`pb-[env(safe-area-inset-bottom)]`).
- `aria-label` em ícones; setas de variação sempre acompanhadas de texto ("31,3% menor…"); foco visível; fechamento por Esc.
- `AssessorFab` continua acima do bottom bar; z-index mantido.

## Testes

- `src/test/facts-available-until.test.ts` — cenários: sem futuros, com recorrência, com fatura dentro/fora, sem cartão, período personalizado, evitar dupla contagem fatura, valores negativos.
- `src/test/facts-card-spending.test.ts` — total, exclusão de fatura, estornos, comparação mês anterior, base zero.
- `src/test/daily-average.test.ts` — adicionar casos Divisão do Rolê, refund, estabilidade <1%.
- `src/test/home-next-action.test.tsx` — priorização, dispensa, substituição, ausência de repetição.
- `src/test/home-period-sync.test.tsx` — mudar período atualiza todos os cards.
- `src/test/home-render.test.tsx` — ordem visual, ausência de banner WhatsApp, botão flutuante único.
- Rodar `bunx vitest run` inteiro; typecheck; build.

## Restrições respeitadas

Nada é removido do produto — apenas realocado (WhatsApp CTA → sheet do assessor; Divisão/Relatórios → "Mais ações"). Fórmulas, Pulso, agente, RLS, migrations e Ponte de Caixa permanecem como fonte única de verdade. Sem novas migrations, sem alterar Edge Functions.

## Entrega final

Resumo, arquivos criados/modificados, fórmulas exatas, testes adicionados e contagem final de testes verdes — tudo em uma única rodada de implementação após aprovação.