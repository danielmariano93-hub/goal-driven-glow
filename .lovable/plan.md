
# Revisão Consolidada Meu Nino — Plano Definitivo

Classificação: **READY_AFTER_CORRECTIONS**. Nenhuma alteração funcional foi realizada nesta rodada. Toda ação é executável somente após aprovação.

## 1. Resumo Executivo

Top 10 riscos (severidade decrescente):
1. **P0 — Contrato de artefato divergente entre builder (`chart.series[].data`, v2) e renderer PNG/fallback (`data.series`, v1).** Causa `render_failed:unknown` e `fallback_text` em 100% dos gráficos no WhatsApp.
2. **P0 — Ausência de contrato canônico para pagamento de fatura.** Agente chama `create_transfer_draft` com `from1_account`/cartão em `to_account` → `account_not_found`, sem lançamento gravado.
3. **P0 — Fire-and-forget do dispatcher WhatsApp sem watchdog comprovado + timeout de render sem AbortController efetivo.** Filas presas 154–300s.
4. **P0 — Agente promete "aqui está o gráfico" com base apenas em `artifact_id`, sem confirmação de render/entrega.** Alucinação sistêmica.
5. **P0 — FastLog conclui tools/tx mas deixa `agent_runs.status='running'`, `ended_at=null`.** Métricas de saúde e SLA quebradas.
6. **P1 — Query keys divergentes `["credit_cards"]` vs `["credit-cards"]`.** Invalidação parcial → lançamento manual "some" da tela.
7. **P1 — Lançamento manual sem read-after-write; filtros no `sessionStorage` ocultam sem aviso.**
8. **P1 — Roteamento semântico: pedidos visuais caem em `intent='unknown'`; "dia da semana que mais gasto" usa concentração, não típico robusto v2.**
9. **P1 — Histórico do App só persiste texto; artefatos não reidratam ao reabrir painel.**
10. **P2 — Admin ainda vulnerável a divergências temporais e overloads residuais; PII em views legadas precisa nova auditoria.**

## 2. Matriz Definitiva de Defeitos

| ID | Feature | Sintoma | Causa (C=confirmada, H=hipótese) | Evidência | Sev | Correção definitiva |
|---|---|---|---|---|---|---|
| D01 | Pagamento fatura | `create_transfer_draft` com `from1_account`; cartão em `to_account` → `account_not_found` | C: prompt/tools não expõem `pay_credit_card_bill`; LLM inventa slots | `tools.ts:304`, `prompt.ts` sem `bill_payment` | Blocker | Nova tool `pay_credit_card_bill_draft(card_id, from_account_id, amount, occurred_at)` + `movement_kind='credit_card_bill_payment'` + `settles_card_id` obrigatório; validação estrita rejeita argumentos desconhecidos |
| D02 | Gráfico WhatsApp | `render_failed:unknown` / `canvas_unavailable`; `media_status='fallback_text'` | C: builder emite `payload.chart.series[].data` (v2), renderer PNG lê `payload.data.series` | `png.ts:68`, `ChartArtifactRenderer.tsx:35` | Blocker | Contrato único `chart.artifact.v2` com normalizer `toRenderableSeries(payload)`; validação Zod antes de persistir; renderer usa normalizer |
| D03 | Gráfico App | Só texto; sem reidratação | C: `conversation_messages` guarda apenas texto; sem FK a `agent_artifacts` | `ConversationHistory.ts` | P0 | Coluna `artifact_id`/`artifact_ids[]` em `conversation_messages`; hidratação por join no fetch |
| D04 | Fila WA | 154–300s parada | C: `triggerDispatcher()` fire-and-forget; sem watchdog cron efetivo | `whatsapp-send/index.ts` | P0 | Cron `pg_cron` 30s → `net.http_post` para `whatsapp-send`; `SKIP LOCKED` + lease 60s + retry exponencial + dead-letter; timeout 25s no fetch de `artifact-render` |
| D05 | Alucinação | "Aqui está o gráfico" sem PNG | C: `ResponseValidator` valida draft/receipt mas `GRAPH_CLAIM_RX` só cobre alguns padrões; `artifact_status` fica `generated` | `ResponseValidator.ts`, `AgentCore.ts` | P0 | Guardrail: só permitir claim se `artifact_status='delivered'` (WA) ou `'ready'` (App); caso contrário reescreve para "Estou preparando o gráfico…" |
| D06 | FastLog lifecycle | `status='running'`, `ended_at=null` | C: `runFastLog` não fecha `agent_runs` no happy path | `FastLog.ts` | P0 | Finalizador `try/finally` marca `status='done'`, `ended_at=now()`, `latency_ms`; job varre runs órfãos >5min |
| D07 | Manual cache | Lançamento não aparece | C: `["credit_cards"]` vs `["credit-cards"]` divergentes | `invalidation.ts:21`, `creditCards.ts:26` | P1 | Padronizar em `["credit_cards"]`; helper único `invalidateFinancialQueries`; read-after-write com `.select().single()` |
| D08 | Filtros ocultam | Sem aviso | H: filtros persistidos em `sessionStorage` | `Lancamentos.tsx` | P1 | Após insert, se linha nova não passa nos filtros ativos, banner "Lançamento salvo mas oculto pelo filtro X — mostrar" |
| D09 | Intent visual | `unknown` | H: `IntentRouter` não tem regra para pedido visual | `IntentRouter.ts` | P1 | Regex determinístico "grafico\|gráfico\|visual\|imagem" → intent `visualization` |
| D10 | Weekday robust | Retorna concentração | H: função publicada difere de `weekday.robust.v2` | logs | P1 | Confirmar `formula_version` em prod vs Git; republicar se divergente |
| D11 | Admin contagem 3 | admin conta como cliente em algum ponto | H: 1 RPC legada não usa `v_client_users` | `admin_v2_*` | P2 | Grep de todas RPCs `admin_v2_*` para `auth.users`/`profiles` sem filtro; padronizar em `v_client_users` |
| D12 | ACK WA | `accepted_at/delivered_at/read_at` nulos | H: correlação por `provider_message_id` falhando | `outbound_messages` | P2 | Verificar mapping WAHA→`apply_outbound_ack`; index em `provider_message_id` |

## 3. Arquitetura Atual → Alvo

**Fluxos hoje:**
```text
[App]  UI ──► supabase RPC/insert ──► transactions
[WA]   waha ─► whatsapp-webhook ─► agent-run ─► tools ─► transactions
                                              └─► agent_artifacts ─► outbound_messages ─► whatsapp-send ─► artifact-render(PNG)
[FastLog] regex ─► runFastLog ─► tools ─► (agent_runs NÃO fecha)
```

**Alvo:**
```text
Todas as escritas financeiras ──► finance.commitMovement(kind, payload) ──► transactions (RLS + trigger competência)
                                    ↑
        App form, agent tool, FastLog, importer — mesmo ponto único.

Artefato ──► buildChartArtifactV2 ──► zodValidate ──► agent_artifacts
                                                          │
                                          App: ChartArtifactRenderer(v2)
                                          WA: artifact-render(v2) ──► storage ──► outbound(image)
                                                                            │
                                                                Estado: calculating→persisted→rendering→ready→queued→accepted→delivered|failed
```

Componentes a **consolidar**: `NotificationDispatcher` (facade) já ok; unificar `png.ts` + `artifact-render/index.ts` num único renderer que consome o mesmo `toRenderableSeries`. **Remover**: caminho de render `@napi-rs/canvas` (não roda no Edge) — manter só o TS puro.

## 4. Plano em Ondas

### Onda 0 — Snapshots e proteção (sem risco)
| Ordem | Objeto | Alteração | Dep | Risco | Teste | Deploy |
|---|---|---|---|---|---|---|
| 0.1 | Snapshot SQL | Dump `agent_artifacts`, `outbound_messages`, `transactions`, `agent_runs` últimos 30d | — | 0 | count antes/depois | não |
| 0.2 | Feature flag | `agent_v2_bill_payment`, `artifact_v2_contract`, `wa_watchdog` em `financial_feature_flags` | — | 0 | leitura por user | migration |

### Onda 1 — P0 integridade e entrega
| Ordem | Arquivo/objeto | Alteração | Dep | Risco | Teste | Deploy |
|---|---|---|---|---|---|---|
| 1.1 | `_shared/artifacts/normalize.ts` (novo) | `toRenderableSeries(payload)` cobre v1+v2 | — | baixo | unit fixtures | edge |
| 1.2 | `_shared/artifacts/png.ts` | Usa normalizer | 1.1 | baixo | render 3 fixtures | edge |
| 1.3 | `artifact-render/index.ts` | Usa normalizer + AbortController 20s + retry 1x | 1.1 | médio | integração | edge |
| 1.4 | `agent/tools.ts` + `prompt.ts` | Nova tool `pay_credit_card_bill_draft`; validar `movement_kind` em `record_expense`; rejeitar args desconhecidos | — | médio | 4 cenários agente | edge |
| 1.5 | migration `credit_card_bill_payment` | Enum `movement_kind` já suporta? — validar; senão aditivo; trigger garante `settles_card_id` quando kind=bill_payment | 1.4 | médio | SQL | mig |
| 1.6 | `ResponseValidator.ts` | Bloqueia claim de gráfico até `artifact_status ∈ {ready,delivered}` | — | baixo | unit | edge |
| 1.7 | `AgentCore.ts` | Propaga `artifact_status` real (rendered/delivered) para `agent_turn_events` | 1.3 | médio | E2E | edge |
| 1.8 | `FastLog.ts` | `try/finally` fecha run com status/latency | — | baixo | unit | edge |
| 1.9 | migration cron | `whatsapp-send-dispatch-30s` + `fastlog-orphan-sweep-5m` | — | baixo | `cron.job` | mig |
| 1.10 | `whatsapp-send/index.ts` | Lease 60s, `SKIP LOCKED`, dead-letter, timeout render 20s | 1.9 | médio | fila simulada | edge |

### Onda 2 — Contratos canônicos
| Ordem | Objeto | Alteração |
|---|---|---|
| 2.1 | `_shared/finance/commit.ts` (novo) | API única `commitMovement({kind, ...})` usada por App/agent/FastLog/import |
| 2.2 | RPC `commit_movement` | Server-side validation por kind, retorna linha final |
| 2.3 | Zod `chart.artifact.v2.ts` | Schema + validação antes de insert |
| 2.4 | `conversation_messages` | Coluna `artifact_ids uuid[]`, backfill NULL |
| 2.5 | App history | Hidrata artefatos pelo FK |

### Onda 3 — UX, observabilidade, Admin
| 3.1 | Banner "salvo mas oculto pelo filtro" em Lançamentos |
| 3.2 | Toast "Gerando gráfico…" com timeout visual |
| 3.3 | Query keys padronizadas `["credit_cards"]` |
| 3.4 | Read-after-write em `useSaveTransaction` |
| 3.5 | `IntentRouter` regra `visualization` determinística |
| 3.6 | Auditoria RPCs `admin_v2_*` → `v_client_users` |
| 3.7 | Dashboard filas WA + FastLog órfãos + render failure |

### Onda 4 — Homologação completa
17 cenários da seção "Testes Obrigatórios" + regressão.

## 5. Arquivos e Objetos

**Frontend:** `src/lib/db/finance.ts`, `src/lib/db/invalidation.ts`, `src/lib/db/creditCards.ts`, `src/pages/Lancamentos.tsx`, `src/pages/Cartoes.tsx`, `src/components/assessor/artifacts/ChartArtifactRenderer.tsx`, `src/context/AssessorContext.tsx`.

**Edge Functions:** `whatsapp-send`, `artifact-render`, `agent-run`, `agent-chat`, `whatsapp-webhook`.

**Shared:** `_shared/agent/tools.ts`, `_shared/agent/prompt.ts`, `_shared/agent/core/{AgentCore,ResponseValidator,FastLog,IntentRouter}.ts`, `_shared/artifacts/{png,normalize}.ts`, `_shared/finance/commit.ts` (novo).

**Migrations (aditivas):**
- `..._artifact_v2_contract.sql` (coluna `contract_version` em `agent_artifacts`, backfill 'v2')
- `..._conversation_messages_artifact_ids.sql`
- `..._movement_kind_bill_payment.sql` (se enum não cobre) + trigger
- `..._cron_wa_dispatch_and_fastlog_sweep.sql`
- `..._feature_flags_agent_v2.sql`
- `..._commit_movement_rpc.sql`

**Testes:** 17 novos em `src/test/` + fixtures anonimizadas de artefato v1/v2, WA queue, FastLog lifecycle.

## 6. Migrations

Todas aditivas, idempotentes (`IF NOT EXISTS`, `DO $$` para enums). Backfill:
- `agent_artifacts.contract_version = 'v1'` para linhas atuais; novas gravam `'v2'`.
- Nenhum DROP; rollback = feature flag off.

## 7. Critérios de Aceite

- P95 lançamento simples ≤ 5s.
- P95 gráfico App ≤ 15s.
- P95 imagem WA aceita ≤ 30s.
- Fila WA >60s ⇒ alerta.
- 0 mensagens "aqui está o gráfico" sem entrega confirmada (métrica `graph_claim_without_delivery` = 0).
- 0 admin em `admin_v2_clients_list`.
- 0 `agent_runs` FastLog `status='running'` > 5min.
- 0 `create_transfer_draft` com destino cartão.

## 8. Homologação

Para cada cenário: SQL antes → ação UI/WA → SQL depois → screenshot/log → verificação SHA (`SELECT current_setting('app.git_sha')` se disponível; senão comparar `functions.deployed_at` vs commit).

## 9. Rollout / Rollback

Ordem: (1) Onda 0 migrations flag/snapshot, (2) Onda 1 migrations, (3) Deploy Edge Functions Onda 1, (4) Frontend Onda 1, (5) Canário 24h com 1 usuário admin, (6) Onda 2, etc.

Rollback por onda = flag OFF + redeploy commit anterior. Dados preservados pois todas migrations são aditivas.

## 10. Estimativa

- Onda 0: 1 patch, baixo custo.
- Onda 1: **1 patch consolidado** (P0 crítico; alto ROI).
- Onda 2: 1 patch (contratos).
- Onda 3: 1 patch (UX + Admin).
- Onda 4: 1 patch (testes).

Total: 5 patches. Ondas 1 e 2 **devem** ser separadas por segurança (contrato canônico pode desestabilizar imports).

## 11. Prompt Final de Implementação (copy/paste após aprovação)

```
EXECUTAR ONDA 1 DO PLANO CONSOLIDADO MEU NINO (.lovable/plan.md).
Escopo estrito: itens 1.1 a 1.10. Não avançar para Onda 2.
Entregar em patch único: normalizer de artefato, renderer PNG, artifact-render
com AbortController, nova tool pay_credit_card_bill_draft, ResponseValidator
com guardrail de gráfico, FastLog lifecycle, cron watchdog WA + varredura
FastLog, whatsapp-send com SKIP LOCKED e dead-letter. Rodar migrations
aditivas na ordem indicada. Deploy das 5 Edge Functions afetadas. Validar
com os 17 cenários; abortar e reportar se qualquer P0 falhar.
```

---
**Confirmação:** nenhuma alteração funcional, migration, deploy ou publicação foi realizada nesta rodada. Aguardando aprovação para executar a Onda 0 + Onda 1.
