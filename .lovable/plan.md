# nino_behavior_wealth.v1 — Nino como agente de comportamento e patrimônio

## Resultado da validação prévia

- O patch informado em `.lovable/nino_behavior_wealth_v1.patch` **não existe** nesse caminho. O arquivo válido é o que você anexou nesta mensagem (`nino_behavior_wealth_v1.patch`, 821 linhas), já copiado para leitura.
- `git apply --check` **não pode ser executado**: o comando `git apply` é bloqueado neste ambiente ("'git apply' is not allowed"). Além disso, os hunks do patch usam números de linha sintéticos (`@@ -1,4 +1,5 @@`), portanto ele não é aplicável por `git apply` nem em um clone comum — é um patch de contexto.
- **Consequência:** aplicarei o patch hunk por hunk, com o conteúdo exato de cada hunk, sem simplificação. Validei que **todas as âncoras existem** no código atual:
  - `BehaviorService.ts:184` tem exatamente o bloco `candidate.confidence >= 0.72 && effectiveStatus === "pending"` e já exporta `shouldPersistBehaviorMemory`.
  - `ranking.ts:134` retorna `{ decisions, selected }` e já calcula `ranked` na linha 102 (o bug descrito é real).
  - `pipeline.ts:128/143/162` usam `allocateAttention` e persistem/reportam `situations` (pré-ranking) — confirmando que `priority_score` gravado vem do array não ranqueado.
  - `insightValue.ts:46-47`, `Conversational.ts:37/53/178`, `CapabilityRouter.ts:32/81/476`, `CapabilityRegistry`, `tools.ts` (registro após `build_financial_plan`, antes de `get_debt_status`) conferem.
  - Dependências do novo motor conferem: `computeAgentSnapshot(sb,userId)`, `computeGoalStrategy(sb,userId,{})`, `analyze_wealth_opportunity({sb,user_id},{months})`, e `reconciliation_issues` tem `resolved_at`, `kind`, `severity`.

## O que será feito

1. **Novo motor determinístico** `supabase/functions/_shared/behavior-wealth/nextBestAction.ts` (412 linhas do patch, íntegro): `selectBehaviorWealthStage` com a ordem obrigatória `repair_truth → stabilize_cash → reduce_debt_pressure → fund_goal → build_wealth → protect_progress`, truth gate por conciliação aberta / cash bridge low|unknown, contexto comportamental só `confirmed`/`partial`, e capacidade sustentável vinda de `wealth_opportunity.v1` (nenhuma fórmula nova, nenhum "20% da renda").
2. **Capability e ferramenta**: `get_next_best_action` em `tools.ts` (função + registro no catálogo de tools), `next_best_action` no `CapabilityRouter` (tipo, allowlist e regex determinística com `execution: "deterministic"` e `required_tool`), e entrada `analysis.next_action` no `CapabilityRegistry`.
3. **Comportamento**: `BehaviorService.ts` deixa de enfileirar hipótese `pending` e passa a *dismissar* fila herdada com `defer_reason: "behavior_hypothesis_not_confirmed"`. Nenhuma hipótese é apagada.
4. **Identidade**: `Conversational.ts` — `what`, `does`, `purpose`, `promise` e `capabilitiesReply` conforme o patch.
5. **Correção do bug de ranking**: `ranking.ts` passa a retornar `ranked`; `pipeline.ts` persiste e reporta `ranked` (com `priority_score` e `score_reasons` reais), e injeta a oportunidade de `fund_goal`/`build_wealth` no **mesmo** governador de atenção (nenhum sistema paralelo). `insightValue.ts` ganha `wealth_building_action: 68` e `wealth_progress: 45`.
6. **Migration** `supabase/migrations/20260831224500_nino_behavior_wealth_v1.sql` aplicada pelo fluxo normal de migrations (sem nenhuma ação sua no painel).
7. **Teste** `src/test/nino-behavior-wealth-v1.test.ts` (88 linhas, íntegro).

## Itens que o patch não cobre e que farei para ele funcionar em runtime

- **Bump de `AGENT_RUNTIME_VERSION`** em `_shared/agent/core/RuntimeContract.ts` (hoje `nino-agent-p0.2026-09-01.2`) — obrigatório pelo contrato de deploy atômico, senão não há como provar em `agent_runs` que o runtime novo respondeu.
- **Redeploy atômico** das 9 funções de `_shared/agent/DEPENDENTS.md` (inclui `agent-run`, `agent-chat`, `whatsapp-webhook`) + `agent-proactive-tick` e demais que empacotam `_shared/proactive`.
- **Catálogo de comunicação**: `wealth_building_action` / `wealth_progress` não existem hoje em `communication_catalog`. Verificarei se a entrega exige linha no catálogo; se exigir, insiro a linha de catálogo (dado, não schema) para a oportunidade patrimonial não ser descartada silenciosamente. Nenhuma política existente é alterada.
- **Ajuste de asserção de versão** em `src/test/nino-protected-analytical.test.ts`, que fixa o `AGENT_RUNTIME_VERSION`.

## Validação

- `npx vitest run src/test/nino-behavior-wealth-v1.test.ts`, depois suíte completa, `npm run build` e typecheck (`tsgo`).
- Smoke tests dos 10 cenários pedidos (5 de estágio via motor, 2 de roteamento de capability, 2 de hipótese, 1 de tick proativo).
- Queries de validação: fila de sugestões vindas de hipótese não confirmada = 0; `proactive_situations` recentes com `priority_score`/`score_reasons` coerentes.
- Relatório final nos 15 pontos que você listou.

## Fora de escopo

Nenhuma alteração em contratos financeiros existentes, nenhum dado financeiro tocado, nenhuma hipótese ou histórico apagado, nenhuma publicação em produção sem sua autorização.
