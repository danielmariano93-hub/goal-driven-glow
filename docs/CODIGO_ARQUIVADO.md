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

## Verificado e NÃO retirado

- `src/pages/HabitsV2.tsx`: **em uso**, é renderizada por `Emocoes.tsx` quando a flag de hábitos v2 está ligada. Uma
  checagem anterior (de 05/11) disse o contrário por ter buscado só um formato de importação; está corrigido.
- `src/pages/AssessorAcompanhamentoV2.tsx` e `src/pages/MapaPage.tsx`: em uso (`NinoHub.tsx` e `Emocoes.tsx`).
