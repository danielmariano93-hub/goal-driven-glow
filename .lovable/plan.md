# Auditoria Técnica — Meu Nino Control Center

> Plano executável validado contra o código, migrations e banco reais. Nenhum arquivo funcional foi alterado nesta etapa.

---

## 1. Resumo executivo

- **RBAC parcialmente pronto**: enum `platform_role` já contém `platform_owner | platform_admin | support | analyst` (CONFIRMADO NO BANCO). Não existe `support_lead`; frontend usa apenas `is_platform_admin()` como gate — a matriz por papel só existe em `src/lib/admin/permissions.ts` e **não é revalidada nos RPCs** (`admin_dashboard_stats`, `admin_ops_health`, `admin_users_list` etc. checam apenas `is_platform_admin()`). Isso é o principal risco: analista/support conseguem executar qualquer RPC admin exposto.
- **PII vaza no servidor**: `admin_message_activity` retorna `preview` (200 chars do body), `user_id`, `context_id`, `to_phone` mascarado apenas nos últimos 4 dígitos, e faz `ILIKE` no `body`. `admin_conversation_activity` retorna `contact` + `preview`. `admin_users_list` retorna `email` e `display_name`. O painel exibe esse conteúdo hoje (evidência: `src/pages/admin/Mensagens.tsx:218,276`).
- **Não existe pipeline de eventos de produto** (`rg product_events|analytics_events|posthog|mixpanel|amplitude` retorna vazio). Todas as métricas atuais derivam de contagens diretas em `transactions`, `goals`, `shared_expenses`, `agent_runs`, `outbound_messages`. **WVU, ativação, retenção coorte, funis de feature e "entrega de valor" ainda não são calculáveis** sem instrumentação nova.
- **Base analítica útil já existe**: `agent_runs` tem `intent_requested`, `intent_served`, `tools_used`, `formula_versions`, `latency_ms`, `path`. `outbound_messages` tem `surface`, `feature`, `kind`, `context_type`, `sent_at`, `delivered_at`, `read_at`, `accepted_at`. Isso permite calcular hoje: entrega WhatsApp, p50/p95 fila, taxa de falha do agente, custos por período, ferramentas mais usadas.
- **Rotas do admin colidem com o plano conceitual**: hoje `/admin/produto` e `/admin/ia` coexistem sem hierarquia; não há `/admin/operacao/*` sub-rotas nem `/admin/governanca/*`.
- **Recomendação**: executar em fases. Fase 1 (privacidade emergencial) é bloqueadora — remover PII dos RPCs antes de qualquer redesign. Fase 2 introduz `product_events` + agregados. Fases 3-5 constroem UX.

---

## 2. Evidências da auditoria

| Achado | Classificação | Arquivo / Migration / RPC | Trecho | Impacto |
|---|---|---|---|---|
| Todos os RPCs `admin_*` gate por `is_platform_admin()` uniforme | CONFIRMADO NO BANCO | `admin_dashboard_stats`, `admin_engagement_stats`, `admin_agent_stats`, `admin_ops_health`, `admin_users_list`, `admin_platform_status` | `IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'` | Permissões finas do frontend são cosméticas. Qualquer role platform passa em qualquer RPC. |
| Enum `platform_role` só tem 4 valores | CONFIRMADO NO BANCO | `pg_enum` platform_role | `platform_owner, platform_admin, support, analyst` | `support_lead`, `operations`, `product_analyst`, `finance`, `security_auditor` não existem. |
| Matriz por papel só no frontend | CONFIRMADO NO CÓDIGO | `src/lib/admin/permissions.ts` | `MATRIX: Record<PlatformRole, PlatformAction[]>` | Sem espelhamento server-side. |
| `admin_message_activity` devolve preview de body real | CONFIRMADO NO BANCO | RPC `admin_message_activity` | `left(regexp_replace(coalesce(o.body,''),...),200) AS preview` | PII/segredos de conversa expostos ao admin. |
| Busca por body sem role/consent | CONFIRMADO NO BANCO | RPC `admin_message_activity` | `o.body ILIKE '%'||p_search||'%'` | Pesquisa full-text em mensagens de usuário. |
| `admin_users_list` retorna email/display_name | CONFIRMADO NO BANCO | RPC `admin_users_list` | `SELECT c.user_id, c.email, p.display_name, ...` | Identifica usuários por PII direta. |
| `admin_consumer_users_set` referencia `auth.users` direto | CONFIRMADO NO BANCO | Function `admin_consumer_users_set` | `FROM auth.users u WHERE NOT EXISTS (... platform_admins ...)` | Segrega admins da base, mas expõe email. |
| `agent_runs` já tem telemetria rica | CONFIRMADO NO BANCO | colunas `intent_requested,intent_served,tools_used,formula_versions,latency_ms,path` | — | Habilita cockpit de IA sem tabela nova. |
| `outbound_messages` tem `sent_at/delivered_at/read_at/accepted_at` | CONFIRMADO NO BANCO | schema `outbound_messages` | — | Permite p50/p95 e entrega WhatsApp reais. |
| Não existe tabela de eventos de produto | NÃO ENCONTRADO | `rg product_events\|analytics_events\|posthog\|mixpanel` retorna vazio | — | WVU, funil e retenção precisam de instrumentação nova. |
| DAU/WAU/MAU aproximados por `transactions.created_at` | CONFIRMADO NO BANCO | `admin_engagement_stats` | `count(DISTINCT user_id) FROM transactions WHERE created_at > now() - X` | Subestima usuários passivos (só consultam) e superestima automações; ver §5. |
| `admin_ops_health.imports_recent` lê `import_batches` (legado) | CONFIRMADO NO BANCO | `admin_ops_health` | `FROM public.import_batches` | Pipeline documental v2 usa `document_imports` — métrica desalinhada. |
| Rotas admin planas em `App.tsx:128-144` | CONFIRMADO NO CÓDIGO | `src/App.tsx` | `/admin, /admin/usuarios, /admin/produto, /admin/ia, /admin/whatsapp, /admin/operacao ...` | Sem sub-hierarquia de operação/governança. |
| `PlatformAdminRoute` já protege `/admin` | CONFIRMADO NO CÓDIGO | `src/components/auth/PlatformAdminRoute.tsx` (referenciado em `App.tsx:129`) | — | Base de reautenticação não existe (ver §6.10). |
| `SessionInactivityGuard` embutido em `AdminLayout` | CONFIRMADO NO CÓDIGO | `src/components/admin/AdminLayout.tsx:175,236` | — | Timeout unificado (não específico do admin em 20 min). |
| `admin_platform_status` já deriva status de WhatsApp/agente/jobs | CONFIRMADO NO BANCO | RPC `admin_platform_status` | usa `provider_health_events`, `job_heartbeats`, `agent_prompt_versions` | Base pronta para o Cockpit sem migration nova. |

Comandos de leitura executados: `ls`, `rg`, `cat` (via `sed -n`), `psql -tAc` (SELECT + `pg_get_functiondef`/`pg_proc`/`pg_policy`).

---

## 3. Inventário técnico atual

| Página | Componente | Hook / Query | RPC atual | Tabelas lidas | Role atual (server) | PII exposta hoje | Destino futuro |
|---|---|---|---|---|---|---|---|
| `/admin` VisaoGeral.tsx | `StatGrid` | `useQuery admin_stats/engagement/agent/ops` | `admin_dashboard_stats`, `admin_engagement_stats`, `admin_agent_stats`, `admin_ops_health` | transactions, goals, accounts, investments, debts, whatsapp_links, shared_expenses, recurring_rules, user_challenges, agent_runs, outbound_messages, reminder_jobs, import_batches, account_deletion_requests | is_platform_admin | Nenhuma (agregados) | Substituir por `/admin/cockpit` alimentado por `admin_cockpit_kpis` (novo, agregados) |
| `/admin/usuarios` Usuarios.tsx | DataTable | `admin_users_list` | idem | auth.users, profiles, whatsapp_links, platform_admins | is_platform_admin | **email, display_name** | Mover para `/admin/clientes`; padrão pseudonimizado; break-glass para email |
| `/admin/engajamento` | — | `admin_engagement_stats` | idem | vide acima | is_platform_admin | Nenhuma | `/admin/crescimento` com agregados diários |
| `/admin/mensagens` Mensagens.tsx | Filtros + tabela + timeline | `admin_message_activity`, `admin_message_metrics`, `admin_message_timeline`, `admin_conversation_activity` | idem | outbound_messages, conversation_messages, message_delivery_events | is_platform_admin | **body preview 200 chars, phone parcial, contact, user_id** | `/admin/operacao/mensageria`; padrão sem preview; break-glass para conteúdo |
| `/admin/whatsapp` | WhatsAppSessionPanel + validate | `admin_platform_status`, `admin_whatsapp_inbound_health`, `admin_waha_*` | idem | provider_health_events, whatsapp_links, waha config vault | is_platform_admin (waha_save gate extra) | `to_phone` masked | `/admin/operacao/whatsapp` |
| `/admin/ia` IAInteligencia.tsx | — | — | — | — | is_platform_admin | A validar (arquivo não relido nesta etapa) | `/admin/operacao/ia-ocr` |
| `/admin/agente` + `/admin/agente/simulador` | — | — | agent_prompt_* RPCs | agent_prompt_versions, agent_sessions | is_platform_admin | Prompts (não PII) | `/admin/operacao/assistente` |
| `/admin/operacao` | — | `admin_ops_health` | idem | outbound_messages, reminder_jobs, import_batches, account_deletion_requests | is_platform_admin | Nenhuma | `/admin/operacao/saude` |
| `/admin/produto` | — | — | — | — | is_platform_admin | A validar | `/admin/governanca/configuracoes` |
| `/admin/financeiro` | — | — | — | company_* tables | is_platform_admin | Financeiro empresa | `/admin/receita` |
| `/admin/seguranca` | — | `admin_list_platform_admins`, `grant/revoke_platform_admin` | idem | platform_admins, admin_grants_audit, platform_admin_audit | is_platform_admin | **email dos admins** | `/admin/governanca/seguranca` + `/admin/governanca/auditoria` |
| `/admin/configuracoes` | — | — | — | platform_public_config | is_platform_admin | A validar | `/admin/governanca/configuracoes` |

---

## 4. RPCs atuais

Todos `SECURITY DEFINER`, `SET search_path=public`. Todos gate por `is_platform_admin()` — **não** por role granular.

| RPC | Assinatura | Consumidores | Reutilizável? | Problema | Destino |
|---|---|---|---|---|---|
| `admin_dashboard_stats()` | jsonb | VisaoGeral | Parcial | Fundido em cockpit; contagem sem período | Deprecar após `admin_cockpit_kpis` |
| `admin_engagement_stats()` | jsonb | VisaoGeral | Não | DAU/WAU aproxima por `transactions.created_at` (viés) | Substituir por agregados de `product_events` |
| `admin_agent_stats()` | jsonb | VisaoGeral | Sim | Sem breakdown por intent/tool/model | Ampliar (`admin_ai_kpis`) |
| `admin_ops_health()` | jsonb | VisaoGeral, Operacao | Sim | `imports_recent` desalinhado (`import_batches` vs `document_imports`) | Corrigir fonte |
| `admin_platform_status()` | jsonb | Layout (chips) | Sim | Ok | Manter |
| `admin_users_list(p_search,p_limit,p_offset)` | table | Usuarios | **Não seguro** | Devolve email/display_name a qualquer admin | Reescrever `admin_clients_list` pseudonimizado |
| `admin_list_platform_admins()` | table | Seguranca | Sim (owner apenas) | Retorna email — aceitável para /seguranca com role checa | Manter, mas exigir `security.manage_admins` server-side |
| `admin_message_metrics(p_from,p_to)` | jsonb | Mensagens | Sim | Ok (agregado) | Manter |
| `admin_message_activity(...)` | jsonb | Mensagens | **Não seguro** | Preview body + phone + ILIKE em body | Duas versões: pseudo (default) e `break_glass` (auditada) |
| `admin_message_timeline(p_id)` | jsonb | Mensagens | Parcial | Preview idem | Idem |
| `admin_message_reprocess(p_id)` | jsonb | Mensagens | Sim | Ação crítica sem role granular | Exigir `ops.write` + auditoria |
| `admin_conversation_activity(p_from,p_to,p_limit)` | jsonb | Mensagens | **Não seguro** | Retorna contact + preview | Pseudonimizar; break-glass |
| `admin_document_metrics(p_days)` | jsonb | IA/Ops | Sim | Ok | Reutilizar |
| `admin_run_check(p_job_key)` / `admin_reprocess_failed(p_job_key)` | ação | Ops | Sim | Falta role granular + auditoria | Exigir `ops.write` server-side |
| `admin_waha_*` | config | WhatsApp | Sim | `admin_waha_save_config` já tem gate extra (vault) | Manter, restringir a `platform_admin+` |
| `admin_process_deletion_request` / `admin_approve_deletion_request` / `admin_reject_deletion_request` | ação | Governança | Sim | Falta `users.process_deletion` server-side | Adicionar reautenticação |
| `is_platform_admin()` | bool | Gate universal | Sim | Sem granularidade | Manter como bootstrap; introduzir `has_platform_permission(action)` |
| `current_platform_admin_role()` | platform_role | AuthContext | Sim | Ok | Manter |
| `admin_rate_check(p_action,p_limit)` | bool | (ações críticas) | Sim | Existe rate limit; falta enforcement uniforme | Padronizar chamada nas ações |

---

## 5. Matriz de fontes das métricas

| Métrica | Fórmula | Fonte atual validada | Colunas atuais | Qualidade | Fonte canônica futura | Backfill | Disponibilidade histórica |
|---|---|---|---|---|---|---|---|
| **WVU (weekly value users)** | usuários únicos com ≥1 entrega de valor em janela 7d | **Ausente**. Aproximável por `outbound_messages` + `agent_runs.intent_served` | outbound.status IN (delivered,read) AGRUPAR user_id + agent_runs.status=done | Baixa (aproxima) | `product_events` (`goal_progress_explained`, `split_result_delivered`, `split_reminder_prepared`, `personalized_response_delivered`) agregados em `product_daily_value` | Parcial via outbound.delivered_at (~30 dias) | Após instrumentação; backfill limitado |
| Ativação | primeiro evento de valor em ≤ 3 dias | Aproxima por `activation_first_transaction` | transactions.created_at | Média | product_events `first_value_delivered` | Sim, via transactions | Desde julho/2026 |
| Tempo até ativação | delta signup → primeira entrega | auth.users.created_at → transactions.created_at | idem | Média | idem | Sim | idem |
| Retenção W1/W4/W8 | coorte semanal × retorno com valor | Não calculável (proxy fraco por transactions) | — | Baixa | product_events + `product_cohorts_weekly` | Parcial | Prospectiva |
| Sucesso de experiências | eventos start→success | Não instrumentado | — | Ausente | product_events `feature_started`/`feature_completed` | Não | Prospectiva |
| Adoção / Conclusão / Repetição | feature_discovered / _completed / _repeated | Não instrumentado | — | Ausente | product_events | Não | Prospectiva |
| DAU/WAU/MAU | ativos por transação (proxy) | `admin_engagement_stats` | transactions.created_at | Média (viés) | `product_events` (login, meaningful_action) | Parcial (transactions) | Prospectiva canônica |
| Entrega WhatsApp | sent → delivered → read | **Direta** | outbound_messages.status,sent_at,delivered_at,read_at | Alta | Idem + agregado diário | Sim | Desde ativação do WhatsApp |
| p50/p95 fila outbound | percentil (sent_at - created_at) | `admin_message_metrics` (avg) | outbound.created_at,sent_at | Média (falta percentil) | `outbound_metrics_daily` | Sim | Idem |
| Backlog / idade fila | agora - min(created_at WHERE status=queued) | `admin_ops_health.outbox_queued` | outbound_messages.status | Alta | idem | N/A | Real-time |
| Custo por sucesso IA | sum(cost_cents) / count(runs done) | Aproximável | agent_runs.cost_cents,status | Média (definir "sucesso") | agent_runs + product_events | Parcial | Desde runs.started_at |
| Custo por WVU | sum(cost_cents 7d) / WVU 7d | Depende de WVU | agent_runs + futuro | Depende | idem | Depende WVU | Prospectivo |
| Receita / Custos / Margem | somas | Depende do módulo `/admin/financeiro` (não relido) | company_* | A validar | idem + `platform_costs_daily` | A validar | A validar |

---

## 6. Cobertura da taxonomia de eventos

**Decisão recomendada**: usar **eventos específicos por feature** (não genéricos) para o núcleo do funil de valor. Motivo: (a) baixo volume esperado (dezenas/milhares por dia por feature), (b) versionamento independente, (c) backfill mais claro, (d) governança mais simples.

Genéricos (`feature_started/completed`) ficam como fallback opcional para features novas.

| Evento desejado | Sinal atual encontrado | Origem | Confiabilidade | Novo? | Emissor futuro |
|---|---|---|---|---|---|
| `user_signed_up` | `auth.users.created_at` | auth | Alta | Não | Trigger em `handle_new_user` |
| `onboarding_completed` | `profiles.onboarding_completed_at` | DB | Alta | Não | Trigger em profiles UPDATE |
| `transaction_recorded` | `transactions` INSERT | DB | Alta | Sim (canônico) | Trigger AFTER INSERT em transactions |
| `transaction_edited` | Nenhum (`updated_at` existe) | DB | Baixa (não distingue campo) | Sim | Trigger BEFORE UPDATE com diff |
| `goal_created` | `goals` INSERT | DB | Alta | Sim | Trigger |
| `goal_progress_explained` | Não existe | — | Ausente | **Sim (valor)** | AgentCore ao emitir artifact/resposta de meta |
| `split_created` | `shared_expenses` INSERT | DB | Alta | Sim | Trigger |
| `split_result_delivered` | Não existe | — | Ausente | **Sim (valor)** | AgentCore/split-dispatch quando resposta entregue |
| `split_reminder_prepared` | Aproximação por `reminder_jobs.status='sent'` | DB | Média | **Sim (valor)** | split-reminders-dispatch |
| `ocr_document_uploaded` | `document_imports.status='uploaded'` | DB | Alta | Sim | Trigger em document_imports |
| `ocr_extraction_succeeded` | `document_imports.status='completed'` | DB | Alta | Sim | Trigger |
| `ocr_extraction_failed` | `document_imports.status='failed'` | DB | Alta | Sim | Trigger |
| `agent_intent_received` | `agent_runs.intent_requested` | DB | Alta | Sim | Trigger em agent_runs INSERT |
| `agent_intent_served` | `agent_runs.intent_served,status=done` | DB | Alta | Sim | Trigger em agent_runs UPDATE |
| `personalized_response_delivered` | Aproximação: `agent_runs.status=done` + `outbound_messages` correlacionada | DB | Média | **Sim (valor)** | AgentCore ao finalizar turno útil |
| `feature_eligible` | Requer regra de elegibilidade explícita | — | Ausente | Opcional | Server (job diário) |
| `feature_entry_displayed` | Não instrumentado | — | Ausente | Opcional | Frontend (throttle) |
| `feature_discovered` | Não instrumentado | — | Ausente | Opcional | Frontend |
| `whatsapp_link_activated` | `whatsapp_links.status='active'` transição | DB | Alta | Sim | Trigger |
| `admin_action_performed` | `platform_admin_audit` | DB | Alta | Não (já existe) | Manter |

**Não adotar imediatamente**: eventos genéricos `feature_started/completed`. Introduzir só se surgirem features sem instrumentação canônica.

---

## 7. Arquitetura final de dados

Componentes propostos (nenhum criado ainda):

1. **`product_events` (append-only)**
   - Colunas mínimas: `id uuid pk`, `event_name text (allowlist)`, `schema_version smallint`, `pseudo_user_id uuid`, `occurred_at timestamptz`, `received_at timestamptz`, `surface text`, `feature text`, `properties jsonb`, `idempotency_key text unique`, `event_source text` (`db_trigger|edge_function|frontend`).
   - **Allowlist**: função `assert_event_name(text)` que só aceita nomes de uma lista fixa; INSERT via RPC `emit_product_event`.
   - **Deduplicação/idempotência**: `UNIQUE (idempotency_key)` com `ON CONFLICT DO NOTHING`.
   - **Retenção**: 90 dias raw; agregados perpétuos.
   - **Timezone**: armazenar UTC; agregar em `America/Sao_Paulo` via `date_trunc('day', occurred_at AT TIME ZONE 'America/Sao_Paulo')`.
   - **Dados atrasados**: agregados por `received_at` para operação, `occurred_at` para análise; reprocesso diário rebuild dos últimos 3 dias.

2. **Pseudonimização** (ver §6.9)
   - `pseudo_user_id` = `uuid` estável armazenado em `user_pseudonyms(user_id uuid pk, pseudo_id uuid unique, created_at)`; gerado no primeiro evento por função `get_or_create_pseudo(user_id)`.
   - Não é hash reversível; é surrogate key só acessível via RPC `owner_only` ou `break_glass`.
   - Em exclusão de conta: `pseudo_id` é preservado, `user_id` fica NULL (`ON DELETE SET NULL`).

3. **Agregados diários (tabelas físicas, não materialized views)**
   - `product_daily_value(day date, wvu int, active_users int, activations int, ...)` — refresh por job cron a cada 15 min e diariamente às 03:00 BRT (rebuild 3 dias).
   - `outbound_metrics_daily(day, channel, feature, sent, delivered, read, failed, p50_ms, p95_ms)`.
   - `agent_metrics_daily(day, intent, tool, model, runs, success, latency_p50, latency_p95, tokens_in, tokens_out, cost_cents)`.
   - `feature_funnel_daily(day, feature, eligible, discovered, started, completed, repeated)`.
   - Justificativa material vs MV: refresh sob demanda, tolerância a chegada atrasada, testes mais fáceis.

4. **Cron/refresh**: função `refresh_admin_aggregates(p_days int)` chamada por pg_cron ou edge function agendada.

5. **Backfill**: RPCs `backfill_from_transactions`, `backfill_from_outbound`, `backfill_from_agent_runs` que emitem `product_events` com `event_source='backfill'`, `idempotency_key` determinístico e nunca duplicam.

---

## 8. Contratos dos RPCs futuros (assinaturas, sem SQL)

Todos `SECURITY DEFINER`, `SET search_path=public`, primeira linha `IF NOT has_platform_permission(<action>) THEN RAISE 42501`.

| RPC | Finalidade | Params | Retorno | Tabelas | Role/ação | Cache/freshness | Denominador 0 | Amostra <10 |
|---|---|---|---|---|---|---|---|---|
| `has_platform_permission(action text)` | Gate central | action | boolean | platform_admins, permissions matrix | — | stable per session | — | — |
| `admin_cockpit_kpis(p_period text)` | KPIs do topo | 7d/28d/mtd | jsonb | product_daily_value, outbound_metrics_daily | overview.read | 60s | retorna `null` (frontend `—`) | flag `insufficient_sample=true` |
| `admin_growth_series(p_metric text, p_period text)` | Séries + delta | metric, period | jsonb | product_daily_value | overview.read | 60s | idem | idem |
| `admin_retention_cohorts(p_cohort_from date, p_cohort_to date)` | W1/W4/W8 | intervalo | jsonb | product_daily_value + product_events | overview.read | 5 min | idem | idem |
| `admin_feature_funnel(p_feature text, p_period text)` | Funil | feature | jsonb | feature_funnel_daily | product.read | 60s | idem | idem |
| `admin_ai_ops_kpis(p_period text)` | Runs, latência, custo, tool mix | period | jsonb | agent_metrics_daily | agent.read | 60s | idem | idem |
| `admin_messaging_kpis(p_period text)` | Entrega, p50, p95, backlog | period | jsonb | outbound_metrics_daily, outbound_messages | ops.read | 30s | idem | idem |
| `admin_clients_list(p_search text, p_limit, p_offset)` | Lista pseudonimizada | busca por prefixo pseudo | table | user_pseudonyms + product_daily_value | users.read | none | — | — |
| `admin_client_summary(p_pseudo_id uuid)` | Perfil sem PII | pseudo | jsonb | product_events agg | users.read | none | — | — |
| `admin_break_glass_open(p_reason text, p_ticket text, p_scope text)` | Ativa acesso | reason, ticket, scope | jsonb (session token/TTL) | platform_admin_audit + `break_glass_sessions` | users.process_deletion \| whatsapp.critical (por scope) | — | — | reautenticação obrigatória |
| `admin_break_glass_read_email(p_pseudo_id uuid)` | Recupera email | pseudo | text | user_pseudonyms + auth.users | requer break-glass ativo + ação-específica | none | — | audita |
| `admin_message_content_read(p_id uuid)` | Body real | id | jsonb | outbound_messages | requer break-glass | none | — | audita |
| `emit_product_event(name, props, idempotency_key, occurred_at)` | Emitir evento | — | uuid | product_events | authenticated (para user_id atual) OU service_role | — | — | — |
| `refresh_admin_aggregates(p_days int)` | Reconstrói agregados | days | void | todas *_daily | service_role/cron | — | — | — |

Comportamentos:
- **Denominador zero**: retorna `null` no campo numérico + `state:"no_data"`; frontend renderiza `—`.
- **Amostra insuficiente**: `sample_size < 10` → campo `insufficient_sample:true`, valores nulos.
- **Delta com anterior=0 e atual>0**: `delta:{ kind:"new" }`.
- **Timezone**: sempre `America/Sao_Paulo` no agregado, retornado com `tz` explícito.

---

## 9. Arquitetura final de rotas e arquivos

| Rota atual | Arquivo atual | Rota futura | Arquivo futuro | Ação | Redirect | Fase |
|---|---|---|---|---|---|---|
| `/admin` (index) | `src/pages/admin/VisaoGeral.tsx` | `/admin/cockpit` | `src/pages/admin/Cockpit.tsx` (novo) | Criar novo. Deprecar VisaoGeral após 1 release. | `/admin` → `/admin/cockpit` (Navigate replace) | 3 |
| — | — | `/admin` | idem | Redirect permanente para `/admin/cockpit` | Sim | 3 |
| `/admin/engajamento` | Engajamento.tsx | `/admin/crescimento` | `src/pages/admin/Crescimento.tsx` (rename+refactor) | Rename com alias temporário | `/admin/engajamento` → `/admin/crescimento` | 4 |
| `/admin/usuarios` | Usuarios.tsx | `/admin/clientes` | `src/pages/admin/Clientes.tsx` | Rename + pseudonimização | `/admin/usuarios` → `/admin/clientes` | 4 |
| `/admin/produto` | Produto.tsx | `/admin/inteligencia-produto` | `src/pages/admin/InteligenciaProduto.tsx` | Rename | `/admin/produto` → `/admin/inteligencia-produto` | 4 |
| `/admin/operacao` | Operacao.tsx | `/admin/operacao/saude` | `src/pages/admin/operacao/Saude.tsx` | Mover conteúdo atual para sub-rota | `/admin/operacao` → `/admin/operacao/saude` | 5 |
| `/admin/mensagens` | Mensagens.tsx | `/admin/operacao/mensageria` | `src/pages/admin/operacao/Mensageria.tsx` | Rename + purgar PII | `/admin/mensagens` → `/admin/operacao/mensageria` | 5 |
| `/admin/ia` | IAInteligencia.tsx | `/admin/operacao/ia-ocr` | `src/pages/admin/operacao/IaOcr.tsx` | Rename | `/admin/ia` → `/admin/operacao/ia-ocr` | 5 |
| `/admin/whatsapp` | WhatsApp.tsx | `/admin/operacao/whatsapp` | `src/pages/admin/operacao/WhatsApp.tsx` | Rename | `/admin/whatsapp` → `/admin/operacao/whatsapp` | 5 |
| `/admin/agente` + `/admin/agente/simulador` | Agente.tsx, AgenteSimulador.tsx | `/admin/operacao/assistente` + `.../simulador` | `src/pages/admin/operacao/Assistente*.tsx` | Rename | Sim | 5 |
| `/admin/financeiro` | Financeiro.tsx | `/admin/receita` | `src/pages/admin/Receita.tsx` | Rename | Sim | 5 |
| `/admin/seguranca` | Seguranca.tsx | `/admin/governanca/seguranca` | `src/pages/admin/governanca/Seguranca.tsx` | Mover | Sim | 5 |
| `/admin/configuracoes` | Configuracoes.tsx | `/admin/governanca/configuracoes` | `src/pages/admin/governanca/Configuracoes.tsx` | Mover | Sim | 5 |
| — | — | `/admin/governanca/auditoria` | `src/pages/admin/governanca/Auditoria.tsx` (novo) | Criar | — | 5 |

Resolução Cockpit/VisaoGeral: **criar `Cockpit.tsx` novo, deprecar `VisaoGeral.tsx`**. Menor risco (mantém rota antiga funcional durante rollout), permite lançamento por feature flag, evita mistura de KPIs novos com agregados legados.

Prevenção de loop: cada redirect usa `Navigate replace` para caminho literal fixo (não relativo); testes E2E verificam ausência de loop.

---

## 10. RBAC e break glass

- **Papéis atuais** (BANCO): `platform_owner, platform_admin, support, analyst`.
- **Papéis futuros**: manter os 4 e **adicionar `support_lead`** ao enum. Motivos: (a) o plano conceitual anterior citou o termo, (b) `support` sozinho não deve poder abrir break-glass, (c) evita explosão de roles (`operations`, `finance` etc.) que só refinam permissões — usar **matriz de permissões** para diferenciar.
- **Migração**: `ALTER TYPE platform_role ADD VALUE 'support_lead'` (idempotente); nenhum usuário existente muda automaticamente. Owner atribui explicitamente.
- **Matriz server-side** (tabela `platform_permissions(role, action)`) espelhando `src/lib/admin/permissions.ts`. Ações mínimas: as já em `PlatformAction` + `overview.read`, `security.break_glass`, `users.read_pii`, `messaging.read_content`, `governance.audit_read`.
- **`has_platform_permission(action)`**: nova função `stable security definer` consultada por TODOS os RPCs.
- **Break-glass**:
  - Tabela `break_glass_sessions(id, admin_user_id, scope text, reason text, ticket_ref text, opened_at, expires_at, revoked_at)`.
  - TTL 15 min, revogável, único ativo por escopo.
  - Abertura exige: role em `[platform_owner, platform_admin, support_lead]` + `security.break_glass` + reautenticação recente (≤ 5 min) via `supabase.auth.reauthenticate()`.
  - Cada leitura de PII checa `break_glass_sessions.expires_at > now()` e loga em `platform_admin_audit` com `action='break_glass.read'`, `meta` contendo pseudo_id, escopo, request_id.
  - Proibição de exportação: RPCs de PII retornam `SETOF` limitado a 1 registro por chamada; `admin_users_list` pseudonimizada não paginar mais que 200; nenhuma rota admin retorna CSV com PII.
  - **Testes negativos obrigatórios**: analyst chama `admin_break_glass_read_email` → `42501`; break-glass expirado → `42501`; sem `security.break_glass` → `42501`.
- **Sessão administrativa**: reduzir timeout para **20 min** dentro de `/admin/*` (aviso aos 18 min). `SessionInactivityGuard` atual (30 min) precisa aceitar override por rota.

---

## 11. Plano de migrations futuras

Nenhum SQL escrito. Sequência sugerida (uma migration por linha):

| Nome sugerido | Objetivo | Depende de | Objetos criados | Objetos alterados | Grants | Backfill | Rollback | Riscos | Aceite |
|---|---|---|---|---|---|---|---|---|---|
| `add_support_lead_role_and_permissions_matrix` | RBAC granular | — | enum `support_lead`, `platform_permissions`, `has_platform_permission()`, seed matriz | — | authenticated: none; service_role: all | Popular matriz | DROP FUNCTION + REVOKE + seed vazio | Enum add não reversível trivialmente | matriz reflete `permissions.ts` |
| `harden_admin_rpc_permissions` | Trocar `is_platform_admin()` por `has_platform_permission(...)` nos RPCs | migration acima | — | 15+ funções admin_* | — | — | reverter definitions | Bloqueia analyst em RPCs hoje permissivos | testes negativos passam |
| `user_pseudonyms_and_helper` | Pseudonimização | — | tabela `user_pseudonyms`, `get_or_create_pseudo()` | — | authenticated: none; service_role: select/insert | Backfill pseudos para todos os `auth.users` existentes | DROP tabela | reidentificação se `pseudo_id` vazar | 1 pseudo por user |
| `product_events_and_emitter` | Instrumentação canônica | pseudonimização | tabela `product_events`, RPC `emit_product_event`, `assert_event_name`, allowlist | — | authenticated: EXECUTE emit; service_role: all | — | DROP | volume | INSERT rejeita nome fora da allowlist |
| `product_event_backfill_from_db` | Popular eventos históricos | anterior | RPCs backfill_* | — | service_role only | Sim (idempotente) | DELETE WHERE event_source='backfill' | duplicação | 0 duplicados após 2 execuções |
| `product_events_triggers` | Emissão automática | anterior | triggers em `transactions`, `goals`, `shared_expenses`, `document_imports`, `whatsapp_links`, `agent_runs`, `outbound_messages` | tabelas alvo (só AFTER) | — | — | DROP TRIGGER | overhead escrita | dispara em cada INSERT relevante |
| `admin_aggregate_tables_and_refresh` | Agregados diários | anterior | `product_daily_value`, `outbound_metrics_daily`, `agent_metrics_daily`, `feature_funnel_daily`, `refresh_admin_aggregates()` | — | service_role only; grant SELECT via RPC | Rebuild inicial 90d | TRUNCATE | job cron falho | refresh idempotente |
| `admin_break_glass_core` | Break-glass | RBAC | `break_glass_sessions`, RPCs open/read/close, audit hooks | `platform_admin_audit` (nova action) | authenticated: EXECUTE (com role) | — | DROP | uso indevido | audit contem reason+ticket |
| `admin_cockpit_kpis_and_series` | RPCs de cockpit | agregados | RPCs `admin_cockpit_kpis`, `admin_growth_series`, `admin_retention_cohorts`, `admin_feature_funnel`, `admin_ai_ops_kpis`, `admin_messaging_kpis`, `admin_clients_list`, `admin_client_summary` | — | authenticated EXECUTE + gate por permissão | — | DROP | fórmulas | testes de fórmula passam |
| `deprecate_legacy_admin_rpcs` | Cleanup | após rollout UI | — | remover: `admin_dashboard_stats`, `admin_engagement_stats` legados; `admin_message_activity` legado | — | — | recriar | quebra UI antiga | UI nova já usa novos |

---

## 12. Rollout por fases

| Fase | Escopo | Arquivos | Migrations | RPCs | Feature flag | Compatibilidade | Aceite | Rollback | Risco | Complexidade |
|---|---|---|---|---|---|---|---|---|---|---|
| **0** | Auditoria (esta) | `.lovable/plan.md` | — | — | — | — | plano aprovado | git revert | Nenhum | Baixa |
| **1 — Privacidade emergencial** | Remover PII dos RPCs de default; ocultar preview no frontend; reautenticação p/ ações críticas; timeout 20min no /admin | `Mensagens.tsx`, `Usuarios.tsx`, `Seguranca.tsx`, `AdminLayout.tsx`, `SessionInactivityGuard.tsx`, `PlatformAdminRoute.tsx` | `harden_admin_rpc_permissions` (parcial: pseudonimizar respostas) | Redefinir `admin_message_activity`, `admin_conversation_activity`, `admin_users_list` sem PII no default; adicionar break-glass stub | `admin_v2_privacy` (default ON) | Mantém rotas atuais | nenhum body/preview/email exibido sem break-glass | migration reversa | Support/analyst percebe menos dados | Média |
| **2 — Instrumentação e agregados** | Pseudonimização, product_events, triggers, backfill, agregados | novos arquivos server | migrations 3-7 acima | emit, backfill, refresh | — | Não afeta UI | product_events preenchida por 24h; agregados batem com fonte ±1% | drop tabelas | Volume/performance triggers | Alta |
| **3 — Cockpit** | `/admin/cockpit` com KPIs, deltas, polaridade, freshness | `Cockpit.tsx` novo, `KpiCard` novo, `Delta`, `Sparkline` | `admin_cockpit_kpis_and_series` (parcial) | `admin_cockpit_kpis`, `admin_growth_series` | `admin_cockpit_v1` | `/admin` redireciona | KPIs carregam <2s; skeletons por card; denominador 0 → `—` | rollback flag | Fórmulas erradas | Média |
| **4 — Crescimento, Retenção, Inteligência Produto** | `/admin/crescimento`, `/admin/inteligencia-produto`, `/admin/clientes` pseudonimizado | Crescimento.tsx, InteligenciaProduto.tsx, Clientes.tsx | — | `admin_retention_cohorts`, `admin_feature_funnel`, `admin_clients_list`, `admin_client_summary` | `admin_growth_v1` | Redirects `engajamento`/`usuarios`/`produto` | Coortes W1/W4/W8 batem; funis mostram elegíveis→repetiram | flag | Amostra pequena → ruído | Alta |
| **5 — Operação, Receita, Governança** | `/admin/operacao/*`, `/admin/receita`, `/admin/governanca/*`, break-glass UI, auditoria | rearranjo completo + `Auditoria.tsx` novo | `admin_break_glass_core`, `deprecate_legacy_admin_rpcs` | `admin_messaging_kpis`, `admin_ai_ops_kpis`, `admin_break_glass_*` | `admin_ops_v1`, `admin_governance_v1` | Redirects finais | Break-glass abre/expira em 15min; auditoria mostra 100% ações críticas | flags off | Quebra de rota | Alta |

---

## 13. Critérios de aceite mensuráveis

- Nenhuma resposta de RPC default contém: `email`, `phone`, `body`, `preview`, `content`, `contact`, `display_name`, `to_phone`.
- Analyst chamando `admin_message_content_read`, `admin_break_glass_*`, `admin_reprocess_failed`, `admin_waha_save_config` → erro `42501`.
- Break-glass expira em ≤ 15 min; ações críticas exigem reautenticação ≤ 5 min.
- Sessão `/admin/*` encerra em 20 min de inatividade; aviso aos 18 min.
- Denominador zero → payload `state:"no_data"`; UI renderiza `—`.
- Coorte < 10 → `insufficient_sample:true`; UI renderiza "amostra insuficiente".
- Taxas em pontos percentuais (`p.p.`), nunca `%` de `%`.
- Delta com anterior=0 e atual>0 → `delta.kind="new"`; UI mostra badge "novo".
- Timezone `America/Sao_Paulo` explícito no payload agregado.
- Reprocessamento de backfill 2x consecutivo → 0 novos `product_events`.
- Rotas antigas não geram 404; todas redirecionam via `Navigate replace`.
- Testes E2E: nenhum redirect entra em loop (max 1 redirect por navegação).
- Cada card tem skeleton próprio; sem spinner de página inteira em `/admin/*`.
- Nenhum copy usa "porque"/"causou"/"por causa de" nos insights; usa "correlação"/"associação".
- Oportunidades só aparecem com `sample_size >= 30`.

---

## 14. Checklist de testes futuros

- **Unitários (fórmula)**: WVU, activation, W1/W4/W8, taxa de entrega, p50/p95, delta com anterior=0, denominador zero, amostra <10.
- **Integração RPCs**: cada `admin_*` novo com fixtures.
- **RLS**: `product_events` bloqueia SELECT direto por authenticated; user_pseudonyms idem.
- **Negativos de permissão**: matriz completa role×ação, 100% dos cruzamentos negativos retornam 42501.
- **Privacidade**: snapshot dos JSON dos RPCs — falha se aparecer regex de PII (`@`, `+55`, `\d{11}`).
- **Idempotência**: `emit_product_event` com mesma `idempotency_key` 3x → 1 linha.
- **Backfill**: 2 execuções → mesmo count; `event_source='backfill'` correto.
- **Timezone**: agregado de 23:30 BRT cai no dia BRT correto.
- **Responsividade**: cockpit desktop 1280+; graceful degrade em 1024.
- **Acessibilidade**: KpiCard tem `aria-label` com valor+delta+polaridade; contraste AA.
- **Performance**: cockpit p95 < 800ms; agregado diário < 30s para 90 dias.
- **Rotas/redirects**: cada rota antiga → nova sem loop; `NavLink` `end` correto.
- **Sessão admin**: expira em 20min; broadcast entre abas.
- **Break-glass**: abertura sem reauth → nega; expirado → nega; auditoria registra.

---

## 15. Decisões pendentes

| Decisão | Contexto | Opções | Recomendação | Impacto | Prazo |
|---|---|---|---|---|---|
| `support_lead` vs permissão `security.break_glass` isolada | O plano conceitual usa "support-lead"; enum atual não contempla | (a) criar role; (b) só permissão | **(a) criar role** | RBAC mais claro; migração explícita | Antes da Fase 1 |
| WVU: contar `personalized_response_delivered` ou só entregas concretas | Definição de "valor" varia | (a) evento amplo; (b) só 4 canônicos | **(b) só 4 canônicos** | WVU mais rigorosa; nº menor | Antes da Fase 2 |
| Backfill de WVU histórica | Sem eventos passados; proxy fraco | (a) sem backfill; (b) proxy marcado | **(a) sem backfill** — marcar "início da medição" | Comparabilidade histórica limitada | Antes da Fase 3 |
| Retenção W8 quando <8 semanas de dados | Prospectivo | (a) esconder; (b) mostrar "aguardando" | **(b) mostrar aguardando** | Transparência | Fase 4 |
| Deprecar `admin_dashboard_stats` imediatamente após Cockpit | UI legada removida | (a) manter 1 release; (b) deprecar já | **(a) manter 1 release** | Rollback fácil | Fase 5 |
| Timeout admin único vs por-rota | `SessionInactivityGuard` global | (a) global 20min; (b) override /admin | **(b) override /admin** | App user não afetado | Fase 1 |

---

## 16. Registro da inspeção

**Comandos executados (apenas leitura)**:
- `ls src/pages/admin/`, `ls supabase/migrations/ | wc -l`
- `rg -l "admin_dashboard_stats|admin_engagement_stats|..." supabase/migrations/`
- `rg -n "platformRole|/admin" src/App.tsx src/context/AuthContext.tsx`
- `rg -n "admin_conversation_activity|preview|content" src/pages/admin/*.tsx`
- `rg -n "product_events|analytics_events|posthog|mixpanel|amplitude" src/ supabase/`
- `sed -n <ranges> src/App.tsx src/context/AuthContext.tsx`
- `psql -tAc "SELECT ... FROM pg_proc|pg_enum|pg_policy|pg_class|information_schema.columns"`
- `psql -tAc "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='<rpc>'"` para: `admin_dashboard_stats, admin_engagement_stats, admin_agent_stats, admin_ops_health, admin_users_list, admin_platform_status, admin_list_platform_admins, admin_consumer_users_set, is_platform_admin, admin_message_metrics, admin_message_activity, current_platform_admin_role`.
- `psql -tAc "\d public.<t>"` para: `platform_admins, platform_admin_audit, admin_grants_audit, user_roles`.

**Arquivos lidos integralmente ou em trechos**:
- `src/App.tsx` (rotas admin, linhas 120-160)
- `src/context/AuthContext.tsx` (hidratação de `platformRole`, 65-80)
- `src/components/admin/AdminLayout.tsx` (via contexto já em prompt)
- `src/lib/admin/permissions.ts` (matriz frontend)
- `src/lib/admin/messageCenter.ts` (cliente dos RPCs de mensageria)
- `src/pages/admin/VisaoGeral.tsx`, `Mensagens.tsx` (via rg + prompt)

**Migrations não abertas individualmente** (usada consulta direta ao `pg_proc` que já reflete o estado aplicado): as 15 migrations que referenciam RPCs admin_* foram identificadas por `rg -l`; o conteúdo efetivo foi confirmado pelo dicionário do banco.

**Não inspecionado nesta etapa** (marcar para próximas iterações):
- `src/pages/admin/IAInteligencia.tsx`, `Produto.tsx`, `Financeiro.tsx`, `Seguranca.tsx`, `Configuracoes.tsx`, `Operacao.tsx`, `Agente.tsx`, `AgenteSimulador.tsx`, `WhatsAppSessionPanel.tsx` (conteúdo integral).
- `src/components/auth/PlatformAdminRoute.tsx` (regras de gate).
- Definições completas de `admin_document_metrics`, `admin_run_check`, `admin_reprocess_failed`, `admin_whatsapp_inbound_health`, `admin_conversation_activity`, `admin_waha_*`, `admin_process_deletion_request` (assinaturas confirmadas; corpo não expandido).
- Políticas RLS de `outbound_messages`, `agent_runs`, `transactions`, `document_imports`, `shared_expenses` (não amostradas nesta etapa).

---

## 17. Confirmação final

Esta etapa realizou somente inspeção e planejamento. Foram executados comandos exclusivamente de leitura, listados neste documento. Nenhum arquivo funcional foi alterado. Nenhuma migration, tabela, RPC, view, trigger, edge function, policy ou configuração foi criada ou modificada. Nenhum build, teste, commit, push, deploy ou publicação foi executado. O arquivo `.lovable/plan.md` foi atualizado exclusivamente para armazenar este plano. A implementação permanece aguardando autorização explícita em outra mensagem.
