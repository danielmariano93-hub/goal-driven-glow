# Meu Nino Control Center — Plano Final Executável

**Status:** READY_TO_EXECUTE_ALL_PHASES
**Escopo:** transformar o painel administrativo atual no Meu Nino Control Center em 5 fases sequenciais com gates. Nenhuma implementação nesta etapa.
**Nada foi modificado** no código, banco, migrations, edge functions, configurações ou publicação. Apenas `.lovable/plan.md` foi atualizado.

---

## 1. Resumo executivo

O painel administrativo atual (rotas `/admin/*`) foi construído como inventário de contagens, expõe PII (email, nome, previews de mensagens, telefone parcial) em RPCs padrão, aplica RBAC apenas cosmeticamente no frontend, não possui camada de eventos de produto e mistura métricas técnicas (IA/OCR) com métricas de produto. A auditoria confirmou:

- 24 RPCs `admin_*` no banco, todos gated apenas por `is_platform_admin()` (booleano single-role).
- `admin_users_list` retorna `email` e `display_name`; `admin_message_activity` retorna `preview` (200 chars do body), `to_phone` mascarado e faz `ILIKE '%…%'` sobre `body` e `to_phone`; `admin_conversation_activity` retorna `contact` e `preview` de 240 chars.
- Enum `platform_role = {platform_owner, platform_admin, support, analyst}` já existe. `platform_admins` e `platform_admin_audit` já existem.
- Não existe `has_platform_permission`, nem `product_events`, nem `user_pseudonyms`, nem agregados de produto.
- Timeout de sessão do admin ainda é 30 min (herda `SessionInactivityGuard` default sem override).
- `AdminLayout` já tem sidebar Deep Ink e SessionGuard aplicado; rotas atuais são planas (sem hierarquia `/operacao/*`, `/governanca/*`).

O plano organiza a reforma em 5 fases; a Fase 1 (Privacidade + RBAC + Timeout) é bloqueadora e deve ser aplicada antes de qualquer redesign visual. Todas as decisões técnicas de política fechadas no briefing (RBAC, break-glass, pseudonimização, WVU, ativação 7d, timeout 20min, insights não-causais, buckets monetários) estão consolidadas aqui e não voltam a discussão.

---

## 2. Auditoria completa — evidências

### 2.1 RPCs administrativos existentes (CONFIRMADO NO BANCO)

Consulta: `SELECT proname FROM pg_proc … WHERE proname LIKE 'admin_%'`

```
admin_agent_stats, admin_approve_deletion_request, admin_consumer_users_set,
admin_conversation_activity, admin_dashboard_stats, admin_document_metrics,
admin_engagement_stats, admin_list_platform_admins, admin_message_activity,
admin_message_metrics, admin_message_reprocess, admin_message_timeline,
admin_ops_health, admin_platform_status, admin_process_deletion_request,
admin_rate_check, admin_reject_deletion_request, admin_reprocess_failed,
admin_run_check, admin_users_list, admin_waha_config_status,
admin_waha_resolve_config, admin_waha_save_config, admin_whatsapp_inbound_health
```

Todos verificados em `pg_get_functiondef`: cada um começa com `IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'` — nenhum diferencia entre `platform_owner`, `platform_admin`, `support`, `analyst`. A matriz em `src/lib/admin/permissions.ts` (86 linhas, 4 roles × 22 ações) é 100% cosmética.

### 2.2 PII vazada em RPCs padrão (CONFIRMADO NO BANCO)

Trechos extraídos com `pg_get_functiondef`:

- `admin_conversation_activity` linha 17-18:
  ```sql
  THEN '***' || right(c.phone_e164,4) ELSE NULL END AS contact,
  left(regexp_replace(m.body_masked, E'[\\n\\r]+', ' ', 'g'), 240) AS preview
  ```
- `admin_message_activity` linhas 79-96:
  ```sql
  CASE WHEN length(coalesce(o.to_phone,'')) >= 4
       THEN '***' || right(o.to_phone, 4) …
  left(regexp_replace(coalesce(o.body,''), …), 200) AS preview,
  … o.body ILIKE '%'||p_search||'%' OR o.to_phone ILIKE …
  ```
- `admin_users_list` linhas 129-148:
  ```sql
  RETURNS TABLE(user_id uuid, email text, display_name text, …)
  … c.email, p.display_name … OR c.email ILIKE … OR display_name ILIKE …
  ```

**Impacto:** qualquer `platform_role` (inclusive `analyst`) invoca esses RPCs diretamente pelo cliente Supabase e recebe PII. Isto viola o princípio "PII fora do fluxo padrão".

Consumo confirmado no frontend em `src/pages/admin/Mensagens.tsx` e `Usuarios.tsx` (renderiza `preview`, `email`, `display_name`).

### 2.3 Enums, tabelas e ausências (CONFIRMADO NO BANCO)

- `platform_role` enum: `{platform_owner, platform_admin, support, analyst}` ✅.
- `platform_admins(user_id uuid PK, role platform_role, active bool, …)` ✅ — 1 registro.
- `platform_admin_audit(id, actor_user_id, target_user_id, action text, meta jsonb, created_at)` ✅ — existe mas granularidade fraca (sem `reason`, `ticket`, `request_id`, `expires_at`).
- **NÃO EXISTE:** `platform_permissions`, `has_platform_permission`, `user_pseudonyms`, `break_glass_sessions`, `product_events`, `product_daily_value`, `outbound_metrics_daily`, `agent_metrics_daily`, `feature_funnel_daily`, `product_cohorts_weekly`, `user_lifecycle_daily`.

### 2.4 Frontend admin — inventário (CONFIRMADO NO CÓDIGO)

Rotas registradas em `src/App.tsx:127-144`:

```
/admin (index → VisaoGeral), /admin/usuarios, /admin/engajamento,
/admin/financeiro, /admin/agente, /admin/agente/simulador,
/admin/mensagens, /admin/ia, /admin/whatsapp, /admin/operacao,
/admin/produto, /admin/seguranca, /admin/configuracoes
```

Guard: `PlatformAdminRoute` → `supabase.rpc("current_platform_admin_role")`. Retorna qualquer role não-nula como acesso liberado (não valida ação).

Timeout: `AppLayout` e `AdminLayout` usam `<SessionInactivityGuard>` **sem props**. Default em `useSessionInactivity.ts:48`: `idleMs ?? 30 * 60 * 1000`. **Admin herda os 30 min do app** — não há override para 20 min. Contradiz decisão fechada.

### 2.5 Fontes analíticas disponíveis (CONFIRMADO NO BANCO)

Utilizáveis hoje sem backfill inventado:

- `agent_runs(status, path, intent_requested, intent_served, tools_used, formula_versions, tokens_in, tokens_out, latency_ms, started_at, ended_at, cost_cents?)` — base p/ IA metrics.
- `outbound_messages(status, channel, surface, feature, sent_at, delivered_at, read_at, accepted_at, attempts, last_error)` — base p/ mensageria e entrega.
- `document_imports(status, error_code, processed_at, item_count, …)` — base p/ OCR.
- `transactions`, `goals`, `shared_expenses`, `shared_expense_participants`, `recurring_rules` — base p/ eventos de negócio via backfill determinístico.
- `agent_turn_events`, `document_processing_events`, `provider_health_events`, `message_delivery_events`, `shared_expense_events` — eventos técnicos já parciais, não canônicos p/ produto.

**Não existe** instrumentação de: descoberta, início/abandono de fluxo, `insight_delivered`, `forecast_delivered`, `personalized_response_delivered`, `goal_progress_explained`, `split_result_delivered`, `split_reminder_prepared`.

### 2.6 Legado desalinhado

- `admin_ops_health.imports_recent` lê `import_batches` (legado) enquanto Pipeline Documental v2 grava em `document_imports`. Métrica subestimada.
- `admin_engagement_stats` retorna `activation_first_transaction`, `activation_first_goal`, `activation_whatsapp` sem janela de 7d — cumulativo, não coorte.

---

## 3. Drift migrations × banco aplicado

Comparação executada com `pg_get_functiondef` e leitura da última migration relevante (`20260724025327_*`):

- Todos os RPCs listados em §2.1 têm definição idêntica à última migration que os criou. **Sem drift funcional detectado**.
- `platform_admins`, `platform_admin_audit`, enum `platform_role` batem com migrations históricas.
- **Dívida de migration:** `admin_ops_health.imports_recent` nunca foi atualizado após a introdução de `document_imports` (v2). Precisa ser refatorado (Fase 2, junto do novo `admin_operations_health_v2`).
- **Dívida de escopo:** matriz `MATRIX` no frontend descreve 4 roles × 22 ações que o servidor não conhece. Não é drift SQL, é dívida arquitetural.

---

## 4. Inventário de páginas, componentes, RPCs, tabelas e PII

### 4.1 Páginas admin atuais → destino

| Atual | Destino Control Center | Ação |
| --- | --- | --- |
| `VisaoGeral.tsx` | `/admin/cockpit` (`Cockpit.tsx` novo) | manter 1 release para rollback, deprecar |
| `Engajamento.tsx` | `/admin/crescimento` (`Crescimento.tsx` novo) | recriar, deprecar |
| `Usuarios.tsx` | `/admin/clientes` (`Clientes.tsx` novo) | recriar pseudonimizado |
| `Mensagens.tsx` | `/admin/operacao/mensageria` | recriar sem preview/telefone |
| `IAInteligencia.tsx` | `/admin/operacao/ia-ocr` (só OCR/IA técnico) + parte agregada vai p/ `/admin/inteligencia-produto` | dividir, remover inspetor individual |
| `Produto.tsx` | `/admin/governanca/configuracoes` | mover |
| `Financeiro.tsx` | `/admin/receita` | recriar, separar IA de negócio |
| `Seguranca.tsx` | `/admin/governanca/seguranca` | expandir (break glass) |
| `Configuracoes.tsx` | `/admin/governanca/configuracoes` (mesclar c/ Produto) | fundir |
| `Operacao.tsx` | `/admin/operacao/saude` | recriar |
| `Agente.tsx` | `/admin/operacao/assistente` | mover |
| `AgenteSimulador.tsx` | `/admin/operacao/assistente/simulador` | mover |
| `WhatsApp.tsx` + `WhatsAppSessionPanel.tsx` | `/admin/operacao/whatsapp` (aba Monitoramento + Configuração) | reorganizar em 2 abas |

Nova página **`InteligenciaProduto.tsx`** não existe hoje — criar do zero.

### 4.2 Componentes admin reutilizáveis (já existem)

`AdminLayout, AdminSkeleton, DataTable, EmptyState, FilterBar, PageHeader, Section, StatCard, StatusChip, WhatsAppValidateCard, AdminErrorBoundary, adminToast, useAdminDocumentTitle`. **A criar:** `KpiCard` (com delta/sparkline/polaridade/tooltip), `AttentionFeed`, `MetricTooltip`, `SampleBadge`, `BreakGlassBanner`, `BreakGlassRequestModal`, `PseudoIdChip`, `CohortHeatmap`, `FunnelChart`, `SparklineMini`, `AnnotationLayer`, `FreshnessLabel`.

### 4.3 Inventário de PII em RPCs atuais

| RPC | PII exposta | Ação Fase 1 |
| --- | --- | --- |
| `admin_users_list` | email, display_name | RENAME → `admin_clientes_list_v2` sem PII (retorna `pseudo_id`, estágio, datas, `whatsapp_linked`); manter versão antiga com grant restrito a break-glass |
| `admin_message_activity` | preview, to_phone mascarado, body ILIKE | criar `admin_messaging_activity_v2` sem preview/telefone; remover ILIKE em body |
| `admin_conversation_activity` | contact, preview | idem — `admin_conversations_v2` só metadados |
| `admin_message_timeline` | body indireto via join | validar; retornar só eventos técnicos |
| `admin_dashboard_stats` | contagens agregadas ok | manter transitoriamente, marcar deprecated |
| `admin_engagement_stats` | contagens ok | substituir por `admin_growth_v2` com janelas coorte |
| `admin_ops_health` | usa `import_batches` legado | substituir por `admin_operations_health_v2` |
| Demais `admin_*` | metadados | manter, adicionar gate `has_platform_permission` |

Nenhum outro campo listado no §6 do briefing (saldo, patrimônio, renda, poupança, risco, categorias, descrições, memória, preferências, decisões, sugestões, Pix, conta) aparece em RPCs admin_* atuais — CONFIRMADO por leitura das definições. Blindagem preventiva: novos RPCs não devem selecioná-los.

---

## 5. Matriz atual de permissões e falhas

**Atual (código):** `src/lib/admin/permissions.ts` MATRIX 4 roles × 22 ações. Nunca consultada pelo servidor.

**Atual (servidor):** único gate `is_platform_admin()` retorna `EXISTS(SELECT 1 FROM platform_admins WHERE user_id=auth.uid() AND active)`.

**Falha crítica:** um analyst pode chamar `supabase.rpc('admin_message_reprocess', { p_id: … })` diretamente pelo navegador e reprocessar mensagens; pode chamar `admin_users_list` e receber emails. A UI esconder o botão não protege nada.

**Alvo (Fase 1):** tabela `platform_permissions(role platform_role, action text, allowed bool, PRIMARY KEY(role, action))` + função `public.has_platform_permission(action text) RETURNS bool` (SECURITY DEFINER, `SET search_path=public`, cacheável, consulta `platform_admins` + `platform_permissions`). Cada RPC começa com `IF NOT has_platform_permission('<action>') THEN RAISE EXCEPTION 'not_authorized'`. Matriz frontend consulta espelho lido via RPC `current_platform_permissions()` (retorna set de ações permitidas ao caller); nunca decide sozinha.

Ações canônicas (fechadas no briefing §4.1):

```
overview.read, growth.read, product_intelligence.read,
operations.read, operations.retry,
whatsapp.read, whatsapp.manage,
assistant.read, assistant.publish,
clients.read, clients.read_pii,
revenue.read,
product_config.read, product_config.manage,
security.read, security.manage_admins,
security.break_glass.open, security.break_glass.read_email,
security.break_glass.read_message, security.break_glass.audit,
users.process_deletion, audit.read
```

Semeadura inicial (fechada):

- `platform_owner`: todas.
- `platform_admin`: todas **exceto** `security.manage_admins` restrito ao owner e `security.break_glass.*` restrito ao owner nesta v1.
- `support`: `overview.read, operations.read, operations.retry, whatsapp.read, clients.read, product_intelligence.read` (agregado), sem `.read_pii`, sem `revenue.*`, sem `assistant.publish`, sem `whatsapp.manage`.
- `analyst`: `overview.read, growth.read, product_intelligence.read, revenue.read, security.read, audit.read`. Sem `clients.read` individual, sem operações.

---

## 6. Arquitetura final de rotas

```
/admin                         → redirect(/admin/cockpit, replace)
/admin/cockpit
/admin/crescimento
/admin/inteligencia-produto
/admin/operacao/saude
/admin/operacao/mensageria
/admin/operacao/ia-ocr
/admin/operacao/whatsapp
/admin/operacao/assistente
/admin/operacao/assistente/simulador
/admin/clientes
/admin/receita
/admin/governanca/configuracoes
/admin/governanca/seguranca
/admin/governanca/auditoria
```

Redirects (feature-flagged, duram 1 release, testados contra loops):

```
/admin                   → /admin/cockpit
/admin/engajamento       → /admin/crescimento
/admin/usuarios          → /admin/clientes
/admin/mensagens         → /admin/operacao/mensageria
/admin/operacao          → /admin/operacao/saude
/admin/ia                → /admin/operacao/ia-ocr
/admin/whatsapp          → /admin/operacao/whatsapp
/admin/agente            → /admin/operacao/assistente
/admin/agente/simulador  → /admin/operacao/assistente/simulador
/admin/financeiro        → /admin/receita
/admin/produto           → /admin/governanca/configuracoes
/admin/seguranca         → /admin/governanca/seguranca
/admin/configuracoes     → /admin/governanca/configuracoes
```

Regras fechadas: `Cockpit.tsx` **novo** (não renomeia `VisaoGeral.tsx`); `VisaoGeral.tsx` fica no repositório 1 release para rollback via flag; `Produto.tsx` movido para Governança > Configurações; `IAInteligencia.tsx` **não** vira OCR — desmembrada; nenhuma rota antiga responde por 2 novas.

---

## 7. Modelo de pseudonimização

Tabela `user_pseudonyms`:

```
id uuid PK default gen_random_uuid()
user_id uuid UNIQUE NULL REFERENCES auth.users(id) ON DELETE SET NULL
pseudo_id uuid UNIQUE NOT NULL default gen_random_uuid()
created_at timestamptz not null default now()
detached_at timestamptz null
```

Grants: `service_role` ALL; `authenticated` sem SELECT. RLS bloqueia leitura direta.

Funções SECURITY DEFINER:

- `resolve_pseudo_id(p_user_id uuid) RETURNS uuid` — chamada por triggers/emissores de eventos; cria a associação se não existir.
- `admin_resolve_user_by_pseudo(p_pseudo uuid, p_reason, p_ticket) RETURNS uuid` — só para break-glass; exige `has_platform_permission('security.break_glass.read_email')` + sessão break-glass ativa; auditado.

Exclusão de conta (RPC `admin_process_deletion_request`): setar `user_id = NULL`, `detached_at = now()`. `pseudo_id` persiste em agregados; reidentificação futura impossível.

---

## 8. RBAC + Break-glass

### 8.1 Tabelas

```
platform_permissions(role platform_role, action text, allowed bool,
                     PRIMARY KEY(role, action))
break_glass_sessions(
  id uuid PK, admin_user_id uuid NOT NULL,
  target_pseudo_id uuid NOT NULL,
  fields text[] NOT NULL,           -- allowlist: email, message_body, phone
  reason text NOT NULL CHECK (length(reason) >= 20),
  ticket text NOT NULL,
  opened_at timestamptz NOT NULL default now(),
  expires_at timestamptz NOT NULL,  -- opened_at + interval '15 min'
  revoked_at timestamptz NULL,
  revoked_reason text NULL,
  reauth_at timestamptz NOT NULL,
  request_id text NULL,
  UNIQUE (admin_user_id, target_pseudo_id) WHERE revoked_at IS NULL AND expires_at > now()
)
platform_admin_audit  -- estender com: request_id, reason, ticket, resource, break_glass_id
```

### 8.2 Regras fechadas (recap para execução)

- Só `platform_owner` abre break-glass (permissão `security.break_glass.open`).
- Reauth ≤ 5 min (validar `auth.jwt() -> 'auth_time'` ou reautenticação explícita registrada).
- Reason mínimo 20 chars; ticket obrigatório.
- Escopo: 1 pseudo_id, subset explícito de `fields`.
- TTL 15 min, 1 sessão ativa por (admin, alvo); revogação manual.
- Cada leitura sob break-glass auditada (admin, pseudo, campo, timestamp, request_id, break_glass_id). Log **não** contém o conteúdo lido.
- Banner persistente na UI enquanto sessão ativa; encerramento automático em expiração ou logout.
- Sem export em massa, sem listagem.

### 8.3 Funções

- `admin_open_break_glass(p_pseudo uuid, p_fields text[], p_reason text, p_ticket text) RETURNS uuid`
- `admin_close_break_glass(p_id uuid, p_reason text)`
- `admin_break_glass_read(p_id uuid, p_field text) RETURNS jsonb` — valida sessão ativa, campo no allowlist, permissão específica; audita antes de retornar.
- `admin_break_glass_active() RETURNS SETOF break_glass_sessions`

### 8.4 Sessão administrativa

- `SessionInactivityGuard` recebe props `idleMs`, `warningMs`.
- `AdminLayout` passa `idleMs = 20*60*1000`, `warningMs = 18*60*1000`.
- `AppLayout` mantém defaults (30 min).
- BroadcastChannel já sincroniza entre abas (confirmado em `useSessionInactivity.ts`).
- Modal com contagem regressiva, "Continuar conectado" (renova só após clique) e "Sair agora".
- Ao voltar de suspend/background: validar sessão via `supabase.auth.getSession()` antes de renderizar dados.
- Ações críticas: exigir `reauth_at` ≤ 5 min em RPC (novo helper `require_recent_reauth()`).

---

## 9. Taxonomia e máquinas de estado por experiência

Cada experiência declara: eventos emitidos, emissor real, idempotency key, regra de sucesso e possibilidade de backfill.

### 9.1 Registro financeiro

Eventos: `financial_record_started`, `financial_record_created`, `financial_record_validation_failed`, `financial_record_abandoned`, `financial_record_corrected`.
- Emissor: trigger `AFTER INSERT ON transactions` (created); frontend (started/abandoned via `feature=quick_log|form|voice`).
- Idempotency: `transactions.id` para `created`; `session_id + form_open_at` para `started/abandoned`.
- Sucesso: `financial_record_created` com `status='confirmed'`.
- Backfill: `financial_record_created` derivável 100% de `transactions` (`event_source='backfill'`, confidence=high).

### 9.2 Edição/categorização

Eventos: `financial_record_edited`, `category_changed`, `category_suggestion_shown`, `category_suggestion_accepted`, `category_suggestion_rejected`.
- Emissor: trigger + frontend (sugestões).
- Idempotency: `transaction_id + version`.
- Sucesso: `category_changed` distinto da categoria anterior.
- Backfill: parcial via `transactions.updated_at != created_at`.

### 9.3 Meta

Eventos: `goal_created`, `goal_updated`, `goal_contribution_added`, `goal_progress_explained` (valor), `goal_completed`, `goal_abandoned`.
- Emissor: trigger `goals` + `goal_contributions`; `goal_progress_explained` emitido pelo agente após tool `explain_goal_progress` responder com artefato.
- Sucesso: `goal_progress_explained` conta para WVU-B; `goal_contribution_added` para WVU-A.
- Backfill: `goal_created/updated/contribution_added` deterministicamente; `progress_explained` NÃO (sem evidência).

### 9.4 Divisão do Rolê

Eventos: `split_started`, `split_created`, `split_result_delivered`, `split_payment_marked`, `split_cancelled`.
Idempotency: `shared_expenses.id`. Sucesso: `split_created` (elegibilidade+início) + `split_result_delivered` (valor).
Backfill: `created` via `shared_expenses`; `result_delivered` só se houver `outbound_messages.feature='split_result'` correspondente.

### 9.5 Lembrete da divisão

Eventos: `split_reminder_scheduled`, `split_reminder_prepared`, `split_reminder_sent`, `split_reminder_failed`.
Emissor: job `split-reminders-dispatch` + trigger `outbound_messages`.
Sucesso: `split_reminder_prepared` (contexto válido) → `split_reminder_sent` (`outbound.status='sent'`).
Backfill: `sent/failed` via `outbound_messages` filtro `feature='split_reminder'`.

### 9.6 OCR/documento

Eventos: `document_uploaded`, `document_processing_started`, `document_processed`, `document_processing_failed`, `document_confirmed`, `document_rejected`.
Emissor: trigger `document_imports` + edge `assistant-ingest-document`.
Sucesso: `document_processed` com `status='succeeded'` + `document_confirmed`.
Backfill: total via `document_imports`.

### 9.7 Resposta do agente

Eventos: `agent_intent_requested`, `agent_intent_served`, `agent_intent_unsupported`, `agent_run_failed`, `agent_response_delivered`, `personalized_response_delivered`, `insight_delivered`, `forecast_delivered`.
Emissor: `agent-run` / `agent-chat` edge functions.
Sucesso (regra fechada): `agent_run.status='done'` NÃO conta sozinho. Sucesso = `intent_served AND NOT error AND response_delivered_event_emitted`.
Backfill: `intent_requested/served/run_failed` via `agent_runs`; `insight/forecast/personalized_delivered` NÃO backfillável.

### 9.8 Mensagem WhatsApp

Eventos: `outbound_queued`, `outbound_sent`, `outbound_delivered`, `outbound_read`, `outbound_failed`, `outbound_retried`.
Emissor: trigger `outbound_messages` transitions.
Idempotency: `outbound_messages.id + status`.
Backfill: total via `outbound_messages`.

---

## 10. Matriz fonte-atual × fonte-futura × backfill

| Métrica | Fonte hoje | Fonte canônica (Fase 2+) | Backfill válido? |
| --- | --- | --- | --- |
| Usuários totais | `admin_dashboard_stats` (`profiles`) | `user_lifecycle_daily.new_users` | Sim |
| Novos 7/30d | idem | idem | Sim |
| Onboarding concluído | `profiles.onboarding_completed_at` | `user_lifecycle_daily.onboarded` | Sim |
| DAU/WAU/MAU | `admin_engagement_stats` (`agent_runs` proxy) | `product_daily_value` (interações válidas) | Parcial — histórico marcado `event_source=backfill_proxy`, série separada |
| Ativação (7d) | não existe | `user_lifecycle_daily.activated_7d` (cadastro + onboarding + 1º registro + 1 valor em ≤7d) | Sim para eligíveis com janela fechada |
| WVU | não existe | `product_daily_value.wvu_7d` (rolling 7d, A ∧ B) | Não canônico. Série "estimativa anterior" opcional |
| Retenção W1/W4/W8 | não existe | `product_cohorts_weekly` | Só para coortes ativadas com maturação |
| Entrega WhatsApp (%) | derivável de `outbound_messages` | `outbound_metrics_daily.delivery_rate` | Sim |
| p50/p95 mensageria | não existe | `outbound_metrics_daily.p50_ms, p95_ms` | Sim (via `outbound_messages` timestamps) |
| p50/p95 agente | `agent_runs.latency_ms` | `agent_metrics_daily` | Sim |
| Custo por sucesso IA | não existe | `agent_metrics_daily.cost_cents / success_count` | Sim |
| Custo por WVU | não existe | `agent_metrics_daily.cost_cents / product_daily_value.wvu_7d` | Parcial |
| Receita/margem | não existe | integração externa (fase 5); até lá `—` | Não |
| Importações recentes | `import_batches` (legado) | `document_imports` | Sim |

---

## 11. Fórmulas e regras de exibição (envelope canônico)

Todo RPC analítico retorna:

```jsonc
{
  "value": number|null,
  "numerator": number|null,
  "denominator": number|null,
  "previous": number|null,
  "delta_abs": number|null,
  "delta_pct": number|null,      // usar somente se previous>0 e métrica é contagem
  "delta_pp": number|null,       // usar para taxas (pontos percentuais)
  "delta_kind": "pct"|"pp"|"absolute"|"new"|"no_change"|"no_data",
  "sample_size": number,
  "sufficient_sample": boolean,
  "sample_label": "sinal_inicial"|"amostra_insuficiente"|"ok",
  "polarity": "positive"|"negative"|"neutral"|"unknown",
  "formula_version": "vX.Y",
  "computed_at": "ISO8601",
  "timezone": "America/Sao_Paulo",
  "measurement_started_at": "ISO8601",
  "data_quality": "canonical"|"backfill_proxy"|"insufficient",
  "source_kind": "event"|"aggregate"|"legacy"
}
```

Regras:
- `atual=0 ∧ anterior=0` → `no_change`.
- `anterior=0 ∧ atual>0` → `new`.
- `denominador=0` → `value=null, delta_kind=no_data`, UI mostra `—`.
- Taxas usam p.p.; contagens usam %.
- `sufficient_sample=false` ⇒ polarity forçado a `unknown`; cor neutra; sem afirmação de melhora/piora.
- Métricas neutras (volume) → Violet/cinza. Coral só p/ degradação; Mint só p/ recuperação.
- Seta = movimento bruto; cor = interpretação.

Anomalias:
- Baseline = mediana do mesmo dia da semana nas 4 semanas anteriores; fallback = mediana 7d anteriores.
- Alerta somente com `|desvio| ≥ 30%` AND `|diff| ≥ 3` AND `baseline ≥ 10`.
- 30-49% info · 50-79% atenção · ≥80% crítico. Indisponibilidade técnica ignora amostra mínima.

Amostras (recap fechado):
- Segmento: k ≥ 10. 10-19 → `sinal_inicial`.
- Associação com retenção: ≥ 20/grupo.
- Fricção de feature: ≥ 20 inícios.
- Necessidade não atendida: ≥ 20 eventos ∧ ≥ 10 usuários ∧ ≥ 10% share.
- Feature emergente: ≥ 20 usuários ∧ crescimento ≥ 30% ∧ ∆abs ≥ 10.

Insights: nunca causalidade. Vocabulário permitido: "está associado a", "coincidiu com", "aparece com maior frequência entre", "merece investigação". Proibido: "causou", "porque", "gera", "prova".

---

## 12. Arquitetura de eventos e agregados

### 12.1 `product_events` (append-only)

```
id uuid PK
event_name text NOT NULL          -- allowlist enforced via CHECK ou trigger
schema_version smallint NOT NULL
pseudo_user_id uuid NOT NULL REFERENCES user_pseudonyms(pseudo_id)
occurred_at timestamptz NOT NULL
received_at timestamptz NOT NULL default now()
channel text NULL                  -- 'app'|'whatsapp'|'system'
surface text NULL
feature text NULL
status text NULL                   -- 'started'|'succeeded'|'failed'|'abandoned'|'cancelled'|'timeout'|'retry'
error_code text NULL
latency_ms integer NULL
provider text NULL
model text NULL
tokens_in integer NULL
tokens_out integer NULL
cost_cents integer NULL
attempt_number smallint NULL
app_version text NULL
event_source text NOT NULL default 'live'  -- 'live'|'backfill'|'backfill_proxy'
properties jsonb NOT NULL default '{}'      -- allowlisted keys only (validated by trigger)
idempotency_key text NOT NULL UNIQUE
```

Índices: `(pseudo_user_id, occurred_at DESC)`, `(event_name, occurred_at)`, `(feature, occurred_at)`, `(status, occurred_at)`.

Proibido em `properties` (validado por trigger `product_events_validate`): PII, texto livre, mensagem, descrição, valor bruto, saldo, chave Pix, telefone, email, nome. Valores monetários usam buckets `0_50, 50_100, 100_250, 250_500, 500_plus`.

RLS: SELECT bloqueado a `authenticated` (apenas via RPCs agregadores); INSERT via `service_role` (edge/trigger).

### 12.2 Agregados físicos

Tabelas (não MV): `product_daily_value`, `outbound_metrics_daily`, `agent_metrics_daily`, `feature_funnel_daily`, `product_cohorts_weekly`, `user_lifecycle_daily`.

Refresh:
- Job cron `product-aggregates-refresh` a cada 15 min: incremental últimos 3 dias.
- Job diário: rebuild da janela completa (últimos 90 dias raw + coortes 12 semanas).
- Idempotente (upsert por chave natural).
- `job_heartbeats` já existe — usar para health check e `freshness_seconds` retornado no RPC.

Retenção: `product_events` 90d; agregados perpétuos; `platform_admin_audit` mínimo 2 anos; break-glass logs mínimo 2 anos.

Backfill (Fase 2): job `product-events-backfill` uma vez, deriva eventos de `transactions, goals, shared_expenses, document_imports, outbound_messages, agent_runs`. `event_source='backfill'`, idempotency determinística. **Não** deriva `insight_delivered`, `forecast_delivered`, `personalized_response_delivered`, `goal_progress_explained`, `split_result_delivered`, `split_reminder_prepared` — série oficial começa na Fase 2.

---

## 13. Contratos dos RPCs futuros

Todos SECURITY DEFINER, `SET search_path = public`, retornam envelope §11 quando analíticos. Prefixo `admin_v2_` para clareza durante convivência.

1. `admin_v2_cockpit(p_range int, p_channel text, p_compare bool)` → jsonb com 4 KPIs (`wvu`, `activation_rate`, `retention_w4`, `experience_success`), série 8 pontos, feed atenção (top 5).
2. `admin_v2_growth_funnel(p_range int)` → etapas ativação, conversão, tempo mediano.
3. `admin_v2_growth_cohorts(p_weeks int)` → matriz W0-W8 por coorte ativada.
4. `admin_v2_growth_signals(p_range int)` → lista de sinais (onboarding parado, WhatsApp sem 1ª interação etc.).
5. `admin_v2_product_features(p_range int)` → adoção por feature (elegíveis, descobriram, iniciaram, concluíram, repetiram).
6. `admin_v2_product_needs(p_range int)` → intents suportadas/parciais/não suportadas/reformuladas (sem texto bruto).
7. `admin_v2_product_opportunities(p_range int)` → oportunidades com amostra específica.
8. `admin_v2_operations_health()` → serviços com estado, sucesso, p50, p95, backlog, heartbeat, freshness.
9. `admin_v2_messaging_activity(p_from, p_to, p_status, p_channel, p_feature, p_error, p_id, p_limit, p_offset)` → só metadados (`id, pseudo_id, direction, channel, feature, status, attempts, latency_ms, created_at, updated_at, error_code, error_sanitized`). **Sem** preview, body, telefone.
10. `admin_v2_messaging_retry(p_id uuid)` → gate `operations.retry` + reauth ≤5 min + audit.
11. `admin_v2_ia_ocr_metrics(p_range int)` → separa IA (sucesso, intents, tools, modelos, p50/p95, tokens, custo) e OCR (docs, sucesso, falhas por causa, confiança, p50/p95, custo).
12. `admin_v2_whatsapp_monitor()` → conexão, entrega, inbound, outbound, p50/p95, heartbeat, erros. Config crítica em RPCs `admin_waha_*` existentes com gate `whatsapp.manage` + reauth.
13. `admin_v2_assistant_health()` → saúde, versão prompt, modelo ativo. Publicação via `agent_prompt_publish` com gate `assistant.publish` + reauth.
14. `admin_v2_clients_list(p_search text NULL, p_lifecycle text NULL, p_limit, p_offset)` → só pseudo_id, estágio, ativação, último evento significativo, dias-com-valor 7/30, WhatsApp linkado, estado do canal, problemas técnicos, tickets. Sem email/nome/telefone.
15. `admin_v2_client_journey(p_pseudo_id uuid)` → jornada técnica pseudonimizada.
16. `admin_v2_revenue_summary(p_range int)` → negócio (só com fonte real; caso contrário `—` + `Fonte financeira ainda não integrada`) + IA (custo total, por sucesso, por WVU, por feature/modelo/provider).
17. `admin_v2_governance_config_list()` / `admin_v2_governance_config_set(p_key, p_value)` — gate `product_config.manage` + audit + reauth.
18. `admin_v2_audit_list(p_range, p_actor, p_action, p_result, p_limit, p_offset)` → gate `audit.read`. Sem conteúdo sensível.
19. `current_platform_permissions()` → `text[]` com ações permitidas ao caller. Consumido pela UI para esconder controles.
20. `has_platform_permission(p_action text)` → bool. Interno.
21. `admin_open_break_glass / admin_close_break_glass / admin_break_glass_read / admin_break_glass_active` (§8.3).

Cache client (React Query): staleTime 1-5 min por tipo; RPCs analíticos incluem `computed_at` e `freshness_seconds`.

---

## 14. Migrations planejadas (Fase por fase, com aceite e rollback)

**Não escrevemos SQL neste plano** — cada migration abaixo tem escopo, aceite e rollback declarados. Nenhuma será aplicada até aprovação de fase.

### Fase 1 — Privacidade e segurança (bloqueadora)

- **M1.1** `platform_permissions` + seed inicial + `has_platform_permission` + `current_platform_permissions`. Rollback: `DROP FUNCTION/TABLE`.
- **M1.2** `user_pseudonyms` + `resolve_pseudo_id` + trigger backfill de `pseudo_id` para usuários existentes. Rollback: `DROP TABLE`.
- **M1.3** `break_glass_sessions` + funções (§8.3) + extensão de `platform_admin_audit` com colunas `reason, ticket, resource, request_id, break_glass_id`. Rollback: `ALTER TABLE DROP COLUMN` + `DROP TABLE`.
- **M1.4** Substituir gate de todos os 24 RPCs `admin_*` de `is_platform_admin()` para `has_platform_permission('<ação>')`. Rollback: reverter definição prévia (snapshot).
- **M1.5** Criar `admin_v2_messaging_activity`, `admin_v2_clients_list`, `admin_v2_operations_health` (sem PII, sobre `document_imports`). Rollback: `DROP FUNCTION`.
- **M1.6** Remover grants EXECUTE dos RPCs legados `admin_message_activity`, `admin_conversation_activity`, `admin_users_list` para roles não-`platform_owner`; owner mantém somente via break-glass. Rollback: `GRANT EXECUTE` de volta.
- **M1.7** `require_recent_reauth()` helper. Rollback: `DROP`.

### Fase 2 — Eventos e agregação

- **M2.1** `product_events` + trigger `product_events_validate` (allowlist, sanitização, buckets). Rollback: `DROP`.
- **M2.2** Triggers emissores em `transactions, goals, goal_contributions, shared_expenses, shared_expense_participants, document_imports, outbound_messages, agent_runs`. Rollback: `DROP TRIGGER`.
- **M2.3** Tabelas agregadas §12.2 + funções de refresh. Rollback: `DROP`.
- **M2.4** Job `product-aggregates-refresh` (cron 15 min) + rebuild diário. Rollback: remover cron entry.
- **M2.5** Job `product-events-backfill` idempotente (uma execução). Rollback: `DELETE FROM product_events WHERE event_source LIKE 'backfill%'`.
- **M2.6** RPCs analíticos §13 itens 1-13. Rollback: `DROP FUNCTION`.

### Fase 3 — Cockpit

- **M3.1** RPC `admin_v2_cockpit` final. Rollback: `DROP`.
- Sem outra migration; código frontend criado em Fase 3.

### Fase 4 — Crescimento/Retenção/Produto/Clientes

- **M4.1** RPCs §13 itens 2-7 e 14-15 refinados. Rollback: reverter versão anterior.

### Fase 5 — Operação/Receita/Governança + depreciação

- **M5.1** `admin_v2_revenue_summary`, `admin_v2_governance_*`, `admin_v2_audit_list`. Rollback: `DROP`.
- **M5.2** Remoção definitiva dos RPCs legados `admin_dashboard_stats, admin_engagement_stats, admin_ops_health, admin_message_activity, admin_conversation_activity, admin_users_list, admin_message_metrics` (após 1 release convivendo). Rollback: recriar via snapshot.

---

## 15. Especificação visual e de conteúdo por página

Tokens fechados (§10 do briefing) já espelhados em `src/index.css` como HSL. Uso: Deep Ink sidebar, Cloud bg, White card, Violet informação, Coral degradação, Mint recuperação, Comparison Gray `#B8BBC6` (adicionar token). DM Sans exclusiva; Phosphor ícones nas telas novas — remoção gradual de Lucide.

### 15.1 Cockpit — `/admin/cockpit`

- **Header**: título "Control Center", subtítulo "O que mudou, o que precisa de atenção e onde agir.", filtros (7/30/90 default 30, Todos/App/WhatsApp, comparar on/off, "atualizado há Xmin", botão atualizar).
- **Linha 1** (4 KpiCard): WVU, Ativação, Retenção W4, Sucesso de experiências. Cada com valor 28-32px, delta com polaridade correta, sparkline 8 períodos, meta opcional, tooltip com fórmula/eventos/denominador/amostra/fonte/tz/freshness, click → drill.
- **Linha 2**: gráfico "O que mudou" (8 col, série atual Violet suave, comparação cinza tracejada, pontos só em anomalias, anotações de deploy/incidente, seletor entre WVU/Ativados/Experiências/Interações válidas do agente) + "Atenção necessária" (4 col, feed top-5: incidente | fricção | oportunidade, cada item com evidência, volume, amostra, período, comparação, "por que importa", CTA drill).
- **Linha 3**: Funil de ativação (7 col) + Saúde dos serviços (5 col).
- Cache 60s; skeleton por card.

### 15.2 Crescimento & Retenção — `/admin/crescimento`

Funil de ativação (etapas cadastro → onboarding → 1º registro → 1ª entrega de valor), conversão/perda/tempo mediano. Coortes W1/W4/W8 (heatmap desktop, "Abra no desktop" em mobile). Linha de retenção. Split App × WhatsApp. Painel "Sinais de abandono" (§11.2 briefing). Ciclo de vida (novo/ativado/engajado/em risco/inativo/perdido).

### 15.3 Inteligência de Produto — `/admin/inteligencia-produto`

Adoção por feature (elegíveis/descobriram/iniciaram/concluíram/repetiram). Tendências (dia, horário, canal, intenção, combos). Necessidades (suportadas, parciais, não suportadas, mal compreendidas, reformuladas, abandonadas). Oportunidades (evidência, n, período, confiança, experimento sugerido, responsável, status). **Sem texto bruto de conversas.**

### 15.4 Operação — Saúde — `/admin/operacao/saude`

Cards por serviço (WhatsApp, agente, OCR, mensageria, jobs) com estado, taxa sucesso, falha, p50, p95, backlog, idade da fila, heartbeat, última ocorrência, erros agrupados, timeline de incidentes. Métrica não instrumentada exibe "Métrica ainda não instrumentada" — nunca zero falso.

### 15.5 Mensageria — `/admin/operacao/mensageria`

Tabela com colunas: ID, pseudo_id, direção, canal, tipo/intenção, status, tentativas, latência, criado, atualizado, error_code, erro sanitizado. Filtros: status/canal/tipo/erro/data/ID. Ação "Retry" requer `operations.retry` + reauth ≤5 min + audit. **Sem preview, body, telefone, busca por conteúdo.**

### 15.6 IA & OCR — `/admin/operacao/ia-ocr`

Duas seções separadas: IA/agente (sucesso, intents, tools, modelos, p50/p95, tokens, custo) e OCR (docs, sucesso, falhas por causa, confiança, p50/p95, custo). Não misturar com Receita. Sem inspetor individual de usuário.

### 15.7 WhatsApp — `/admin/operacao/whatsapp`

Duas abas:
- **Monitoramento**: conexão, entrega, inbound, outbound, p50/p95, heartbeat, erros, último evento.
- **Configuração crítica**: credenciais, QR/código, reconexão, troca de sessão. Cada ação exige `whatsapp.manage` + reauth ≤5 min + audit.

### 15.8 Assistente & Simulador — `/admin/operacao/assistente(/simulador)`

Saúde do agente, versões de prompt, modelo ativo. Publicação com `assistant.publish` + reauth + audit. Simulador isolado (nenhum dado real de usuário).

### 15.9 Clientes & Suporte — `/admin/clientes`

Tabela pseudonimizada + jornada técnica + tickets. Sem dados financeiros individuais, sem conversa, sem email visível por padrão. Revelação apenas via break-glass.

### 15.10 Receita & Custos — `/admin/receita`

A) Negócio: receita, despesa, resultado, MRR, infra, margem — só se fonte real integrada; caso contrário `—` + "Fonte financeira ainda não integrada".
B) IA: custo total, por sucesso, por WVU, por feature/modelo/provider; tokens como contexto secundário.

### 15.11 Governança

- Configurações: feature flags, parâmetros, mudanças auditadas.
- Segurança: admins, papéis, permissões, sessões, break glass, reauth.
- Auditoria: mudanças admin, ações críticas, acessos excepcionais; filtros por admin/ação/período/resultado; sem conteúdo sensível.

Layout global admin: sidebar 232-240px Deep Ink, logo topo, item ativo Violet 8-10% + linha lateral 3px, grid 12 col, largura útil ≤1440px, padding 24-32px, gaps 20-24px, cards radius 14-16px + border `#E7E5EE`, sem sombra pesada, botões 40px radius 10-12px, tabela header sticky linhas 44-48px. Skeleton por card, sem spinner de página. Mobile <768px: 4 KPIs + alertas + saúde + ações críticas + resumo de crescimento; heatmaps/coortes/tabelas densas mostram "Abra no desktop para uma análise completa."

---

## 16. Mapeamento exato de arquivos

### Criar
- `src/pages/admin/Cockpit.tsx`
- `src/pages/admin/Crescimento.tsx`
- `src/pages/admin/InteligenciaProduto.tsx`
- `src/pages/admin/Clientes.tsx`
- `src/pages/admin/Receita.tsx`
- `src/pages/admin/operacao/Saude.tsx`
- `src/pages/admin/operacao/Mensageria.tsx`
- `src/pages/admin/operacao/IAOCR.tsx`
- `src/pages/admin/operacao/WhatsAppMonitor.tsx` + `WhatsAppConfig.tsx`
- `src/pages/admin/operacao/Assistente.tsx` + `AssistenteSimulador.tsx`
- `src/pages/admin/governanca/Configuracoes.tsx`
- `src/pages/admin/governanca/Seguranca.tsx`
- `src/pages/admin/governanca/Auditoria.tsx`
- Componentes: `KpiCard, AttentionFeed, MetricTooltip, SampleBadge, BreakGlassBanner, BreakGlassRequestModal, PseudoIdChip, CohortHeatmap, FunnelChart, SparklineMini, AnnotationLayer, FreshnessLabel`
- Hooks: `useAdminCockpit, useAdminGrowth*, useProductIntelligence, useOperationsHealth, useMessagingActivity, useIaOcrMetrics, useWhatsAppMonitor, useAssistantHealth, useClientsList, useRevenueSummary, useGovernanceConfig, useAuditList, usePlatformPermissions, useBreakGlass`
- Libs: `src/lib/admin/permissions.v2.ts` (consulta `current_platform_permissions` em cache); `src/lib/admin/envelope.ts` (parser envelope canônico); `src/lib/admin/breakGlass.ts`.

### Editar
- `src/App.tsx` — adicionar novas rotas + redirects legados + feature flag `NEW_ADMIN_IA`.
- `src/components/admin/AdminLayout.tsx` — nova sidebar hierárquica, prop `idleMs=20*60_000, warningMs=18*60_000` no SessionGuard, banner break-glass, ícones Phosphor.
- `src/components/auth/SessionInactivityGuard.tsx` — aceitar props `idleMs, warningMs` e propagar ao hook.
- `src/hooks/useSessionInactivity.ts` — permitir override completo; validar sessão `getSession()` ao voltar de background.
- `src/components/auth/PlatformAdminRoute.tsx` — hidratar permissões via `current_platform_permissions`; expor via contexto.
- `src/lib/admin/permissions.ts` — passar a ler do servidor; matriz local vira apenas fallback tipado.

### Mover
- `Produto.tsx` → `governanca/Configuracoes.tsx` (mesclando com atual `Configuracoes.tsx`).
- `Seguranca.tsx` → `governanca/Seguranca.tsx` (expandido).
- `Agente.tsx`/`AgenteSimulador.tsx` → `operacao/Assistente.tsx`/`AssistenteSimulador.tsx`.
- `WhatsApp.tsx`/`WhatsAppSessionPanel.tsx` → `operacao/WhatsAppMonitor.tsx` + `WhatsAppConfig.tsx`.

### Deprecar (manter 1 release)
- `VisaoGeral.tsx`, `Engajamento.tsx`, `Usuarios.tsx`, `Mensagens.tsx`, `IAInteligencia.tsx`, `Financeiro.tsx`, `Operacao.tsx`.

### Remover (Fase 5, após 1 release)
- Os arquivos deprecados acima; RPCs `admin_dashboard_stats, admin_engagement_stats, admin_ops_health, admin_users_list, admin_message_activity, admin_conversation_activity, admin_message_metrics`.

---

## 17. Rollout por fases e feature flags

- **Flag `admin_v2_enabled`** (default off) em `platform_public_config` → habilita novas rotas.
- **Flag `admin_v2_redirects`** (default off) → ativa redirects legados quando novas rotas estão prontas.
- **Flag `admin_v2_deprecate_legacy_rpcs`** (default off) → dispara M5.2.
- Cada fase só avança após todos os gates §12 (test unit/int/RLS/privacidade/typecheck/build/smoke/rollback) verdes.
- Fase 1 é bloqueadora e não depende de flag — corrige exposição real.
- Nenhum deploy/publish automático. Após todas as fases, entregar preview + relatório; publicação exige autorização explícita.

---

## 18. Critérios de aceite (recap exaustivo)

Nenhum RPC padrão retorna PII proibida · nenhuma role executa ação não autorizada via RPC direto · permissões FE/BE consistentes · break-glass exige owner+reauth+motivo+ticket · break-glass expira 15min · sessão admin avisa 18/encerra 20min · app usuário 30min · retorno após dias revalida sessão antes de renderizar · denominador zero mostra `—` · anterior=0 & atual>0 mostra `novo` · taxas em p.p. · coorte <10 mostra amostra insuficiente sem polaridade · eventos duplicados não alteram métricas · backfill idempotente · WVU oficial não mistura proxies · timezone `America/Sao_Paulo` · sem spinner página inteira · skeletons independentes · rotas antigas não dão 404 durante compat · sem loop de redirect · nenhum insight afirma causalidade · oportunidades respeitam amostras específicas · nenhum dado financeiro individual no admin comum · sem export de PII · toda ação crítica auditada · nada publicado sem autorização.

---

## 19. Checklist de testes

- **Unit:** fórmula WVU · ativação 7d · elegibilidade cadastro · W1/W4/W8 · coorte imatura · amostra insuficiente · delta/polaridade (contagem vs taxa) · p50/p95 · anomalia (baseline + limiar) · buckets monetários.
- **Integração:** allowlist eventos (rejeita PII) · idempotência (retry não duplica) · backfill idempotente · timezone conversão UTC↔SP · eventos atrasados (rebuild 3d).
- **RLS/RBAC:** RLS `product_events` bloqueia SELECT authenticated · matriz role×ação (16 casos) chama RPC direto e espera 403 · break-glass sem reauth falha · break-glass expirado falha · break-glass conteúdo lido é auditado · `require_recent_reauth` bloqueia após >5min.
- **Sessão:** timeout admin 20min · warning 18min · retorno após suspensão revalida · BroadcastChannel entre abas.
- **Rotas:** todos os redirects listados em §6 vão sem loop · nenhuma rota antiga 404 · feature flag off mantém rotas atuais.
- **Build/Typecheck:** `bun run build`, `tsgo`.
- **Acessibilidade:** foco visível, contraste ≥4.5, aria em KpiCard/tooltip.
- **Responsividade:** 768/1024/1280/1440/1920 sem overflow; mobile mostra apenas seções permitidas.
- **Performance:** RPCs analíticos ≤400ms p95 no banco atual.
- **Freshness:** cada RPC devolve `computed_at`/`freshness_seconds` — UI exibe.
- **Rollback:** cada migration testada em ambiente com dry-run + reversão.

---

## 20. Riscos residuais

- Latência de RPCs agregadores sob carga real — mitigar com índices explícitos e cache 60s.
- Discrepância entre WVU oficial (Fase 2+) e proxies históricos — mitigar rótulos "Medição iniciada em DD/MM/AAAA" e série separada.
- Custo de emitir triggers em `outbound_messages` (alto volume) — mitigar filtrando por transição de status e usando `pg_notify`/queue se performance degradar.
- `agent_runs.cost_cents` pode não existir em todos os registros históricos — validar antes de M2.5 (dependência da tabela; scan já feito em §2.5).
- Adoção de Phosphor em telas legadas fica pendente — assumido para migração gradual, não bloqueia.

---

## 21. Decisões humanas realmente indispensáveis

Nenhuma. Todas as decisões técnicas (RBAC, break-glass, pseudonimização, timeouts, WVU, ativação, insights, amostras, tokens visuais, rotas, ordem de fases, política de backfill) estão fechadas neste plano ou no briefing e podem ser executadas com segurança. Fica pendente **apenas a autorização de execução** por fase.

---

## 22. Comandos e arquivos inspecionados nesta auditoria

**Comandos de leitura:**
- `psql -tAc "SELECT proname FROM pg_proc … WHERE proname LIKE 'admin_%'"` (24 funções).
- `psql -tAc "SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname IN (…)"`.
- `psql -tAc "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname IN ('admin_users_list','admin_message_activity','admin_conversation_activity','admin_engagement_stats','admin_ops_health','is_platform_admin','current_platform_admin_role')" > /tmp/rpcs.sql`.
- `psql -tAc "SELECT enum_range(NULL::platform_role)::text"`.
- `psql -tAc "\d platform_admins"`, `"\d platform_admin_audit"`, `"SELECT count(*) FROM platform_admins"`.
- `psql -tAc "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND …"`.
- `ls src/pages/admin/`, `ls supabase/migrations/ | tail -60`.
- `grep -rn "supabase.rpc|from(\"platform_admin" src/pages/admin src/components/admin src/hooks`.
- `grep -nE "idleMs|warningMs|SessionInactivityGuard" src/components/admin/AdminLayout.tsx src/components/AppLayout.tsx`.
- `grep -nE "TIMEOUT|idleMs" src/hooks/useSessionInactivity.ts`.

**Arquivos lidos integralmente ou em trechos determinantes:**
- `src/App.tsx` (1-156).
- `src/components/auth/PlatformAdminRoute.tsx`.
- `src/hooks/useAdminPlatformStatus.ts`.
- `src/lib/admin/messageCenter.ts`.
- `src/lib/admin/permissions.ts`.
- `src/pages/admin/VisaoGeral.tsx`, `WhatsApp.tsx`.
- Trechos de `src/components/auth/SessionInactivityGuard.tsx`, `src/components/admin/AdminLayout.tsx`, `src/hooks/useSessionInactivity.ts`, `src/components/AppLayout.tsx`.
- Definições SQL completas de: `admin_users_list, admin_message_activity, admin_conversation_activity, admin_engagement_stats, admin_ops_health, is_platform_admin, current_platform_admin_role` (via `pg_get_functiondef`).
- Metadata de tabelas: `platform_admins, platform_admin_audit, user_pseudonyms(ausente), product_events(ausente)`.

---

## 23. Confirmação

**Nenhuma implementação foi realizada.** Nenhum arquivo funcional foi editado, criado ou movido. Nenhuma migration foi criada nem aplicada. Nenhuma RPC, tabela, trigger, view, policy ou grant foi alterada. Nenhum build, teste, deploy ou publicação foi executado. Apenas `.lovable/plan.md` foi atualizado com o conteúdo integral acima.

**Status final:** `READY_TO_EXECUTE_ALL_PHASES`. Aguardando autorização explícita para iniciar Fase 1 e, em seguida, executar sequencialmente todas as fases respeitando os gates definidos em §17-19.
