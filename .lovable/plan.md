# Auditoria P0 — caminho analítico do Nino (somente leitura)

Nada foi alterado: sem edição de código, sem migration, sem deploy.

## Evidência de produção (consulta a `agent_runs`, últimos 4 dias)

| horário (UTC) | path | tools_used | final_path | fallback_reason |
|---|---|---|---|---|
| 31/08 14:43, 14:17, 14:16 | deterministic_tool | assess_goal_performance | composite_failed | `gates_failed:goal_current_consistent(gasto atual da meta diverge da comparação)` |
| 31/08 13:40 | deterministic_tool | assess_goal_performance | composite_answered | — |
| 31/08 13:36 | llm | compare_financial_metric, get_financial_snapshot | not_applicable | `plan_not_matched` |
| 31/08 12:42 | llm | compare_financial_metric, get_financial_snapshot, assess_financial_performance | (sem telemetria) | — |

Fato-chave: o gate `goal_current_consistent` **não existe mais no main** (foi substituído por `goal_analysis_period_consistent` e `period_role_consistent` em `AnalysisGates.ts`). Runs às 14:16–14:43 ainda o registram: o runtime em produção é anterior ao commit atual. **Drift confirmado por evidência, não por suposição.**

Também confirmado: `agent_runtime_flags` não tem linha `composite_analysis_v1`, então vale o default `true` em `FeatureFlags.ts` — o flag não é a causa.

## 1) Caminho real e entrypoints

- `whatsapp-webhook/index.ts` → `runOrchestrator` (`_shared/agent/orchestrator.ts`, linhas 733 e 826) → `handleTurn` (`_shared/agent/core/AgentCore.ts`).
- `agent-run/index.ts` → `runOrchestrator` → `handleTurn` (usado pelo simulador admin e por chamadas service-role).
- `agent-chat/index.ts` → `handleAppMessage` / `handleAppAction` (`core/adapters/AppAdapter.ts`) → `handleTurn`.
- `core/adapters/WhatsAppAdapter.ts` existe mas **não é usado pelo webhook** (o webhook chama `runOrchestrator` direto). É código paralelo, não um bypass ativo.
- Não há entrypoint legado que escreva resposta sem passar por `handleTurn`. O que existe são **atalhos internos de `handleTurn` anteriores ao caminho analítico** (item 3).

## 2) Edge Functions que dependem de `_shared/agent` (precisam de redeploy quando `_shared` muda)

`agent-chat`, `agent-proactive-tick`, `agent-run`, `anticipation-tick`, `financial-reports-generate`, `shared-goal-notify-invite`, `split-reminders-dispatch-v2`, `user-ai-preferences`, `whatsapp-webhook`.

As duas do incidente são `whatsapp-webhook` e `agent-run`. Redeployar só uma delas produz exatamente o quadro observado: uma responde com gates novos e a outra com gates antigos.

## 3) Pontos que ainda deixam pergunta anafórica/comparativa cair no fluxo legado

1. **`resolveAnalyticalPlan` exige domínio + composição.** Em `AnalyticalQueryPlanner.ts`: `if (!domains.length) return null` e `if (!goalDomain || !composite) return null`. `goalDomain` só nasce por herança quando `scope.source === "inherited_from_turn"` e `entity_type === "category"`. Se `last_analysis.scope` não estiver na memória da sessão (sessão nova, expirada, canal diferente, turno anterior respondido por rota conversacional), a pergunta "comparando essas categorias…" cai em `plan_not_matched` → LLM → `compare_financial_metric`. Foi o run das 13:36.
2. **`composite` exige `facets.length >= 2`.** Uma anáfora enxuta ("e comparado ao mês passado?") tem só a faceta `comparison` e não monta plano.
3. **Atalhos antes do bloco analítico em `handleTurn`**: fast log (linha ~260), fluxo de pendência/slots (linhas ~319–473) e **rota conversacional** `classifyConversational` (linha ~493, `return` na 532). Qualquer um deles responde e retorna antes de `runCompositeAnalysis` (linha 911) — e nesses returns **`last_analysis` não é salvo**, o que quebra a herança do turno seguinte.
4. **Carryover depende de `scopeFromToolCalls`** (`AgentCore.ts` 1533): se o turno anterior respondeu sem ferramenta que devolva categorias com id, não há escopo herdável. `resolveScope` então retorna `globalScope()` com `locked: false`.
5. **`composite_analysis_v1` é lido por flag com cache de 60s e fail-open**; a leitura falhando devolve `{}` e usa default, então não bloqueia — mas uma linha `enabled=false` inserida por engano derruba todo o caminho novo silenciosamente.

## 4) Garantias atuais contra evidência `scope=overall` / período divergente

Parciais. `EvidenceReconciliation.reconcileEvidence` só rejeita quando `args.scope?.locked === true` e `entity_ids.length > 0`. Fora do caminho composto, o escopo vem de `memory.last_analysis.scope` — ausente exatamente no cenário do incidente, então `scopeLocked = false` e a evidência global **é aceita**.

Além disso:
- A reconciliação roda **depois** da resposta pronta (`AgentCore.ts` ~1249): a LLM já viu as duas leituras. O bloqueio final (`replyUsesRejectedEvidence`) é textual — só dispara se a resposta cita um valor ≥ R$ 100 que exista *apenas* na evidência rejeitada, com tolerância de R$ 0,50. Conclusão errada sem número citado, ou com número coincidente, passa.
- `!analytical && replyUsesRejectedEvidence(...)`: quando o caminho composto respondeu, o bloqueio nem é avaliado.
- `AnalysisGates` (incluindo `scope_preserved`, `comparison_contract_consistent`, `period_role_consistent`, `arithmetic_consistent`) só roda **dentro** de `CompositeAnalysis`. Se o plano não casou, nenhum gate protege a resposta.

Ou seja: para "categorias específicas + agosto vs julho", a garantia existe apenas quando o plano composto casa. Quando ele não casa, não há gate algum.

## 5) Deploy atômico/verificável — o que falta

- `agent_runs` **não tem** coluna de versão de runtime: nenhuma de `runtime_version`/`build_sha` existe (colunas confirmadas por `information_schema`). Não há como distinguir "código novo com bug" de "código antigo em produção" sem inferir por nome de gate.
- Nenhuma constante de versão no código: `grep RUNTIME_VERSION|BUILD_SHA` em `supabase/`, `scripts/`, `docs/` não retorna nada.
- `package.json` tem `test`, `test:perf-arch`, `test:tx-selects`, `sync:finance-core` — **nenhum smoke test pós-deploy** e nenhuma lista declarada de functions dependentes de `_shared/agent`.

Recomendação para o patch P0:
1. Constante `AGENT_RUNTIME_VERSION` em um módulo do core, persistida em `agent_runs.context_layers.analytical_path.runtime_version` (sem migration, usa o JSONB existente) e devolvida por `agent-run`/`whatsapp-webhook` num endpoint `?health=1`.
2. Manifesto explícito (`supabase/functions/_shared/agent/DEPENDENTS.md` ou um `.mjs` de checagem) com as 9 functions do item 2, e script que falha quando `_shared/agent` muda sem que todas estejam na lista de deploy.
3. Smoke test pós-deploy: `agent-run` com `source=simulator` executando os dois turnos do incidente e afirmando `final_path=composite_answered`, `tools_used=[assess_goal_performance]` e `runtime_version` esperada. Sem isso, deploy parcial continua invisível.

## 6) Lacunas de teste end-to-end

O que existe é unitário: `nino-composite-analysis.test.ts` (planner, escopo, gates, interpretação), `nino-analytical-path-scope.test.ts` (herança, carryover, reconciliação, base de comparação), `nino-goal-performance-runtime.test.ts` (motor). Nenhum teste exercita `handleTurn`.

Faltando, para reproduzir o incidente:
1. **Dois turnos reais via `handleTurn`** (turno 1 "overview das metas" → turno 2 "comparando essas categorias com o mesmo período do mês anterior"), afirmando `path`, `tools_used`, `final_path` e o escopo persistido em memória entre turnos.
2. **Turno 2 com memória vazia** (sessão nova) — hoje é o caminho que produz `plan_not_matched`; o teste deve fixar o comportamento esperado (plano casar por anáfora, ou resposta honesta), nunca `compare_financial_metric` global.
3. **Turno anterior respondido por rota conversacional/fast log**, provando que o escopo ainda sobrevive.
4. **Turno com duas ferramentas divergentes no mesmo run** (agosto×julho e julho×maio/junho), provando que a evidência global é descartada *antes* de ir à LLM, e não só se o valor for citado.
5. **Regressão de nome de gate**: teste que falha se `goal_current_consistent` reaparecer em qualquer arquivo, e teste que casa a lista de gates emitidos com `GateName`.
6. **Guarda de drift**: teste do manifesto de dependentes de `_shared/agent` contra `ls supabase/functions`.

## Recomendação de ordem para o patch P0

1. Redeploy explícito e verificado das 9 functions dependentes (o incidente das 14:43 é drift, não lógica).
2. `runtime_version` em `analytical_path` + smoke test de dois turnos.
3. Fechar `plan_not_matched` para anáfora comparativa e persistir `last_analysis` também nos returns antecipados de `handleTurn`.
4. Mover a reconciliação de evidência para antes da síntese da resposta quando o plano exige escopo travado.
5. Testes 1–6 acima.
