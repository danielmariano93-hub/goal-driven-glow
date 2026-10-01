# Redesign da página Emocional — passagem de bastão

Documento para quem continuar o trabalho (outra IA ou pessoa). Idioma de produto e de resposta ao usuário: **português do Brasil**.

## 1. Objetivo e racional

Problema relatado: a página `/app/emocoes` trazia muita informação pouco acionável. O usuário não via **o que melhorou ou piorou**, **por quê**, a **evolução dos hábitos** nem o **impacto no dinheiro**.

Causa raiz verificada: a nota "Nino observa" era calculada na hora (foto do momento) e **nunca era guardada**. O usuário tinha uma só avaliação e nela as notas observadas ficaram vazias. Sem histórico não existe "melhorou/piorou".

Princípio de produto: o Nino só afirma melhora ou piora quando há **dois pontos reais** para comparar. Sem isso diz "ainda não dá para dizer". Correlação emocional nunca é apresentada como causa. Status sempre com ícone + texto, nunca só cor.

## 2. Entrega 1 (feita)

| Peça | Arquivo | Racional |
|---|---|---|
| Tabela de histórico | `supabase/migrations/20261001300000_behavior_observed_snapshots.sql` | Uma linha por usuário por semana (`unique(user_id, week_start)`), RLS por usuário, `dimensions` em jsonb com nota, confiança e fatores. |
| Fatores por dimensão | `src/lib/behavioral/observedProfileV2.ts`, tipo `ObservedFactor` em `mapCycle.ts` | Cada dimensão devolve os componentes com valor 0–10 e peso (os mesmos números do cálculo). É o que permite explicar o porquê. |
| Motor de evolução (puro) | `src/lib/behavioral/behaviorEvolution.ts` | `pickBaseline`, `compareDimensions`, `buildBehaviorVerdict`, `habitSeries`, `moneyImpactOf`, `weekStartOf`, `DIMENSION_ACTION`. Sem I/O. |
| Leitura/gravação | `src/lib/behavioral/observedSnapshots.ts` | `useObservedSnapshots` e `useSaveObservedSnapshot` (grava a leitura da semana ao abrir a página; não grava em modo degradado nem com menos de 3 dimensões). |
| Blocos de tela | `src/components/behavioral/EvolutionParts.tsx` | `BehaviorVerdictCard`, `WhatChanged`, `HabitTrend`, `MoneyImpactCard`. |
| Roda com 3ª camada | `src/components/behavioral/BehaviorWheel.tsx` | Prop `baseline` desenha a leitura anterior do Nino. |
| Página | `src/pages/Emocoes.tsx` | Ordem: veredito → roda → o que mudou e por quê → evolução → impacto no dinheiro → experimentos ativos → check-in → humor → destaques → hipóteses → "como calculamos". |
| Testes | `src/test/behavior-evolution.test.ts` (+3 testes legados ajustados ao novo contrato da página) | Cobrem base de comparação, explicação por componente, veredito, séries e impacto em reais. |

Regras do motor que não devem mudar sem decisão de produto:
- Base de comparação: snapshot mais recente com ~26+ dias; se o histórico é curto, o mais antigo com 7+ dias; senão, sem comparação.
- Variação menor que 0,5 ponto = estável.
- Dimensão com **confiança baixa não conta** como melhora ou piora; com menos de 3 dimensões comparáveis o veredito é "insuficiente".
- Veredito: melhores − piores ≥ 2 = melhorando; ≤ −2 = piorando; senão parecido.
- O "porquê" só cita componentes que andaram **na mesma direção** da nota.

## 3. Entrega 2 — estado real e o que falta

### 3.1 Feito
- **Backfill parcial** (`supabase/migrations/20261001310000_behavior_observed_backfill.sql`, função `behavior_observed_backfill_v2(uuid)`): reconstrói semanas passadas só de Consciência (check-ins), Tranquilidade (check-ins), Controle (ciclos de meta fechados), Patrimônio (`investment_movements.kind='application'`) e Dívidas (`debts.original_amount` menos `debt_payments`). Grava com `methodology_version='behavior_observed.v2_backfill'`, `overall_score` nulo e confiança geral baixa. **Já aplicada em produção e executada para o usuário Daniel (31 semanas, 2026-02-27 a 2026-09-21).** Para outros usuários ainda NÃO foi executada (ver 3.2).
- **Regra de confiança** em `behaviorEvolution.ts`: a confiança de uma comparação é a menor entre a leitura atual e a base (`weakestConfidence`); base reconstruída frágil nunca sustenta "melhorou/piorou".
- **Resultado dos experimentos** (`src/lib/behavioral/experimentOutcome.ts` + `ExperimentsBoard.tsx`): antes × depois, efeito estimado em R$ e recomendação de manter ou trocar.
- **Aviso visual** de passado reconstruído em `HabitTrend` (prop `reconstructedWeeks`).

### 3.2 Falta (em ordem sugerida)
1. **Rodar o backfill para os demais usuários.** Não está na migração de propósito (o laço sobre `auth.users` trava o `apply_migration`). Executar usuário a usuário com `select public.behavior_observed_backfill_v2('<uuid>'::uuid);` (é idempotente: `on conflict do nothing`).
2. **Job semanal no servidor.** Hoje o snapshot da semana só é gravado quando o usuário abre a página. Criar edge function (padrão `x-cron-secret`, ver `nino-insights`) + agendamento. Bloqueio conhecido: `observedProfileV2.ts` importa `@/lib/behavioral/client` (cliente Supabase do navegador), então não dá para espelhar direto; extrair as partes puras (tipos e `emotionalScore`) para um módulo sem dependência de navegador, registrá-lo em `FINANCE_CORE_MODULES` (`scripts/sync-finance-core.mjs`) e cobrir com o teste de paridade `finance-core-parity.test.ts`. A função SQL `behavioral_dashboard_snapshot()` usa `auth.uid()`; para o job, ou criar variante que receba o `user_id` (somente `service_role`) ou montar os mesmos dados na edge function.
3. **Nino/WhatsApp** responder "como estão meus hábitos?" com o mesmo veredito (`behaviorEvolution.ts` espelhado). Seguir o pipeline de leitura (ActionIR → ferramenta em `supabase/functions/_shared/agent/tools.ts` → composição) e registrar a capacidade onde as demais estão (CapabilityRegistry, ConversationTurnContract, SemanticInterpreterV3). Ver como foi feito `spending_goal.plan` na PR #153/#154 como modelo.
4. **Pareamento emoção × gasto por horário** em `src/lib/engine/emotionFinance.ts` (`emotion_finance.v1`); hoje a tela usa o pareamento por dia (`computeEmotionSpend` em `dashboardSnapshot.ts`). Manter "associação, não causa".
5. **Tipos do Supabase:** regenerar `src/integrations/supabase/types.ts` e remover o cast em `observedSnapshots.ts`.

### 3.3 ARMADILHA JÁ ENCONTRADA — leia antes de mexer em SQL
`transactions.status` tem **somente** os valores `confirmed`, `planned` e `superseded`. **`posted` NÃO existe.** Um PR anterior (#161) afirmou que `confirmed` era "legado" e reescreveu as funções de experimento para `status = 'posted'`; isso zeraria linha de base e gasto observado dos experimentos. A migração foi removida e **nunca foi aplicada**. Regra: **antes de escrever SQL que filtra por valor de enum ou nome de coluna, consulte o banco real** (`pg_enum`, `information_schema.columns`); não confie em memória, em outro PR nem em documentação. Outros erros do mesmo tipo corrigidos nesta entrega: `debts.initial_amount` (a coluna é `original_amount`) e `investment_movements.kind='aporte'` (os valores reais são `application` e `redemption`).

## 4. Como desenvolver aqui (regras que precisam continuar valendo)

**Validação antes de qualquer push** (todas rodadas na raiz):
- `npx vitest run` — suíte inteira deve passar (2.827 testes no fim da Entrega 1).
- `npx tsc --noEmit -p tsconfig.app.json` — a linha de base são **8 erros pré-existentes** (testes antigos e `chartFallback.ts`). Qualquer erro a mais é seu.
- `npx eslint <arquivos alterados>` — o projeto tem erros de `no-explicit-any` pré-existentes; não adicionar novos (usar comentário de justificativa quando o tipo gerado não existir).
- `npm run build` e, depois, `git checkout -- supabase/functions/mcp/index.ts` (o build o altera).
- Edge functions: `~/.deno/bin/deno check --no-config <entrada>`; linhas de base de erros pré-existentes: agent-chat 14, agent-proactive-tick 1, whatsapp-webhook 26, agent-run 15.
- Telas: conferir em celular (390 px) com Playwright (Chromium em `/opt/pw-browsers`; não rodar `playwright install`) e **apagar os arquivos de prévia** antes do commit.

**Fonte única de verdade financeira:** data de competência para cartão, líquido de estornos, categoria efetiva, estabelecimento normalizado, sem transferências, pagamento de fatura e investimentos (`insights/executive/load.ts`). Pagamento de dívida entra como saída **apenas** nos relatórios (`includeDebtPayments`); os insights executivos tratam como amortização. Não criar segunda definição de "gasto".

**Espelho finance-core:** lógica compartilhada entre app e edge function vive em `src/lib/engine/<módulo>.ts` e é copiada por `scripts/sync-finance-core.mjs`. Nunca editar a cópia em `supabase/functions/_shared/finance-core/` à mão; rodar o script e commitar as duas.

**Testes:** lógica nova é função pura com teste ao lado (`src/test/<nome>.test.ts`). Quando a tela muda, os testes que leem o código-fonte da página (`readFileSync`) precisam ser atualizados ao novo contrato, preservando a intenção original (ex.: experimentos ativos aparecem antes do check-in).

**Banco (MCP do Supabase, projeto `amjanjlvsatubxdreyep`):**
- Toda mudança de esquema vira arquivo em `supabase/migrations/` **e** é aplicada com `apply_migration`. RLS por usuário em toda tabela nova.
- `apply_migration`/`execute_sql` travam em instruções sem linhas de retorno: dividir migrações em pedaços pequenos e conferir o estado depois.
- Validar com dados reais antes de dizer que está pronto. Usuário de teste real: Daniel, `088920ce-1f5e-47d5-9e07-e2e4a63f9214`. Para chamar `nino-insights` fora do app: `net.http_post` com o cabeçalho `x-cron-secret` (segredo no vault: `INTERNAL_CRON_SECRET`, `meunino_cron_secret` ou `nocontrole_cron_secret`) e `user_id` no corpo; ler a resposta em `net._http_response`.

**Entrega:** branch nova a partir de `origin/main` → PR com corpo no padrão do repositório → esperar o check `regressions` ficar verde → squash merge informando o SHA completo da cabeça → esperar o workflow `deploy` (redeploy de todas as funções) e o Vercel ficarem verdes → validar em produção. Sem GitHub CLI: usar as ferramentas `mcp__github__*`. Nunca pular, desabilitar ou "quarentenar" teste para ficar verde.

**Comunicação com o usuário:** sempre em português do Brasil, dizendo com clareza o que foi e o que **não** foi verificado (por exemplo, "a tela logada não foi aberta; só a prévia dos componentes").
