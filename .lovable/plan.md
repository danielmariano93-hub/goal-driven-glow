# Plano — Observabilidade, Calibração, Reconciliação e Artefatos no WhatsApp

Consolidação em quatro frentes complementares, aproveitando o motor analítico e o contrato `ChartArtifact` já entregues. Escopo backend + admin + testes; sem retrabalho na LP.

---

## 1. Observabilidade unificada (App + WhatsApp)

### 1.1 Evento canônico `agent_turn_event`
Nova tabela `agent_turn_events` (append-only), gravada pelo `DecisionLogger` a cada turno em `AgentCore.handleTurn`:

Campos: `id`, `run_id`, `user_id`, `conversation_id`, `channel` (`app`|`whatsapp`|`simulator`), `intent`, `tools_used jsonb` (nomes + durações), `formula_versions jsonb` (por tool), `stages_ms jsonb` (session/intent/policy/plan/tools/validate/persist/total), `tokens_in`, `tokens_out`, `estimated_cost_usd`, `model`, `fallback_used`, `artifact_id nullable`, `artifact_status` (`none`|`generated`|`delivered`|`failed`), `error`, `created_at`.

RLS: apenas platform admin lê. GRANT `service_role` all, `authenticated` select somente via view admin.

### 1.2 Instrumentação
- `supabase/functions/_shared/agent/core/Observability.ts`: adicionar `recordArtifact(status, id?)` e `recordFormulaVersion(tool, version)` no `TurnMetrics`.
- `_shared/agent/tools.ts`: cada tool analítica retorna `provenance.formula_version`; runtime agrega em `metrics.formula_versions[tool]`.
- `AgentCore.handleTurn`: no `onFinish`, além de `agent_decisions`, insere linha em `agent_turn_events`.
- WhatsApp: em `whatsapp-send`, ao processar `outbound_messages` com `metadata.artifact_id`, atualiza `artifact_status='delivered'|'failed'` no evento vinculado (via `run_id`).

### 1.3 Dashboard admin `/admin/ia/observabilidade`
Nova aba dentro de `IAInteligencia.tsx`, cards mobile-first:
- **Volume**: turnos/dia por canal (linha empilhada).
- **Latência**: p50/p95 por stage (heatmap).
- **Custo**: USD/dia por modelo + custo médio por turno.
- **Ferramentas**: top-10 tools por chamadas, taxa de fallback.
- **Artefatos**: gerados vs entregues vs falhos por canal.
- **Fórmulas em produção**: versão ativa por tool com contagem de uso.

Fonte: RPC `admin_turn_events_agg(from, to, granularity)` retornando JSON agregado; sem exposição de PII.

---

## 2. Calibração de categorização

### 2.1 Métricas persistidas
Nova tabela `categorization_metrics_daily` (materializada por job diário `categorization-metrics-tick`):
- `date`, `total_tx`, `auto_applied`, `suggested`, `uncategorized`, `user_corrected_within_7d`, `coverage_pct`, `precision_proxy_pct` (1 − correções/auto_applied), `correction_rate_pct`, `sem_categoria_pct`, por `category_source` (rule/history/alias/llm).

### 2.2 Job de correção observada
`supabase/functions/categorization-metrics-tick/index.ts`: para cada `transaction` com `category_source ∈ {rule, history, llm}` cuja `category_id` foi alterada pelo usuário em ≤ 7 dias, marca `user_edited_at` e `previous_category_id`. Alimenta tabela.

### 2.3 Thresholds dinâmicos
Substituir constantes em `_shared/categorization/pipeline.ts` por leitura de `platform_public_config` (`categorization.thresholds`): `{ AUTO, SUGGEST, per_source: { rule, history, alias, llm } }`. Default preserva `0.85`/`0.6`.

Painel admin `/admin/ia/categorizacao`:
- Linha do tempo de cobertura, precisão-proxy, correção, sem-categoria.
- Sliders por source com preview do impacto simulado (recomputa em amostra dos últimos 30 dias antes de salvar).
- Botão "Salvar thresholds" grava em `platform_public_config` com audit em `platform_admin_audit`.

### 2.4 Ciclo de vida do alias
`merchant_aliases`: gatilho — quando ≥3 correções do usuário para o mesmo `normalized_pattern → category_id`, insere alias com `confidence=0.9` e `confirmed_by_user_at=now()`. Já reflete no pipeline via estágio `alias`.

---

## 3. Reconciliação e invariantes contábeis

### 3.1 Módulo `_shared/engine/reconciliation.ts`
Função `assertInvariants(txs, options)` que retorna `{ ok, violations[] }`. Invariantes:
- **Transferências**: soma por `transfer_group_id` = 0; exatamente uma perna `expense` + uma `income`; contas distintas.
- **Investimentos**: para cada `investment_movement`, existe transação espelho com `movement_kind='investment_in|out'` e mesmo valor absoluto; saldo do investimento nunca negativo.
- **Cartões**: soma de `payment_method='credit_card'` do ciclo = valor da transação `movement_kind='card_payment'` que quita (`settles_card_id`, ciclo).
- **Reembolsos/estornos**: `movement_kind='refund'` deve referenciar transação original (`refunds_transaction_id`) e não exceder seu valor; par gera saldo neutro na conta.
- **Consistência de sinal**: `expense.amount > 0` e `income.amount > 0`; conta não pode ficar com saldo derivado inconsistente com `initial_balance + Σledger`.

### 3.2 Gate no motor analítico
Antes de produzir número em `compare_periods`, `forecast_month_close`, `explain_spending_change`, `project_goal_completion`: rodar `assertInvariants` na janela consultada. Se `violations.length > 0`, tool retorna `{ ok: false, error: 'reconciliation_failed', violations, provenance }` — LLM é instruída a explicar a inconsistência ao usuário em vez de inventar número.

### 3.3 Job diário `reconciliation-tick`
Varre últimas 24h de cada usuário ativo, grava violações em nova tabela `reconciliation_issues` (`user_id`, `kind`, `entity_id`, `severity`, `detected_at`, `resolved_at`). Expõe em `/admin/operacao` (contagem por tipo) e na Home do usuário como aviso não-bloqueante quando `severity='high'`.

### 3.4 Testes automatizados (Vitest)
- `src/test/reconciliation-transfers.test.ts`
- `src/test/reconciliation-investments.test.ts`
- `src/test/reconciliation-cards.test.ts`
- `src/test/reconciliation-refunds.test.ts`
- `src/test/reconciliation-gate-analytics.test.ts` — garante que `compare_periods` bloqueia quando invariantes falham.

Fixtures reaproveitam `src/test/fixtures/financial_ecosystem_v2.json`.

---

## 4. Artefatos como mídia no WhatsApp

### 4.1 Renderizador server-side
Novo edge function `artifact-render` (`supabase/functions/artifact-render/index.ts`):
- Entrada: `artifact_id`.
- Lê `agent_artifacts.spec` (contrato `ChartArtifact` já compartilhado).
- Renderiza para PNG usando `npm:@napi-rs/canvas` (bar/line/donut/waterfall) — sem dependência de headless browser.
- Faz upload em bucket `artifacts` (privado), gera signed URL de 24h, grava em `agent_artifacts.media_url`, `media_kind='image/png'`, `rendered_at`.
- Fallback PDF (multi-página) para artefatos com `sections.length > 1`, via `pdf-lib`.

### 4.2 Envio pelo WhatsApp
- `_shared/messaging/waha.ts`: adicionar `sendImage(to, mediaUrl, caption)` e `sendDocument(to, mediaUrl, filename, caption)`.
- `whatsapp-send`: se `outbound_messages.metadata.artifact_id` presente, tenta `artifact-render` (síncrono, com timeout 8s). Sucesso → `sendImage` com legenda = resumo textual do artefato (`artifact.summary_text`). Falha/timeout → envia somente texto (`fallback_text` do artefato) e marca `artifact_status='failed'`.
- `outbound_messages`: novas colunas `media_url`, `media_kind`, `artifact_id` (já parcialmente adicionadas na rodada anterior — completar migration se faltar).

### 4.3 Paridade de fatos
`ChartArtifact.spec` já carrega `provenance` completo (fórmula, período, confiança). O rodapé da legenda no WhatsApp e o `ChartArtifactRenderer` do app exibem o mesmo bloco de providência: `"Fórmula vX · N lançamentos · confiança: alta"`. Garantido por teste `src/test/artifact-parity.test.ts` que compara render app vs metadados PNG.

### 4.4 Falhas e observabilidade
- Cada tentativa registra `artifact_status` no `agent_turn_events`.
- Painel admin § 1.3 mostra taxa de entrega por canal.
- Se `artifact_status='failed'` em 3 turnos consecutivos de um usuário, alerta em `provider_health_events`.

---

## Detalhes técnicos e migrações

```text
Migrations aditivas:
  1. create table agent_turn_events (+ RLS, GRANTs, índices por created_at, user_id, channel)
  2. create table categorization_metrics_daily (+ índice por date)
  3. alter transactions add column user_edited_at timestamptz, previous_category_id uuid
  4. alter merchant_aliases add trigger para autoconfirmar após 3 correções
  5. create table reconciliation_issues (+ RLS user pode ver as suas)
  6. alter outbound_messages add media_url text, media_kind text, artifact_id uuid (se faltar)
  7. alter agent_artifacts add media_url, media_kind, rendered_at, summary_text, fallback_text
  8. platform_public_config: seed 'categorization.thresholds'
  9. create bucket artifacts (privado) + policies (service_role write, owner read via signed URL)

Edge functions novas:
  - artifact-render
  - categorization-metrics-tick (cron 1h)
  - reconciliation-tick (cron 6h)

Edge functions alteradas:
  - whatsapp-send (branch de mídia + artefato)
  - agent-chat / AgentCore (grava agent_turn_events, artifact_status)
  - _shared/agent/tools.ts (gate de invariantes)

Frontend:
  - src/pages/admin/IAInteligencia.tsx: abas "Observabilidade", "Categorização"
  - src/pages/admin/Operacao.tsx: card "Reconciliação"
  - src/components/home/ReconciliationBanner.tsx (severity high)

Testes (Vitest):
  - reconciliação (5 arquivos § 3.4)
  - categorization-thresholds-config.test.ts
  - observability-turn-event.test.ts
  - artifact-render-contract.test.ts
  - whatsapp-send-media.test.ts
```

### Ordem de execução sugerida
1. Migrations + tabelas de eventos.
2. Instrumentação `Observability`/`DecisionLogger` + admin dashboard.
3. Módulo de reconciliação + gate nas tools + testes.
4. Métricas de categorização + thresholds dinâmicos.
5. `artifact-render` + integração `whatsapp-send` + testes de mídia.
6. QA end-to-end: turno no app com artefato → mesmo turno no WhatsApp → verificar `agent_turn_events`, artefato entregue, fórmula/providência idênticas.

### Fora de escopo
- Recharts server-side (usaremos canvas nativo).
- Alteração no motor analítico já entregue (apenas adiciona gate).
- Landing page.
- Modelos preditivos além dos 3 já existentes.
