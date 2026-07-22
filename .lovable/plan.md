# Correção estrutural da Home — hierarquia aprovada

Reescrita cirúrgica de `src/pages/Index.tsx` para eliminar duplicações, aplicar o Design System oficial e cumprir a ordem/altura/hierarquia definidas. Sem novos componentes fora do escopo, sem alterar telas, engines financeiros nem Agent Core.

## 1. Escopo da mudança

**Arquivo principal reescrito**
- `src/pages/Index.tsx` — renderização enxuta na ordem exata.

**Componentes novos (mínimos, só o necessário)**
- `src/components/home/HomeHeader.tsx` — saudação + botões olho/sino.
- `src/components/home/PeriodPicker.tsx` — pill "Resumo financeiro · 1–22 de julho" que abre bottom sheet (Sheet do shadcn) com Este mês / Últimos 7 dias / Mês anterior / Personalizado. Persiste em `periodStore`.
- `src/components/home/HeroDisponivelCard.tsx` — card principal escuro em degradê (substitui `DisponivelCard` na Home; inclui patrimônio total secundário + botão "Ver composição" que abre bottom sheet com a composição atual do `PatrimonioCard`).
- `src/components/home/MetricTile.tsx` — tile compacto reutilizado por Gasto médio/dia e Cartão (badge de variação, "Ver detalhes"/"Ver cartões"). Substitui `GastoMedioDiarioCard` e `GastoCartaoCard` no layout.
- `src/components/home/QuickActions.tsx` — reescrito para 4 colunas: Anotar gasto, Guardar para meta, Antes de comprar, Mais ações.
- `src/components/home/PulseCollapsed.tsx` — versão recolhida do Pulso (score + classificação + tendência + expandir). Reaproveita dados de `usePulse`.
- `src/components/home/PatrimonioSheet.tsx` — bottom sheet com detalhamento atual (reaproveita cálculo já feito por `computeNetWorth`).

**Componentes existentes reaproveitados sem alteração**
- `PonteCaixaCard` (compacto, mantido).
- `EmotionalCheckinCard` (já tem progressive disclosure).
- `AssessorFab` (único acesso permanente ao assessor).
- `BottomTabBar` (já é Início / Movimentos / Metas / Mais — apenas confirmar).

**Removidos da Home (não do produto)**
- `AssistantTipCard` (dica genérica) → substituído por bloco "Sua próxima melhor ação" inline baseado na mesma fonte (`useQuery(["assistant-tip"])`), renderizando apenas um cartão com CTA primário + "Agora não".
- `PatrimonioCard` grande (movido para bottom sheet).
- Atalho "Antes de comprar" como card separado (vira ação rápida).
- `HomeShortcut` Divisão do Rolê / Relatórios (movidos para "Mais ações").
- `ParaPagarResumo`, `AReceberRoleResumo` (removidos da Home; continuam nas telas próprias).
- `WhatsAppCta` banner (removido; acesso permanece via FAB do assessor).
- `PulseHero` grande (substituído por `PulseCollapsed`).
- Link "Ver tudo que dá pra fazer aqui" (removido).

## 2. Ordem final da Home

```text
1. HomeHeader           (compacto, ~56px)
2. PeriodPicker         (pill ~52px)
3. HeroDisponivelCard   (degradê escuro, ~190px, inclui patrimônio secundário)
4. Grid 2 col: MetricTile "Gasto médio/dia" | MetricTile "Cartão"
5. Próxima melhor ação  (card branco, 1 recomendação, CTA pill escuro)
6. QuickActions         (4 colunas)
7. PulseCollapsed       (recolhido, expande on demand)
8. PonteCaixaCard       (compacto existente)
9. EmotionalCheckinCard (recolhido existente)
— fora do fluxo: BottomTabBar + AssessorFab
```

## 3. Design System aplicado

Tokens adicionados/ajustados em `src/index.css` (HSL) e `tailwind.config.ts`:
- `--background` #F6F6FB, `--card` #FFFFFF, `--muted` #F1EFF8, `--foreground` #171420, `--muted-foreground` #6F6A79, `--border` #E6E3EC.
- `--primary` #5B2BE0, `--primary-2` #7A3FF2, `--navy` #21124B, `--pink` #F05D85.
- `--success` #0F9F72 + `--success-soft` #E9F8F2; `--destructive` #D64D67 + `--destructive-soft` #FFF0F3; `--warning` #A66B00 + `--warning-soft` #FFF7DF.
- `--gradient-hero` = `linear-gradient(135deg,#1D1048 0%,#5D2AE8 55%,#F05D85 128%)`.
- Sombras: `--shadow-card` `0 8px 24px rgba(38,24,62,.05)`, `--shadow-hero` `0 18px 35px rgba(71,36,155,.22)`.
- Raios: hero 24px, card 18px, controle 14px, pill 999px.
- Padding horizontal da página 16px; gap entre seções 14–18px.

Só edito tokens usados; não redesenho o resto do app.

## 4. Regras de cálculo

Reaproveitam engines existentes — sem nova regra paralela:
- **Disponível**: `computeAvailableUntil` (já existente, sem mudança).
- **Patrimônio secundário no hero**: `computeNetWorth().net` (já usado hoje).
- **Gasto médio/dia + comparação**: `computeDailyAverageComparison` do `src/lib/engine/dailyAverage.ts` (já exclui transferências/aportes; retorna `trend` e `deltaPct`). Comparação usa mesmo intervalo do mês anterior. Zero anterior → "Sem base de comparação"; ambos zero → "Ainda não há dados suficientes"; |Δ|<1% → "Estável".
- **Cartão no período**: `computeCardSpendingComparison` já existente; mesmas regras de fallback.
- **Ponte de caixa**: `computeAccountStatementTotals` (mantido).
- Todos os cards leem o mesmo `periodStore`, logo respondem juntos ao PeriodPicker.

## 5. Sincronização e estados

- Continua usando os hooks `useAccounts/useAllTransactions/...` já reativos via React Query. Nenhuma nova query duplicada.
- Loading: cada tile mostra skeleton com a altura final (evita layout shift). Não renderiza "R$ 0" antes de dados.
- Vazio: `ComecePorAqui` continua sendo o fallback quando não há conta/lançamento/meta.
- Erro por card isolado com try/catch de render + botão "Tentar de novo" onde aplicável.

## 6. Responsividade e acessibilidade

- Container `max-w-md mx-auto px-4` no mobile; `md:max-w-2xl` mantém desktop.
- Grid tiles `grid-cols-2 gap-2.5`; valores com `tabular-nums` e `text-[clamp(1.25rem,5vw,1.5rem)]` para evitar corte em 320px.
- Inputs do bottom sheet com `text-base` (16px) para não disparar zoom no iOS. Safe-area preservada no FAB e BottomTabBar (já existente).
- `aria-label` nos botões de ícone; foco visível via `focus-visible:ring`; badges com ícone + texto (não dependem só de cor); `prefers-reduced-motion` respeitado nas transições do Pulso/Check-in.

## 7. Testes

- Novo `src/test/home-layout.test.tsx`: verifica ordem dos blocos, ausência de `PatrimonioCard` inline, ausência do banner WhatsApp, ausência dos atalhos Relatórios/Divisão, presença de exatamente 4 quick actions, Pulso e Check-in recolhidos por padrão.
- Reaproveita `daily-average.test.ts`, `facts-available-until.test.ts`, `facts-statement-totals.test.ts` (sem alteração).
- Executa `bun run test` completo + typecheck + build.

## 8. Fora de escopo (explicitamente)

Sem mudanças em: Agent Core, WhatsApp, `engine/facts.ts`, `dailyAverage.ts`, telas de Movimentos/Metas/Relatórios/Divisão/Assessor, tokens não usados pela Home, migrations, edge functions.
