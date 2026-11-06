# Código retirado (registro histórico)

Regra: nada sai do código sem uma linha aqui dizendo **o que era, para que servia, por que saiu e como recuperar**.
O conteúdo completo continua no histórico do git; para ver um arquivo retirado: `git show <commit>:<caminho>`.

---

## 05/11/2026 — `src/pages/AssessorAcompanhamento.tsx` (274 linhas)

- **O que era:** a primeira versão da tela "Acompanhamento do Nino": lista de próximos passos do assessor
  (`loadAdvisorReadiness`, `updateAdvisorAction`, botão de atualizar), com marcação de ação concluída.
- **Por que saiu:** a rota `/app/assessor/acompanhamento` já redireciona para `/app/nino` (`App.tsx`), e a tela
  que o usuário vê hoje é `AssessorAcompanhamentoV2.tsx` (usada por `NinoHub.tsx`). Nenhum arquivo do app importava a V1;
  só um teste de contrato lia o arquivo como texto.
- **Como provamos que estava sem uso:** busca por todas as formas de importação (`@/pages/…`, relativa, `lazyRoute`)
  em `src/`, `supabase/`, `scripts/`, `docs/` e `.github/`: zero importadores. Único import dela
  (`@/lib/nino/contracts`) é usado por outros 4 arquivos, então nada ficou órfão.
- **Substituta:** `src/pages/AssessorAcompanhamentoV2.tsx`. O teste de contrato passou a olhar a V2.
- **Último commit com o arquivo:** `71169a6f` (recuperar com `git show 71169a6f:src/pages/AssessorAcompanhamento.tsx`).

## 05/11/2026 — `src/pages/NinoContexto.tsx` (503 linhas)

- **O que era:** a primeira versão da tela "O que o Nino sabe sobre mim" (memória do Nino, hipóteses comportamentais,
  download do contexto em JSON), incluindo a função `humanizeMemoryValue` (transformava o payload da memória em texto legível).
- **Por que saiu:** a rota `/app/nino-contexto` aponta para `NinoContextoV2.tsx` ("O que o Nino aprendeu"). Nenhum arquivo
  do app importava a V1. A função `humanizeMemoryValue` só era usada dentro da própria V1 e por um teste.
- **Como provamos que estava sem uso:** mesma busca acima; o único import dela (`@/lib/engine/ninoClock`) é usado por 18 arquivos.
- **Substituta:** `src/pages/NinoContextoV2.tsx`. O teste de contrato passou a olhar a V2 e o teste de
  `humanizeMemoryValue` (`nino-context-humanize.test.ts`) foi removido junto com a função.
- **Último commit com o arquivo:** `71169a6f` (recuperar com `git show 71169a6f:src/pages/NinoContexto.tsx`).

## 05/11/2026 — Tela de Hábitos v2 (`HabitsV2.tsx` e componentes)

- **O que era:** a tela de hábitos emocionais (roda de hábitos, associação emoção × gasto, cartões de padrão), mostrada por
  `Emocoes.tsx` quando a flag de hábitos v2 estava ligada. Arquivos: `src/pages/HabitsV2.tsx`,
  `src/components/habits/{HabitsWheel,EmotionAssociationCard,PatternCard}.tsx`, `src/lib/behavioral/analysisWindow.ts`
  e os testes `habits-v2-page.test.tsx` e `habits-analysis-window.test.ts`.
- **Por que saiu:** o Mapa Financeiro substituiu essa tela. Decisão do dono do produto em 05/11/2026: liberar o Mapa para
  todos (`mapa_financeiro_default` ligada). `Emocoes.tsx` agora mostra o Mapa; se o Mapa estiver desligado ou a flag falhar,
  mostra a tela legada de emoções, nunca uma tela vazia.
- **Como reverter o rollout (sem código):** `update public.agent_runtime_flags set enabled=false, updated_at=now() where flag_name='mapa_financeiro_default'`.
  Exceção por conta: linha em `mapa_access` (vale mais que a flag).
- **Como recuperar o código:** `git log --diff-filter=D --oneline -- src/pages/HabitsV2.tsx` e `git show <commit>^:src/pages/HabitsV2.tsx`.

## 06/11/2026 — `src/pages/admin/Cockpit.tsx` (402 linhas), rota `/admin/painel-antigo`

- **O que era:** o painel "Visão geral" anterior do admin: clientes na base, novos, clientes usando o Nino, custo do assessor, tokens, latência P50/P95,
  velocidade das telas (`ScreenSpeedStrip`) e taxa de falha de mensagens.
- **Por que saiu:** rota escondida (sem link no menu) cuja fórmula de falha de mensagens divergia da usada nas demais telas (1,82% contra 0,37% no mesmo período)
  e que repetia, com números diferentes, o que a Visão geral nova mostra. A Visão geral e "Nino & IA → Desempenho" cobrem tudo que era acionável.
- **O que continua existindo:** `admin_v2_cockpit` (função do banco) segue disponível; `/admin/painel-antigo` agora redireciona para a Visão geral;
  a velocidade das telas continua em Nino & IA → Desempenho (`ScreenPerformanceBoard`).
- **Como recuperar:** `git log --diff-filter=D --oneline -- src/pages/admin/Cockpit.tsx` e `git show <commit>^:src/pages/admin/Cockpit.tsx`.

## Verificado e NÃO retirado

- `src/pages/AssessorAcompanhamentoV2.tsx` e `src/pages/MapaPage.tsx`: em uso (`NinoHub.tsx` e `Emocoes.tsx`).
