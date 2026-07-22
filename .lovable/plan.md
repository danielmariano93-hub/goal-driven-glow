
# Refinamento Premium da Home — UI/UX cirúrgico

Objetivo: preservar 100% da lógica (queries, engines, hooks, RLS, cálculos, Agent, WhatsApp) e reescrever apenas a camada visual/composicional da Home, entregando uma experiência premium, compacta e hierarquizada.

## 1. Tokens (src/index.css + tailwind.config.ts)

Adicionar tokens dedicados da Home, sem quebrar tokens existentes:

- `--bg-app: #F7F7FA`, `--surface: #FFFFFF`, `--surface-soft: #F3F1F7`, `--surface-neutral: #F2F0F5`.
- `--text-1: #171420`, `--text-2: #706B79`, `--text-3: #97919F`.
- `--hairline: rgba(33,18,75,.09)`, `--hairline-strong: rgba(33,18,75,.14)`.
- `--brand-ink: #21124B`, `--brand-violet: #5B2BE0`, `--brand-violet-2: #7450DB`, `--brand-pink: #C957A5`.
- `--pos: #168A67`, `--pos-bg: #EAF7F2`, `--neg: #C94F67`, `--neg-bg: #FFF0F3`, `--neutral-bg: #F2F0F5`.
- `--gradient-hero` refeito: `linear-gradient(135deg,#17102F 0%,#2B175F 42%,#5B2BE0 82%,#A849C8 115%)` + luz radial `radial-gradient(circle at 88% 16%, rgba(255,255,255,.14), transparent 24%)`.
- `--gradient-fab: linear-gradient(145deg,#5B2BE0,#7A3FF2 62%,#C957A5)`.
- `--shadow-hero: 0 18px 40px rgba(38,20,89,.20)`; `--shadow-soft: 0 8px 24px rgba(32,22,48,.045)`; remover sombra dos cards de ritmo/evolução/fechamento.
- Ajustar `bg-background` para `--bg-app` (só na Home, via classe) — sem alterar o token global se afetar outras telas; usar wrapper `data-surface="home"` em `src/pages/Index.tsx`.

## 2. Remover cabeçalho duplicado (src/components/AppLayout.tsx)

- Remover a barra superior renderizada no AppLayout (saudação + olho + sino + sair). Passa a existir **apenas** o `HomeHeader` na Home e cabeçalhos próprios em cada rota.
- Mover o botão **Sair** para a página `Mais` (`src/pages/MaisMenu.tsx`) como item de lista, evitando exposição duplicada.
- Outras rotas que dependiam do olho global: incluir controle de privacidade no cabeçalho de cada rota principal quando aplicável (mínimo Home; demais rotas continuam funcionais via preferência persistida — nenhuma mudança de lógica). Para esta entrega, adicionar um cabeçalho simples com olho+sino nas rotas que hoje não têm — reaproveitando o padrão do `HomeHeader` num componente `PageHeaderTop` reutilizável em `src/components/PageHeaderTop.tsx` (mínimo: Home usa HomeHeader; demais herdam PageHeaderTop). Não altera comportamento.

## 3. HomeHeader (src/components/home/HomeHeader.tsx)

- Altura ~54px, sem borda inferior.
- Saudação 12px/500 `text-2`; título 20px/720 `-0.02em` `text-1`.
- Botões olho e sino: 36px, sem borda, hover `--surface-soft`.

## 4. PeriodPicker

- Altura 50px, radius 14px, `border: 1px solid var(--hairline)`, sem sombra.
- Ícone 14px em círculo sutil `--surface-soft`, chevron 14px `--text-3`.
- Label "Resumo financeiro" `text-2` 11px; valor 14px/600 `text-1`.

## 5. Card principal (HeroDisponivelCard)

- Radius 24, padding 18–20, altura 165–185, `--gradient-hero` + luz radial.
- Label `DISPONÍVEL ATÉ O FIM DO MÊS` 10px/700 tracking .14em, `rgba(255,255,255,.72)`.
- Valor 34px/800 tabular, tracking -0.035em.
- Subtexto 12px `rgba(255,255,255,.78)` truncado em 1 linha.
- Rodapé com `border-top rgba(255,255,255,.16)`, "Patrimônio total" 10px + valor 15px/700, botão "Ver composição" pill 34px, `bg-white/12 border-white/28`, sem sombra.
- Remover glow lateral atual (blur-3xl branco) — substituído pelo radial nos tokens.

## 6. Superfície única "Seu ritmo neste período" (novo componente `RitmoCard.tsx`)

Substitui os dois `MetricTile` atuais. Mantém uso de `computeDailyAverageComparison` e `computeCardSpendingComparison` (nenhum cálculo alterado).

Estrutura:
```
[label] SEU RITMO NESTE PERÍODO
[col1] Gasto médio        │  [col2] Cartão
       R$ X/dia           │         R$ X
       ↓31,3% Menor        │         ↑8,4% Acima
                    ─ hairline ─
                    Ver análise completa →
```

- Superfície branca única, radius 18, `border 1px --hairline`, `shadow-soft`, altura 135–155.
- Divisória vertical `1px --hairline` de 60% da altura.
- Valores 22px/780 tabular; label 10px/700 tracking .14em `text-3`; badge pill 10px com fundo `--pos-bg/--neg-bg/--neutral-bg` e cor correspondente; subtexto 11px `text-2` truncado em 1 linha ("Menor que antes" / "Acima do anterior" / "Estável" / "Sem comparação").
- Coluna clicável (abre `/app/relatorios` para gasto médio; `/app/cartoes` para cartão). Ação inferior única "Ver análise completa" → `/app/relatorios`.
- Remove `MetricTile.tsx`, `GastoMedioDiarioCard.tsx`, `GastoCartaoCard.tsx` do DOM (arquivos ficam apenas se ainda referenciados por testes — checar e remover imports mortos).

## 7. Próxima melhor ação (AssistantTipCard)

Refino visual sem alterar lógica de dados/insights:

- Compactar para 100–125px. Superfície `--surface`, radius 18, `border --hairline`, sem sombra.
- Ocultar do estado padrão: ThumbsUp/ThumbsDown, badge "Nova", RefreshCw, menu.
- Estrutura: label "SUA PRÓXIMA MELHOR AÇÃO" 10px/700 tracking .14em `text-3`; título 14px/700; descrição 12px `text-2` em `line-clamp-2`; CTA principal pill 36–40px `bg:#21124B text:white`; "Agora não" botão texto discreto 12px/600 `text-2`.
- Feedback (like/dislike) movido para menu "…" oculto acessível via long-press ou botão sutil apenas quando insight está expandido. Manter handlers atuais.

## 8. Ações rápidas (QuickActions)

- Remover 4 minicards com borda/sombra. Nova estrutura: linha de 4 colunas dentro da própria página (sem card externo).
- Cada ação: círculo 44px `bg #F1EFF8`, ícone 20px `#5B2BE0`, label 11px/500 `text-1` abaixo. Sem borda, sem sombra, sem fundo branco. Área clicável 48×64 mínimo.
- Altura total 90–100px.

## 9. Evolução financeira (PulseHero)

- Renomear rótulo visível para "Evolução financeira" (manter dados do Pulso).
- Estado inicial recolhido, 80–100px: número grande à esquerda (32px/800), à direita título "Evolução financeira" + estado ("Organizando"/"Consistente"…) e delta preferindo "+4 pontos" sobre "Estável" quando `data.week_delta != 0`. Uma frase de 1 linha derivada do fator mais fraco.
- Link "Ver evolução" 12px `--brand-violet`.
- Superfície branca leve, `border --hairline`, sem sombra forte. Detalhamento (fatores/barras) apenas após expandir (mantém `open`).

## 10. Previsão de fechamento (substitui PonteCaixaCard visual)

Novo componente `PrevisaoFechamentoCard.tsx` — reaproveita `income`, `expense`, `closing` já calculados em `Index.tsx` (nenhum recálculo).

Estrutura (altura 115–145):
```
PREVISÃO DE FECHAMENTO
Seu mês deve fechar em
R$ 2.677,20
R$ 13.863 entraram · R$ 14.527 saíram
Ver Ponte de Caixa →
```
- Valor 26px/800 tabular, tom `--pos`/`--neg` conforme sinal.
- Detalhes completos permanecem em `/app/relatorios` ou drawer futuro; nesta entrega o link "Ver Ponte de Caixa" leva para `/app/relatorios` (rota já existente). O componente `PonteCaixaCard` atual fica preservado no repositório para reuso interno em Relatórios; deixa de ser renderizado na Home.

## 11. Check-in emocional (EmotionalCheckinCard) — progressive disclosure

- Estado inicial 105–135px: título + subtítulo + linha horizontal (scroll-x, `no-scrollbar`) com **4 chips**: Tranquilo, Confiante, Ansioso, **Outro**.
- "Outro" expande os demais chips (Impulsivo, Frustrado, Preocupado) na mesma linha.
- Após seleção: expande textarea + link recente + botão "Registrar". Após salvar: recolhe para chip preenchido + confirmação discreta ("Registrado hoje · editar"). Bloquear duplicidade acidental (mantém update do registro do dia).
- Superfície branca, radius 20, sem sombra.

## 12. Bottom nav (BottomTabBar) e FAB (AssessorFab)

- BottomTabBar: reduzir altura para ~62px + safe area, ícones 20px, ativo `--brand-violet`, inativo `#827C8B`, background `rgba(255,255,255,.92)` + `backdrop-blur`, borda superior `--hairline`, sem sombra.
- AssessorFab: 54px, `--gradient-fab`, sombra `0 14px 30px rgba(91,43,224,.35)`, offset acima da bottom bar respeitando `env(safe-area-inset-bottom)`. Ao tocar mantém o `AssessorActionSheet` atual.

## 13. Index.tsx — composição final

Ordem exata:
1. `HomeHeader`
2. `PeriodPicker`
3. `HeroDisponivelCard`
4. `RitmoCard` (novo)
5. `AssistantTipCard` (compacto)
6. `QuickActions` (sem minicards)
7. `PulseHero` (renomeado, recolhido)
8. `PrevisaoFechamentoCard` (novo)
9. `EmotionalCheckinCard` (progressive)

- Espaçamento vertical entre seções: 20px (`space-y-5`), padding lateral 16px.
- Remover renderização de `PonteCaixaCard`, `MetricTile` grid, e do bloco `<p>Sua próxima melhor ação</p>` extra (label já mora dentro do card).
- Nenhum `useQuery`/hook removido além dos estritamente órfãos.

## 14. Remoções (código + DOM)

- AppLayout: barra superior (saudação/olho/sino/sair).
- Index: `MetricTile` grid, título "Sua próxima melhor ação", `PonteCaixaCard`.
- Componentes com uso zero após refactor: `MetricTile.tsx`, `GastoMedioDiarioCard.tsx`, `GastoCartaoCard.tsx`, `WhatsAppCta.tsx` (se ainda não referenciado). Remover arquivos via `rm` quando confirmado 0 imports.
- MaisMenu: adicionar item "Sair".

## 15. Testes

- Atualizar `src/test/home-runtime-hotfix.test.ts` se assertivas encostam em componentes removidos.
- Novos testes leves:
  - `home-header-single.test.tsx`: renderiza Index dentro de AppLayout mock e garante apenas 1 elemento com role heading nível 1.
  - `ritmo-card.test.tsx`: renderiza labels "Gasto médio" e "Cartão" numa única `<section aria-label="Seu ritmo neste período">`.
  - `previsao-fechamento.test.tsx`: mostra "Seu mês deve fechar em" antes de qualquer detalhe.
  - `emotional-progressive.test.tsx`: inicialmente 4 chips; após clique em "Outro" aparecem 3 chips extras; textarea só aparece após selecionar mood.
- Rodar `bunx vitest run` — todos devem passar.

## 16. Preservação funcional

- Zero mudança em `src/lib/engine/*`, `src/lib/db/finance.ts`, RPCs, Edge Functions, Agent Core.
- `computeAvailableUntil`, `computeNetWorth`, `computeAccountStatementTotals`, `computeDailyAverageComparison`, `computeCardSpendingComparison`, `usePulse`, insights, check-ins — todos consumidos pelas mesmas chamadas atuais.
- `periodStore`, `PrivacyMode`, `AssessorContext` intactos.

## 17. Aceite

- Um único cabeçalho.
- Hero 165–185px, degradê escuro (predominância `#17102F→#2B175F`).
- Gasto médio + cartão numa superfície única 135–155px, com "Ver análise completa".
- Recomendação ≤125px, sem reações visíveis.
- Ações rápidas sem minicards.
- Evolução recolhida ≤100px.
- Previsão de fechamento ≤145px mostrando conclusão primeiro.
- Check-in inicial ≤135px, 4 opções.
- Home ~25% mais curta (medida por soma de `min-height` das seções: baseline atual ~1520px → alvo ~1140px).
- Sem overflow horizontal em 320/360/375/390/430; desktop com `max-w-2xl` centralizado.
- Suíte de testes 100% verde; typecheck limpo.

## Arquivos afetados

- `src/index.css`, `tailwind.config.ts` — tokens e gradientes.
- `src/components/AppLayout.tsx` — remove header duplicado.
- `src/pages/MaisMenu.tsx` — adiciona Sair.
- `src/components/home/HomeHeader.tsx` — refino tipográfico.
- `src/components/home/PeriodPicker.tsx` — refino visual.
- `src/components/home/HeroDisponivelCard.tsx` — refino visual + rodapé.
- `src/components/home/RitmoCard.tsx` — novo.
- `src/components/home/PrevisaoFechamentoCard.tsx` — novo.
- `src/components/home/AssistantTipCard.tsx` — compactação (sem alterar dados).
- `src/components/home/QuickActions.tsx` — sem minicards.
- `src/components/home/PulseHero.tsx` — rótulo + estado inicial compacto.
- `src/components/home/EmotionalCheckinCard.tsx` — progressive disclosure com 4 chips.
- `src/components/BottomTabBar.tsx`, `src/components/assessor/AssessorFab.tsx` — refino visual.
- `src/pages/Index.tsx` — nova composição.
- `src/test/*` — novos testes + eventual atualização.
- Remoções: `MetricTile.tsx`, `GastoMedioDiarioCard.tsx`, `GastoCartaoCard.tsx`, `WhatsAppCta.tsx` (se sem uso), `PatrimonioCard.tsx` (já sem uso na Home — verificar).

Entrega única, sem etapas parciais.
