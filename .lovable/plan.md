
# Plano consolidado — Estabilização do Admin + Núcleo estratégico do Nino

Somente PLAN MODE. Nada implementado agora.

---

## A. Diagnóstico atual (auditoria do que já existe)

Auditoria feita sobre `supabase/functions/_shared/agent/core/`, `supabase/functions/*`, `src/pages/admin/*`, hooks e schema. Resumo:

**Já existe e é reaproveitável (evita segunda fonte de verdade):**
- **Agent Core unificado**: `AgentCore.ts`, `IntentRouter`, `PolicyEngine`, `ActionPlanner`, `ToolRuntime`, `ContextPipeline`, `SessionManager`, `StateManager`, `ResponseValidator`, `ResponseGenerator`, `DeterministicFallback`, `ErrorRecovery`. Adapters App/WhatsApp.
- **Memória e perfil**: `MemoryStore.ts` (`agent_memory`), `UserProfile.ts` (`user_profiles_snapshot`), `PersonalizationEngine.ts` (`user_ai_preferences`), `LearningLoop.ts`.
- **Insights e proativo**: `InsightsEngine.ts` (8 detectores), `ProactiveEngine.ts`, `NotificationDispatcher.ts`, `CommunicationDispatcherV2.ts`, `ChannelGuard.ts`, tabelas `user_insights`, `pending_proactive_suggestions`, `communication_deliveries`, `reminder_jobs`, `notifications`. Edge `agent-proactive-tick` com cron.
- **Contexto 360**: `FinancialContext360.ts` (snapshot), `financial_daily_facts`, `financial_current_snapshots`, `financial_daily_category_facts`.
- **Emocional**: `emotional_checkins` (existe, sem cruzamento explícito com eventos financeiros hoje).
- **Conversas**: `conversations`, `conversation_messages`, `ConversationHistory.ts`.
- **Mensageria**: WAHA (`whatsapp-*`), templates (`messageTemplates.ts`), fila outbound, watchdog ACK, reminder jobs.
- **Admin V2**: 15+ RPCs `admin_v2_*`, RBAC (`platform_permissions`, `has_platform_perm`), break-glass, `AdminResponsiveList`, `PageHeader`, `AdminDateFilter`, `adminRpc.ts`.

**Parcial / desalinhado:**
- **Memória comportamental**: `agent_memory` existe mas não há detectores comportamentais explícitos (impulsividade, ansiedade, recaída). `emotional_checkins` não é cruzado com transações.
- **Plano financeiro do assessor**: `FinancialPlanner.ts` gera plano por objetivo, mas não há visão consolidada "acompanhamento semanal/mensal" nem tela dedicada de Assessor além do chat.
- **Explicabilidade de insight**: `user_insights` tem `evidence` JSON, mas UI do usuário não expõe "por que recebi este alerta" nem correção.
- **Governança de proativa**: cooldown/dedup existe em `NotificationDispatcher`, mas não há painel Admin unificado com KPIs (envio, entrega, ação, opt-out, falso positivo).
- **Admin Clientes pisca**: `useEffect` em `Clientes.tsx:64-102` depende de `can` — função recriada a cada render de `usePlatformPermissions` (retorno `{ can: (a) => permissions.has(a) }` novo objeto por render). Cada render dispara RPC → setState → re-render → loop. `permissionsLoading` também está no deps mas o gatilho real é `can`.
- **Logs temporários**: `console.log("[agent-core]…")` em `AgentCore.ts:141,497`. Precisam virar log estruturado ou serem removidos.

**Não existe:**
- Detectores comportamentais dedicados (impulsividade / procrastinação / recaída) cruzando emoção × transação.
- Tela "Assessor — acompanhamento" no app (revisão semanal/mensal, agenda, evolução).
- Painel Admin de qualidade da comunicação proativa (utilidade, ação, falso positivo).
- Confirmação explícita de hipóteses comportamentais pelo usuário ("isso faz sentido? sim/não/parcial").
- Relatório final de classificação de usuários (2 reais, 3 teste, 1 admin) versionado em `docs/`.

**Riscos identificados:**
- **Custo IA**: proativa sem KPI de utilidade real pode gastar tokens sem retorno.
- **Spam WhatsApp**: cooldown existe mas sem monitoramento de opt-out no Admin.
- **Alucinação**: `ResponseValidator` mitiga, mas hipóteses comportamentais precisam ser explicitamente marcadas como hipótese.
- **Dupla contabilização**: fluxos financeiros já foram unificados em `commitMovement`; qualquer nova ação proativa deve reusar isso.
- **Loop de renders** (Clientes) é sintoma de um antipattern reproduzível em qualquer tela que dependa de `can` no `useEffect`.

---

## B. Mapa de features

### FEATURE 1 — Nino Inteligente (memória + contexto)
- **Objetivo**: agente com memória factual, comportamental, preferências, decisões e conversas, usada em toda resposta.
- **Reaproveita**: `MemoryStore`, `UserProfile`, `PersonalizationEngine`, `ContextPipeline`, `FinancialContext360`.
- **Novo**: (a) `memory_kind` `behavior_hypothesis` + `decision_log`; (b) API `MemoryStore.correctFact()` para correção pelo usuário; (c) UI "Meu Nino sabe sobre mim" (visualizar/corrigir/apagar); (d) política de expiração/decay por tipo.
- **Aceite**: agente cita fatos armazenados nas respostas; usuário consegue corrigir/apagar; auditoria registra origem e confidence.
- **Risco**: privacidade/LGPD → precisa endpoint de export/delete (já existe `user-data-export`, estender).
- **Complexidade**: M.

### FEATURE 2 — Comunicação Proativa
- **Objetivo**: Nino inicia conversas úteis, priorizadas, sem spam.
- **Reaproveita**: `ProactiveEngine`, `InsightsEngine`, `NotificationDispatcher`, `communication_deliveries`, `pending_proactive_suggestions`, `agent-proactive-tick`.
- **Novo**: (a) scoring de relevância + confidence unificado em `PolicyEngine.decideProactive`; (b) cooldown/dedup formalizados por `kind` + `dedup_key` com TTL; (c) evento `communication_action` (usuário respondeu / ignorou / opt-out) e KPI de utilidade; (d) opt-in/opt-out granular por `kind` em `notification_preferences`; (e) template versionado por evento.
- **Aceite**: 0 duplicatas em janela 24h; opt-out por tipo; log de decisão auditável; KPI "úteis / enviadas" no Admin.
- **Risco**: spam WhatsApp → guardrail em `ChannelGuard` + limite diário por usuário.
- **Complexidade**: M.

### FEATURE 3 — Ecossistema do Assessor
- **Objetivo**: mais que chat — acompanhamento contínuo com plano, agenda e evolução.
- **Reaproveita**: `FinancialPlanner`, `AgentCore`, insights, metas, `Assessor.tsx`.
- **Novo**: (a) tabela `advisor_reviews` (semanal/mensal, snapshot + recomendações + status); (b) job cron `advisor-review-tick` que gera revisão; (c) tela `/app/assessor/acompanhamento` com plano, próximos passos, evolução, decisões passadas; (d) card Admin "qualidade do assessor" (adesão, decisões, resultado).
- **Aceite**: revisão semanal gerada domingo; usuário vê plano e evolução; decisões registradas com follow-up.
- **Risco**: mistura entre cálculo determinístico (facts) e texto IA — separar visualmente.
- **Complexidade**: M-L.

### FEATURE 4 — Inteligência Comportamental
- **Objetivo**: hipóteses (não diagnóstico) sobre impulsividade, ansiedade, procrastinação, disciplina, evolução, recaída; adaptar tom e metas.
- **Reaproveita**: `emotional_checkins`, `transactions`, `LearningLoop`, `PersonalizationEngine`, `MemoryStore`.
- **Novo**: (a) detector `BehaviorDetectors.ts` (cruza checkin × gasto × frequência); (b) `behavior_hypothesis` em `agent_memory` com `confidence` e `explanation`; (c) UI de confirmação "isso faz sentido?"; (d) ajuste automático de tom/severidade via `PersonalizationEngine`.
- **Aceite**: hipóteses são explicáveis, corrigíveis, versionadas; nunca aparecem como diagnóstico; tom se adapta após confirmação.
- **Risco**: rotulagem indevida → texto sempre em forma de hipótese + botão "não é isso".
- **Complexidade**: L.

---

## C. Roadmap por fases

### Fase 0 — Estabilização Admin (pré-requisito)
Escopo:
- **Corrigir `usePlatformPermissions`**: memoizar `permissions` (Set estável via `useMemo`) e `can` (`useCallback` dependente só de `permissions`); expor `ready` além de `loading`.
- **Padronizar consumidores**: em `Clientes.tsx`, `Seguranca.tsx`, `IAInteligencia.tsx`, `AdminLayout.tsx`, remover `can` do `useEffect deps`; usar `permissions` (Set) ou `ready`.
- **Regressão-guard**: teste unitário do hook (referência estável entre renders) + lint rule/comentário em `adminRpc.ts`.
- **Validação E2E autenticada** de: Cockpit, Crescimento, Clientes, WhatsApp/Operação, Saúde, OCR, IA/Inteligência de Produto, Governança/Auditoria — via Playwright com sessão Supabase injetada, screenshots por tela, checagem de console/network.
- **Relatório de usuários** em `docs/admin-audit-users-2026-07-27.md` + CSV: `auth.users × profiles × platform_admins × user_roles × sinais de uso`, classificação (2 reais, 3 teste, 1 admin), órfãos/duplicados; nenhuma exclusão automática.
- **Remoção de logs**: dois `console.log` em `AgentCore.ts:141,497` → substituir por `DecisionLogger` ou remover; varredura final em `src/pages/admin` e `src/components/admin` (4 arquivos já mapeados).
- Critério de pronto: todas as telas Admin renderizam com dados reais em produção, sem flicker, sem erros de console, com evidência anexada.

### Fase 1 — Memória e contexto unificado (Nino Inteligente MVP)
Escopo:
- Estender `MemoryStore` com `correctFact`, `forgetFact`, decay por `kind`.
- Novo `kind`: `decision_log`, `behavior_hypothesis` (usado na Fase 4).
- UI `/app/perfil/memoria`: ver/corrigir/apagar fatos.
- Estender `user-data-export` para incluir memória.
- Injetar top-N memórias relevantes em `ContextPipeline` (já parcial).
- Testes: unit de decay, correção; integração com Agent Core.
- Pronto: agente cita memória; usuário corrige; export inclui.

### Fase 2 — Comunicação Proativa robusta
Escopo:
- Consolidar decisão em `PolicyEngine.decideProactive` (score, cooldown, dedup, canal).
- `notification_preferences` granular por `kind`.
- Evento `communication_action` (respondeu/ignorou/opt-out) → alimenta `LearningLoop`.
- Admin: aba "Comunicação Proativa" (envio/entrega/leitura/ação/opt-out/custo).
- Testes: dedup em 24h, cooldown por kind, opt-out efetivo, canal fallback.
- Pronto: KPI "úteis/enviadas" visível; 0 duplicatas; opt-out honrado.

### Fase 3 — Ecossistema do Assessor
Escopo:
- Tabela `advisor_reviews` (weekly/monthly) + RPC + job cron.
- Tela `/app/assessor/acompanhamento`: plano, próximos passos, evolução, decisões, alertas priorizados.
- Reuso: `FinancialPlanner`, `InsightsEngine`, metas conjuntas, `financial_daily_facts`.
- Separação visual determinístico × IA (badge "cálculo" vs "sugestão do Nino").
- Admin: card qualidade do assessor.
- Testes: geração de review, idempotência, RLS.
- Pronto: usuário recebe review semanal e vê plano/evolução.

### Fase 4 — Inteligência Comportamental adaptativa
Escopo:
- `BehaviorDetectors.ts` (impulsividade = gasto pós checkin negativo; procrastinação = pagamento no último dia recorrente; recaída = quebra de tendência positiva; disciplina = adesão a metas).
- Persistência como `behavior_hypothesis` em `agent_memory` com `confidence` + `explanation`.
- UI "Percepções do Nino": lista de hipóteses + "faz sentido?" (sim/parcial/não) → alimenta `LearningLoop`.
- Ajuste de tom via `PersonalizationEngine` após confirmação.
- Testes: nunca rotular sem `confidence>=medium`; sempre "hipótese".
- Pronto: hipóteses aparecem, são corrigíveis, tom adapta após confirmação.

### Fase 5 — Observabilidade, avaliação e otimização
Escopo:
- Painel Admin "Qualidade IA": custo por interação, latência, tokens, taxa de fallback, taxa de resposta útil, falso positivo declarado pelo usuário.
- Metric registry unificado (`intelligence_metric_registry` já existe).
- Retenção, engajamento, KPIs de produto por feature.
- Alertas SRE para falhas de canal, custo fora do orçamento, taxa de erro.

---

## D. Plano de implementação (ordem)

Sequencial obrigatório: **Fase 0 → 1 → 2**. Paralelizável: **Fase 3** com **Fase 4** após Fase 2. **Fase 5** contínua a partir da Fase 2.

Não fazer antes:
- Fase 2 antes da Fase 1 (memória alimenta decisão proativa).
- Fase 4 antes da Fase 1 (hipóteses vivem na memória).
- Novas features antes da Fase 0 (Admin instável quebra observabilidade).

Como evitar retrabalho:
- Reusar `AgentCore` e `PolicyEngine` (proibido criar segundo pipeline).
- Reusar `commitMovement` para toda escrita financeira.
- Reusar `NotificationDispatcher` para todo envio proativo.
- Reusar `AdminResponsiveList`/`PageHeader`/`AdminDateFilter` no Admin.

---

## E. Plano de testes

- **Unit**: `usePlatformPermissions` (referência estável), `MemoryStore` (decay, correção), `PolicyEngine.decideProactive` (cooldown/dedup), `BehaviorDetectors` (thresholds).
- **Integração**: `agent-chat` com memória; `agent-proactive-tick` com preferências opt-out; `advisor-review-tick` idempotente.
- **Contrato RPC**: snapshot `admin_v2_*` frontend↔backend (params + shape).
- **E2E autenticado**: fluxo Admin 8 telas; fluxo usuário (chat → memória → correção → hipótese → confirmação → adaptação de tom).
- **Mensageria**: WAHA sandbox, dedup 24h, opt-out.
- **Segurança/RLS**: memória/hypothesis só acessível pelo dono; RPC admin só com `platform_permissions`.
- **Comportamento**: falso positivo declarado reduz score da hipótese; nunca virar rótulo.
- Evidência por fase: screenshots, logs estruturados, resultado SQL, relatório.

---

## F. Indicadores de sucesso

Produto:
- % de mensagens proativas com ação do usuário (meta MVP ≥ 25%).
- % de hipóteses confirmadas (baseline após 4 semanas).
- Adesão a revisão semanal (open rate ≥ 40%).
- Metas atingidas / criadas.
- Retenção D7/D30, frequência semanal.
Operação:
- Custo IA por usuário ativo / dia.
- Latência p50/p95 do turn.
- Taxa de fallback determinístico.
- Falha por canal WhatsApp/App.
- Opt-out por tipo (< 5% ao mês, meta MVP).

---

## G. MVP × V1 × Evolução

**MVP (Fase 0 + Fase 1 + Fase 2 mínima):**
- Admin estável + relatório usuários + logs limpos.
- Memória com correção e uso no chat.
- Proativa: 3 kinds já existentes (spike, vencimento, meta próxima) com cooldown/dedup/opt-out e KPI mínimo.
- Uma tela "Meu Nino sabe sobre mim".

**V1 (Fase 3 + Fase 4):**
- Revisão semanal do assessor com plano visível.
- Hipóteses comportamentais explicáveis e corrigíveis, adaptando tom.

**Fora do primeiro ciclo:**
- Diagnóstico clínico (jamais).
- Onboarding proativo por outros canais além de WhatsApp/App.
- Modelos custom fine-tune.
- Métricas comparativas entre usuários (privacidade).
- Automação de execução financeira sem confirmação.

---

## H. Status executivo

```text
Feature                         | Hoje | +F0  | +F1  | +F2  | +F3  | +F4  | Prio | Dep crítica              | Risco principal
Admin estável                   |  70% |  95% |  95% |  95% |  95% |  95% |  P0  | Fase 0                   | flicker/regressão
Nino Inteligente (memória)      |  45% |  45% |  85% |  85% |  90% |  95% |  P0  | Fase 1                   | privacidade/LGPD
Comunicação Proativa            |  55% |  55% |  60% |  90% |  90% |  95% |  P0  | Fase 1 + preferências    | spam / custo
Ecossistema Assessor            |  35% |  35% |  40% |  50% |  85% |  90% |  P1  | Fase 2 + FinancialPlanner| mistura calc x IA
Inteligência Comportamental     |  20% |  20% |  30% |  40% |  50% |  85% |  P1  | Fase 1 + emotional×fin   | rotulagem indevida
Observabilidade IA/Comm         |  40% |  55% |  60% |  80% |  85% |  90% |  P1  | Fase 2                   | custo cegueira
```

---

## Regras de execução (quando aprovado)

- Blocos pequenos e verificáveis; cada fase exige evidência funcional em produção.
- Migrations idempotentes, sem apagar dados.
- Sem sistemas paralelos de memória, insights ou mensageria (reusar Agent Core).
- Sem `Promise.all` derrubando tela; usar `allSettled` + `adminErrorMessage`.
- Toda automação proativa: dedup + cooldown + opt-out + auditoria.
- Toda inferência comportamental: apresentada como hipótese, corrigível.
- Determinístico vs IA sempre separados visualmente.
- Design system atual preservado.

Aguardo aprovação para executar Fase 0.
