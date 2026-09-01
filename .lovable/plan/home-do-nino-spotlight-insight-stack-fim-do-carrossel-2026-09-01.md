# Home do Nino: Spotlight + Insight Stack (fim do carrossel)

## Causa estrutural do problema atual

O bloco de orientações da Home coloca dois componentes de densidade muito diferente dentro do mesmo trilho horizontal: `NinoDecisionCard` (narrativa completa: eyebrow, headline, contexto, recomendação, valor grande, CTA de aceite) e `NinoGuidanceCard` (leitura curta com fila de rotação, feedback "Útil/Não ajudou" e "Ver outra leitura"). Um carrossel exige slides equivalentes; aqui os slides são de naturezas distintas — por isso altura fixa corta, altura automática pula e "adequação por conteúdo" gera vazio. O padrão de interação está errado para a informação, não o CSS.

Segundo problema: os dois cards competem como iguais. O card de leituras tem sua própria fila (`buildNinoReadingQueue`) e seu próprio controle de avanço, o que é um segundo mecanismo de escolha dentro de uma tela que deveria mostrar a escolha já feita.

## Nova arquitetura

```text
Disponível hoje
Ações rápidas
┌──────────────────────────────────────┐
│ ORIENTAÇÃO DO NINO                   │  Spotlight (1, ~220-300px)
│ Avance sua meta no ritmo que cabe    │
│ Pelo seu histórico, R$290/mês é o…   │
│ R$ 290/mês                           │
│ [Quero seguir esse plano]  Ajustar   │
└──────────────────────────────────────┘
TAMBÉM VALE SABER
│ ✓  Você já reduziu 19% da dívida…  › │  Insight Stack (até 3, 72-110px)
│ 📅 Uma parcela vence em 9 dias     › │
Ver todas as orientações do Nino →
Resumo do período…
```

Sem swipe, sem snap, sem dots, sem equalização de altura, sem peek lateral.

## Camada de domínio (onde mora a decisão)

Novo arquivo `src/lib/nino/homeEditorial.ts` com o view model `NinoHomeEditorialView` (`primary` | `null`, `supporting` até 3, `totalAvailable`, `lastUpdatedAt`), montado a partir do que já existe — sem novo cérebro e sem tocar em motor financeiro:

- entrada: `useNinoHomeContext()` (diagnóstico canônico), `useNinoNextStep()` (recomendação persistida do Change Agent), `buildNinoReadingQueue()` (fila determinística já existente) e `composeNinoDecisionNarrative()` (camada editorial que já consolida diagnóstico + próximo passo e já bloqueia jargão técnico via `isHumanText`/`BANNED`).
- **primary**: escolhido por ordem — (1) risco crítico, (2) próximo passo material do Change Agent, (3) situação de atenção alta, (4) janela de ação/compromisso, (5) oportunidade material, (6) progresso relevante, (7) estabilidade. Progresso e estabilidade só chegam a primary se nada acima existir. Quando `narrative.sameDecision` é verdadeiro, diagnóstico e próximo passo viram um único item.
- **supporting**: os itens seguintes da fila canônica, já deduplicados pela identidade que a fila usa (`dedup_key`/`situation_key`), com exclusão explícita do id e da chave semântica consumidos pelo primary. Corte em 3; `totalAvailable` guarda o resto para o "Ver tudo".
- textos: `eyebrow`, `headline`, `supporting_text`, `main_value`, `main_value_suffix`, `tone`, ações. Truncagem editorial por sentença (reaproveitando o `compact()` de `homeGuidance.ts`), nunca ellipsis no meio do número ou da decisão.
- rotas: `diagnosisRouteForSituation` / `diagnosisActionLabel` já existentes.

## Componentes

Novos:
- `src/components/home/nino/NinoSpotlightCard.tsx` — anatomia fixa: eyebrow, headline, supporting text, valor único em destaque, CTA primário, CTA secundário opcional (link/text button). Padding 20-24px, borda leve, sombra mínima, faixa lateral sutil por tom. CTA de aceite continua chamando `useNinoNextStepDecision()` → revalidação → compromisso.
- `src/components/home/nino/NinoInsightRow.tsx` — linha compacta: ícone por tom, título, info de apoio, chevron; alvo de toque ≥44px; `Link` para a rota do item.
- `src/components/home/nino/NinoEditorialSkeleton.tsx` — skeleton do Spotlight com altura próxima da real e duas linhas por insight.

Reescrito:
- `src/components/home/NinoGuidanceSection.tsx` — passa a renderizar Spotlight + label "TAMBÉM VALE SABER" + stack + "Ver todas as orientações do Nino →" (`/app/nino`). Remove Embla, dots, autoplay, `usePrefersReducedMotion` do carrossel, teclado ←/→ e `visibilitychange`.

Removidos da Home:
- `NinoGuidanceCard.tsx` e `NinoDecisionCard.tsx` deixam de ser usados na Home (o feedback e o "Ver outra leitura" saem com eles).
- Animação `dot-progress` sai de `tailwind.config.ts` se não houver outro consumidor.

Feedback ("Útil", "Não ajudou") migra para a tela do Nino / detalhe da situação, onde os cards de situação já existem (`NinoSituationCard`, `NinoSupportingSignalRow`). A Home mantém apenas o registro de `acted` no clique do CTA, que já é o comportamento atual. A tela `/app/nino` continua completa (Agora, O que mudou, Aprendizados, Prepare-se, histórico).

## Estados

- **loading**: skeleton compacto.
- **erro**: bloco discreto "Não consegui atualizar sua orientação agora." com retry; a Home não quebra.
- **sem primary, com supporting**: só a stack, sem card grande artificial.
- **sem nada**: bloco oculto (nenhum card inventado).
- Transição leve de 150-250ms na entrada/troca do primary.

## Analytics

Hoje o projeto não tem camada de analytics de front. Criar `src/lib/analytics/ninoEditorial.ts` com um emissor leve e sem valor financeiro no payload (`item_id`, `semantic_type`, `priority`, `surface`, `action`), emitindo `nino_spotlight_impression`, `nino_spotlight_primary_action`, `nino_spotlight_secondary_action`, `nino_supporting_insight_impression`, `nino_supporting_insight_open`, `nino_view_all`. Impressão por `IntersectionObserver`, uma vez por item por sessão.

## Testes

`src/test/nino-home-editorial.test.ts` cobrindo: 1 primary + 1 supporting; corte em 3 supporting; 0 primary + 2 supporting sem Spotlight vazio; headline de 3 linhas; primary sem valor; primary sem ação secundária; progresso vai para supporting quando há decisão melhor; dedup primary/supporting; ausência de feedback na Home; ausência de carrossel/dots/swipe. Ajustar `src/test/nino-home-rotation.test.ts` e `src/test/nino-home-adapter.test.ts` ao novo contrato onde necessário.

Validação visual via Playwright em 375, 390 e 430px nos quatro cenários pedidos (meta + dívida; risco de caixa + 3 supporting; só supporting; vazio), com screenshots, mais typecheck e build.

## Fora de escopo

Motor financeiro, ranking canônico, backend, tela do Nino (só ganha o feedback que saiu da Home), WhatsApp e proatividade permanecem intocados.
