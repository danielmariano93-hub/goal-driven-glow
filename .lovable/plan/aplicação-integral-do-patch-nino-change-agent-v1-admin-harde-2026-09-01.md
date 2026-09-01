# Aplicação integral do patch NINO_CHANGE_AGENT_V1_ADMIN_HARDENING_20260901

O patch será aplicado hunk por hunk sobre o estado atual, sem recriar solução nem simplificar escopo. `git apply` não é permitido no ambiente, então a aplicação é manual com validação de cada âncora — como já fizemos no `nino_behavior_wealth.v1`.

## Estado verificado agora

- `_shared/agent/changeLoop.ts`, `_shared/agent/behavioralPrinciples.ts` e `src/components/admin/NinoLearningBoard.tsx` ainda não existem: são arquivos novos do patch.
- Base do patch já está no projeto: `get_next_best_action` existe em `_shared/agent/tools.ts` e `analysis.next_action` está no `CapabilityRegistry`.
- Tetos residuais confirmados: `max={5}` (linha 195) e `max={14}` (linha 206) em `src/components/admin/messaging/RulesBoard.tsx`; no banco, `CHECK (max_per_week BETWEEN 1 AND 14)` e clamps `least(5,...)` / `least(14,...)` na migration `20260817122944`.
- `src/components/admin/AiEfficiencyHistoryBoard.tsx` ainda chama `admin_v2_ai_history` em duas queries (linhas 144 e 161).

## O que será feito

### 1. Change Agent v1 (Edge/_shared)
- Novo `_shared/agent/behavioralPrinciples.ts`: 9 princípios como moldura de linguagem/timing, sem nenhuma matemática financeira e sem percentuais universais.
- Novo `_shared/agent/changeLoop.ts`: persistência da recomendação, aceite de compromisso com **revalidação obrigatória** antes de criar (truth gate, estágio, meta e recomendação canônica), supersede quando a situação mudou, check-in factual e pausa.
- `tools.ts`: novas ferramentas do patch (persistir recomendação, assumir próximo passo, check-in de progresso, pausar acompanhamento) + registro no registry.
- `CapabilityRouter.ts` / `CapabilityRegistry.ts`: roteamento determinístico das intenções ("quero seguir esse próximo passo", "como estou indo com o que combinamos", "pausa esse acompanhamento").
- Nenhuma movimentação financeira automática: o compromisso é comportamental.

### 2. Acompanhamento medido por fatos
Progresso lido dos fatos canônicos por estágio (caixa projetada, pressão de dívida, `goal_contributions`, aplicação de investimento confirmada, reparo de truth gate) resultando em `completed | progress | stalled | regressed | no_evidence`. Truth gate bloqueado → `no_evidence`. Regressão → reformulação sem culpa, nunca repetição da mesma recomendação.

### 3. Loop proativo sem segundo motor
Follow-ups entram no pipeline existente `proactive_multifinance` (situations → ranking → allocateAttention → dispatcher) via os hunks em `_shared/proactive/pipeline.ts` e `_shared/intelligence/insightValue.ts`, competindo por atenção com risco de caixa, dívida e metas.

### 4. Aprendizado auditável
- Nova tabela `nino_learning_events` + backfill não sensível a partir de `agent_memory` (sem copiar conteúdo).
- `LearningLoop.ts` instrumentado: `correction`, `interaction_reinforcement`, `merchant_observation`, `category_observation`, `change_commitment`, `change_checkin`.
- `agent_memory` permanece como estado consolidado; o ledger registra a trajetória.

### 5. Admin
- Nova aba **Aprendizado** em IA & Inteligência com `NinoLearningBoard.tsx` e RPC `admin_nino_learning_overview` (contagens, aplicados, correções, compromissos ativos/concluídos, últimos eventos, saúde do pipeline). Alerta explícito quando há conversas recentes sem eventos de aprendizado.
- Limites de mensagens: remoção de `max={5}` / `max={14}` no `RulesBoard.tsx`, drop dos CHECKs e dos clamps `least(5)` / `least(14)` na RPC. Nova regra: `max_per_day >= 0` e `max_per_week >= 0`; `0` bloqueia proativos não críticos; auditoria preservada.
- Tokens e latência: nova RPC `admin_v3_ai_history` (tokens/custo/latência de IA em `ai_usage_ledger`, latência E2E em `agent_runs`, fallback seguro para histórico antigo); `AiEfficiencyHistoryBoard.tsx` passa a consumir a v3. Nenhuma série artificial.

### 6. Migration
Uma migration, exatamente a do patch (`20260901120000_nino_change_agent_v1_admin_hardening.sql`), aplicada pelo fluxo normal com aprovação: cria `nino_change_recommendations`, `nino_change_commitments`, `nino_change_checkins`, `nino_learning_events` com GRANTs, RLS, índices, lifecycle e auditoria; ajusta limites; publica `admin_v3_ai_history` e `admin_nino_learning_overview`. Sem DELETE/TRUNCATE em dados existentes.

### 7. Validação e deploy
- `src/test/nino-change-agent-v1.test.ts` do patch + suíte completa, typecheck, build, `check:agent-dependents` e mirror do `finance-core`.
- Bump de `AGENT_RUNTIME_VERSION` e redeploy atômico das 9 funções de `DEPENDENTS.md` (tools, changeLoop, LearningLoop e pipeline entram no bundle de todas).
- Verificação pós-deploy: limites 20/100 persistindo, gráficos com dados reais quando há telemetria, aba Aprendizado com eventos reais.

## Adaptações previstas
Os hunks têm numeração sintética e o repositório evoluiu (behavior_wealth v1 já aplicado). Onde o contexto divergir, mantenho a intenção arquitetural exata do patch e reporto cada adaptação no fechamento. Pendências, se houver, serão declaradas — nunca mascaradas como concluídas.
