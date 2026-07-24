# Meu Nino Control Center — Plano Final Executável

**Status:** `READY_TO_EXECUTE_ALL_PHASES`
**Documento completo:** `.lovable/plan.md` (24 seções obrigatórias, ~13k caracteres, mantido íntegro — este texto é apenas o índice executivo).

Nada foi modificado no código, banco, migrations, edge functions ou configurações. Apenas `.lovable/plan.md` foi atualizado.

---

## Auditoria concluída (evidência real, não inferência)

- **24 RPCs `admin_*`** inspecionados via `pg_get_functiondef`. Todos gated apenas por `is_platform_admin()` — a matriz `MATRIX` em `src/lib/admin/permissions.ts` (4 roles × 22 ações) é 100% cosmética. Qualquer role chama qualquer RPC direto pelo cliente.
- **PII vaza em RPCs padrão**:
  - `admin_users_list` retorna `email` e `display_name`, com `ILIKE` sobre ambos.
  - `admin_message_activity` retorna `preview` (200 chars do body), `to_phone` mascarado, e faz `ILIKE '%…%'` sobre `body` e `to_phone`.
  - `admin_conversation_activity` retorna `contact` mascarado + `preview` (240 chars).
- **Enum `platform_role`** = `{platform_owner, platform_admin, support, analyst}` ✅. Tabelas `platform_admins`, `platform_admin_audit` existem; **não existem** `platform_permissions`, `has_platform_permission`, `user_pseudonyms`, `break_glass_sessions`, `product_events`, agregados de produto.
- **Timeout admin herda 30 min do app** — `AdminLayout` usa `<SessionInactivityGuard>` sem props e default é `30*60_000`. Precisa override para 20/18 min.
- **Drift legado:** `admin_ops_health.imports_recent` lê `import_batches` (pré Pipeline Documental v2) enquanto novos dados vão para `document_imports`.
- **Base analítica utilizável** já existe em `agent_runs`, `outbound_messages`, `document_imports`, `transactions`, `goals`, `shared_expenses` — permite backfill determinístico de eventos de negócio, mas **não** de entrega de valor (`insight_delivered`, `forecast_delivered`, `personalized_response_delivered`, `goal_progress_explained`, `split_result_delivered`, `split_reminder_prepared`). WVU oficial começa na Fase 2.

## Decisões técnicas fechadas (aplicadas neste plano)

- **RBAC server-side**: `platform_permissions(role, action, allowed)` + `has_platform_permission(action)` + `current_platform_permissions()`. 22 ações canônicas (§5 do plano). Semeadura owner/admin/support/analyst definida.
- **Break-glass**: só `platform_owner` v1, reauth ≤5min, motivo ≥20 chars + ticket, escopo 1 pseudo_id + fields allowlist, TTL 15min, banner persistente, auditoria imutável sem conteúdo lido.
- **Pseudonimização**: `user_pseudonyms(user_id, pseudo_id, detached_at)` com surrogate UUID (não hash). Resolução só via funções SECURITY DEFINER. Exclusão de conta detacha `user_id` mantendo `pseudo_id` para agregados.
- **Sessão admin**: 18min warning / 20min logout (override em `AdminLayout`), app usuário permanece 30min, BroadcastChannel entre abas, revalidação `getSession()` ao voltar de background, reauth ≤5min para ações críticas.
- **WVU / Ativação / Retenção**: WVU 7d rolling A∧B (entrada significativa E entrega de valor válida). Ativação 7d. W1/W4/W8 sobre coorte de ativados. Amostras específicas por tipo (10/20/30% share). Insights sem causalidade.
- **Envelope canônico** para todo RPC analítico (§11): `value/numerator/denominator/previous/delta_abs/delta_pct/delta_pp/delta_kind/sample_size/sufficient_sample/polarity/formula_version/timezone/measurement_started_at/data_quality/source_kind`.

## Arquitetura de rotas final

```
/admin → /admin/cockpit                (Cockpit.tsx novo)
/admin/crescimento
/admin/inteligencia-produto            (página nova, NÃO é IAInteligencia.tsx)
/admin/operacao/{saude,mensageria,ia-ocr,whatsapp,assistente,assistente/simulador}
/admin/clientes
/admin/receita
/admin/governanca/{configuracoes,seguranca,auditoria}
```

13 redirects legados feature-flagged por 1 release, testados contra loops. `VisaoGeral.tsx` mantido para rollback; `Produto.tsx` → Governança > Configurações; `IAInteligencia.tsx` desmembrada em Inteligência de Produto (agregado) + Operação/IA-OCR (técnico).

## Eventos e agregados (Fase 2)

- `product_events` append-only com allowlist enforced por trigger (sem PII, sem texto livre, valores em buckets `0_50/50_100/100_250/250_500/500_plus`), idempotency_key único, `event_source in (live|backfill|backfill_proxy)`.
- 6 tabelas agregadas físicas (não MV): `product_daily_value, outbound_metrics_daily, agent_metrics_daily, feature_funnel_daily, product_cohorts_weekly, user_lifecycle_daily`.
- Refresh incremental cron 15min + rebuild diário janela 3d; job monitorado via `job_heartbeats`.
- Timezone `America/Sao_Paulo` na agregação/exibição; UTC no armazenamento.
- Retenção: raw 90d, agregados perpétuos, auditoria ≥2 anos.
- 8 experiências mapeadas com máquina de estados, emissor real, idempotency e regra de sucesso (§9): registro financeiro, edição/categorização, meta, divisão, lembrete, OCR, resposta do agente, mensagem WhatsApp. `agent_run.status=done` **não** conta como sucesso sozinho.

## 21 RPCs futuros contratados (§13)

Inclui `admin_v2_cockpit, admin_v2_growth_*, admin_v2_product_*, admin_v2_operations_health, admin_v2_messaging_activity` (sem PII), `admin_v2_ia_ocr_metrics, admin_v2_whatsapp_monitor, admin_v2_assistant_health, admin_v2_clients_list` (pseudonimizada), `admin_v2_revenue_summary, admin_v2_governance_*, admin_v2_audit_list, current_platform_permissions, has_platform_permission, admin_open/close/read/active_break_glass, require_recent_reauth`.

## Rollout em 5 fases com gates

1. **Privacidade + RBAC + Timeout (bloqueadora)** — permissions server-side, pseudonimização, break-glass, timeout 20min, novos RPCs sem PII, revogar grants dos legados.
2. **Eventos e agregação** — `product_events`, triggers, agregados, jobs, backfill determinístico.
3. **Cockpit** — nova rota, KpiCard, gráfico, atenção, funil, saúde, redirects sob flag.
4. **Crescimento/Retenção/Produto/Clientes** — páginas novas, coortes, funis, oportunidades, clientes pseudonimizados.
5. **Operação/Receita/Governança + depreciação** — sub-rotas, break-glass completo, auditoria, remoção dos RPCs e páginas legadas após 1 release.

Cada fase avança somente com migrations aplicadas sem erro, testes unit/int/RLS/privacidade verdes, build/typecheck ok, smoke de rotas ok, rollback definido. **Sem publish automático** — preview + relatório e aguarda autorização.

## Design (recap)

DM Sans única, Deep Ink sidebar, Cloud bg, Violet informação, Coral degradação, Mint recuperação, sem gradiente/glass/sombras pesadas, ícones Phosphor nas telas novas, cards radius 14-16px, tabela header sticky, skeletons independentes, sem spinner de página, mobile <768px mostra só 4 KPIs + alertas + saúde + ações críticas + resumo (heatmaps/coortes escondidos com "Abra no desktop").

## Arquivos a criar/editar/mover/deprecar/remover

Mapeamento completo em §16 do `.lovable/plan.md`. Resumo: 13 páginas novas + ~12 componentes novos + ~14 hooks novos; editar `App.tsx`, `AdminLayout.tsx`, `SessionInactivityGuard.tsx`, `useSessionInactivity.ts`, `PlatformAdminRoute.tsx`, `permissions.ts`; mover 5 arquivos; deprecar 7 páginas por 1 release; remover 7 RPCs legados na Fase 5.

## Aceite, testes, riscos

- 26 critérios de aceite não negociáveis (§18).
- Checklist de testes abrangendo unit, integração, RLS/RBAC negativos, sessão, rotas/redirects, build, a11y, responsividade 768→1920, performance, freshness, rollback (§19).
- Riscos residuais mapeados: latência RPCs, WVU vs proxies históricos, custo de triggers em `outbound_messages`, disponibilidade de `agent_runs.cost_cents`, migração gradual Lucide→Phosphor (§20).

## Decisões humanas pendentes

Nenhuma. Todas as decisões técnicas estão fechadas. Falta **apenas autorização de execução por fase**.

---

**Confirmação obrigatória:** somente `.lovable/plan.md` foi atualizado nesta rodada. Nenhuma migration criada, nenhuma tabela/RPC/policy/grant alterada, nenhum build/teste/deploy/publicação executado. Aguardo autorização explícita para iniciar a Fase 1 e, em seguida, executar sequencialmente todas as fases com os gates definidos.
