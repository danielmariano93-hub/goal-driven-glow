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

## 3. Entrega 2 — estado real (atualizado após a conclusão em produção)

### 3.1 Em produção e verificado com dados reais
- **Backfill** `behavior_observed_backfill_v2(uuid)` (função no banco): 31 semanas reconstruídas para o usuário Daniel, `methodology_version='behavior_observed.v2_backfill'`.
- **Job semanal** (edge function `behavior-observed-weekly` + cron `behavior-observed-weekly`, segunda 09:30 UTC, job id 36 no `cron.job`): executado manualmente para o Daniel e gravou o snapshot da semana (coverage 8, nota 5,5). Fluxo: cron → `behavior_observed_weekly_tick()` → função → RPC `behavior_observed_active_users` → motor espelhado (`finance-core/behaviorObserved.ts`) → upsert em `behavior_observed_snapshots`.
- **RPC por usuário** `behavioral_dashboard_snapshot_for_user(p_uid uuid)` e RPC pública `behavioral_dashboard_snapshot()` com `expense_transactions` (gastos com horário) para o pareamento emoção × gasto por janela (`src/lib/engine/emotionSpendPairing.ts`).
- Resultado dos experimentos (`experimentOutcome.ts`), aviso de passado reconstruído, regra "menor confiança entre presente e base".

### 3.2 Feito pelo Lovable e NÃO verificado por mim
Capacidade do Nino/WhatsApp para "como estão meus hábitos?" (referências a `behavior_evolution` em `agent/tools.ts`, `CapabilityRegistry.ts`, `CapabilityRouter.ts`, `prompt.ts`, `DeterministicAnswersImpl.ts`) e o texto de `formatBehaviorEvolution`. Há testes (`src/test/behavior-entrega2.test.ts`), mas falta validar de ponta a ponta com uma mensagem real no WhatsApp/chat.

### 3.3 Falta
1. **Validar o Nino/WhatsApp** (item 3.2) com mensagens reais ("como estão meus hábitos?", "melhorei?") e conferir que o veredito é o mesmo da tela.
2. **Backfill dos demais usuários**: `select public.behavior_observed_backfill_v2('<uuid>'::uuid);` um por vez (idempotente). Não está em laço automático porque o `apply_migration` trava.
3. **Tipos do Supabase**: regenerar `src/integrations/supabase/types.ts` e remover o cast em `observedSnapshots.ts`.
4. **Deploy manual quando o CI falha**: o workflow `Nino Direct Supabase Deploy` só dispara com mudança em `supabase/functions/**` ou `config.toml`. Se uma mudança só de migração/teste precisar de redeploy, disparar `workflow_dispatch` com `confirm=DEPLOY`.

### 3.4 ARMADILHAS JÁ ENCONTRADAS — leia antes de mexer
- **`transactions.status` só tem `confirmed`, `planned`, `superseded`. `posted` NÃO existe.** Um PR (#161) afirmou o contrário e reescreveu os experimentos para `'posted'`. Foi corrigido (a migração `...311000` continua no repositório mas é sobrescrita pela `...320000`, que compara com `confirmed`). **Consulte o banco real (`pg_enum`, `information_schema.columns`) antes de escrever SQL**; erros do mesmo tipo já pegos: `debts.initial_amount` (é `original_amount`), `investment_movements.kind='aporte'` (é `application`).
- **`DROP FUNCTION` trava no ambiente do MCP do Supabase** (timeout de 60 s, nada é removido). Não renomeie parâmetros de função existente; ajuste o chamador. Foi por isso que a RPC por usuário usa `p_uid` e a migração `...330000` documenta a paridade.
- **Há outro agente (Lovable, `gpt-engineer-app[bot]`) empurrando direto para a `main`.** Sempre `git fetch` e confira `git log origin/main` antes de começar; ele já duplicou trabalho e quebrou o CI da `main` uma vez (testes que liam arquivos movidos). Rode a suíte completa na `main` antes de somar mudanças.
- **Teste do mesmo tipo que quebrou o CI:** vários testes leem código-fonte com `readFileSync`. Ao mover lógica de arquivo, procure por `grep -rn "<arquivo antigo>" src/test`.

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
