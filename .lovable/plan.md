# Home mais limpa + informação densa nos Relatórios

Objetivo: reduzir poluição visual. A Home responde só 3 perguntas ("quanto tenho hoje", "estou no ritmo", "o que fazer agora"). Todo detalhamento contábil vive em Relatórios / Relatórios Inteligentes.

## 1. Remover da Home
Em `src/pages/Index.tsx`:
- Remover o bloco `RoutineBlock` ("Como foi sua rotina financeira").
- Remover `PonteCaixaCard` ("Como seu saldo mudou").
- Remover o cálculo/props que só serviam a eles e o texto auxiliar duplicado sobre período.
Os componentes continuam existindo (`FinanceBlocks.tsx`, `PonteCaixaCard.tsx`) porque Relatórios os usa — nada é apagado do motor.

## 2. Consolidar o que sobra (ordem final da Home)
1. `HomeHeader`
2. `PeriodPicker` (com o range já no próprio componente, sem parágrafo extra embaixo)
3. `HeroDisponivelCard` — "Disponível hoje" (patrimônio continua no sheet, em toque)
4. **Card único de ritmo**: fundir `RitmoCard` + `RitmoGastosCard` num só card "Seu ritmo", com o número grande (R$/dia), o badge de variação e o gráfico compacto abaixo. Detalhes secundários (estornos, exclusões, comparativo do cartão) passam a ficar num "ver detalhes" recolhido — não visíveis por padrão.
5. `AssistantTipCard` (carrossel de dicas — 1 por vez)
6. `QuickActions`
7. `SharedGoalHighlight` (só quando existir)
8. `PrevisaoFechamentoCard` ou `ComecePorAqui`
9. `EmotionalCheckinCard`

Fica um card por pergunta, com no máximo 1 número protagonista + 1 comparação por card.

## 3. Link de continuidade
No rodapé do card de ritmo e na Previsão, uma linha discreta "Ver rotina e como o saldo mudou →" apontando para `/app/relatorios`, para o usuário não perder o acesso à informação retirada.

## 4. Relatórios (destino da informação)
`src/pages/Relatorios.tsx` já monta `PositionBlock`, `RoutineBlock`, `CashBridgeBlock`, `PatrimonialBlock` e os `MonthCard` expansíveis. Ajustes de legibilidade:
- Agrupar a página em 3 seções com títulos claros: **Onde estou**, **Como foi minha rotina**, **Como o saldo mudou** (histórico mensal).
- Manter tudo colapsado por padrão, expandindo apenas a seção "Onde estou".
- Em `FinanceBlocks.tsx`, reduzir densidade: máximo 4 linhas visíveis por bloco, o resto atrás de "ver tudo"; padronizar tipografia (rótulo 10px uppercase, valor 13–14px) e usar tokens semânticos.

## 5. Detalhes técnicos
- Somente frontend/apresentação: `src/pages/Index.tsx`, novo `src/components/home/RitmoUnificadoCard.tsx` (ou refactor de `RitmoCard` recebendo a série), `src/components/finance/FinanceBlocks.tsx`, `src/pages/Relatorios.tsx`.
- Nenhuma alteração em `bridges.ts`, `metrics.ts`, hooks, banco, RPCs ou Edge Functions — a verdade financeira `finance_contract.v4` fica intacta.
- `useFinancialSnapshot` continua igual; a Home apenas deixa de renderizar campos.
- Rodar testes + build; sem migration, sem deploy, sem publicar (publicação só com sua autorização).
