
# Diagnóstico Staff — Meu Nino: fatura, lançamento manual e gráfico não entregue

Confirmação: **nenhum arquivo, migration, deploy ou publicação foi realizado**. Apenas leitura.

---

## 1. Sintomas × causas prováveis (probabilidade × impacto)

Legenda: P (probabilidade) / I (impacto de negócio), escala 1–5.

### Sintoma A — "Despesa de fatura do cartão" mal compreendida
| # | Hipótese | Evidência | P | I |
|---|---|---|---|---|
| A1 | Sem intent determinístico para "fatura/competência"; decisão delegada 100% ao LLM | `parser.ts` sem `fatura/invoice/competence`; `PolicyEngine.decideTurn` só distingue `transaction/transfer/goal/query` | 5 | 5 |
| A2 | Nenhum schema de tool aceita `competence`/`invoice_month` — só `occurred_at` (data da compra) | `tools.ts:260-302,955-970` — sem `competence_date`; `resolveOccurredAt` só valida ISO | 5 | 5 |
| A3 | Não há tool distinta para "pagamento de fatura" (quitação) vs "compra no cartão" | `analyze_spending` exclui pagamento (`tools.ts:926`) mas nenhuma tool o modela; ambos caem em `create_transaction_draft` | 4 | 4 |
| A4 | Fast-path do App reconhece cartão por regex mas não pergunta competência | `AppAdapter.ts:23-24,269-312` — `CARD_KEYWORDS`/`SINGLE_CARD_HINT` sem heurística de mês da fatura | 4 | 3 |
| A5 | Ambiguidade `credit_card` + `account` no mesmo draft não é validada no `execute` | Schema pede "não misture" (`tools.ts:956`), executor não bloqueia | 3 | 3 |

### Sintoma B — Lançamento manual "não apareceu onde deveria"
| # | Hipótese | Evidência | P | I |
|---|---|---|---|---|
| B1 | Form manual **nunca envia `competence_date`** para despesa de cartão | `Lancamentos.tsx:794-880` (sem campo); `finance.ts:316-328` (payload fixo sem `competence_date`) | 5 | 5 |
| B2 | `Cartoes.tsx:24` descarta transações com `competence_date NULL` (`if (!cid || !comp) continue`) | mesma linha | 5 | 5 |
| B3 | `facts.ts:172-194` calcula fatura sem exigir `competence_date` → **duas fontes divergentes** de "fatura em aberto" | mesma referência | 5 | 4 |
| B4 | `useSaveTransaction` invalida só `["transactions"]` e `["dashboard"]`, não usa `invalidateFinancialQueries` | `finance.ts:344-346` — pulse/insights/credit-cards/financial-snapshot ficam com cache velho | 4 | 4 |
| B5 | Zero subscriptions Realtime em `transactions` — escritas fora dos hooks (RPCs, edge functions, importação) não atualizam UI até refetch manual | `grep` postgres_changes/transactions = ∅ | 4 | 4 |
| B6 | `status=planned` no form some da Home/PonteCaixa (que filtram `confirmed`) mas fica no Extrato (que não filtra status) | `facts.ts:227,251,325,336` vs `finance.ts:264-304` | 3 | 3 |
| B7 | `movement_kind` não é setado pelo form; se default do banco não for `transaction`, fluxos de agregação excluem | `facts.ts:230,329,339`; payload sem `movement_kind` | 3 | 4 |

### Sintoma C — Gráfico "gerado" mas não entregue, >3 min
| # | Hipótese | Evidência | P | I |
|---|---|---|---|---|
| C1 | Agente confirma entrega checando só existência de `artifact_id` (row de insert), **não** `media_url`/`delivered_at` | `AgentCore.ts:356-366` — regex `/aqui\|segue\|preparei\|gerei\|enviei.*gráfico/` só valida uniqueness da fala | 5 | 5 |
| C2 | Dispatch do worker `whatsapp-send` é `EdgeRuntime.waitUntil(triggerDispatcher())` fire-and-forget com `.catch(()=>{})` — sem retry programado se o isolate morrer | `whatsapp-webhook/index.ts:107-120,423-428` | 5 | 5 |
| C3 | `whatsapp-ack-watchdog` está em `config.toml` mas **não há `cron.schedule` confirmado** para ele — rede de segurança presumida, não instalada | `grep cron.schedule` só encontra `split-message-pipeline-1m` | 4 | 5 |
| C4 | `fetch(artifact-render)` em `whatsapp-send/index.ts:65-84` **sem `AbortController`/timeout** — render travado congela o lote | mesmo trecho | 4 | 4 |
| C5 | `agent_artifacts` não tem `status`/`retries`/`last_error` — falha de render não é observável pela tabela do artefato, só via `outbound_messages.last_error` | `20260723154638_...sql:22-33`; `artifact-render/index.ts:136-142` grava só sucesso | 4 | 3 |
| C6 | `generate_chart_artifact` insere nova linha em `agent_artifacts` sem dedupKey — retries do LLM criam artefatos órfãos | `tools.ts:843-849` sem unique | 3 | 2 |
| C7 | Sem lock por `artifact_id` — dois `outbound_messages` referenciando o mesmo artefato podem renderizar em paralelo | `SKIP LOCKED` só em `outbound_messages` | 2 | 2 |
| C8 | `agent_turn_events.artifact_status` fica travado em `"generated"` — nunca é atualizado para `delivered`/`failed` após entrega real | `AgentCore.ts:461-478` só insere; sem update no `whatsapp-send` | 5 | 3 |

---

## 2. Componentes a auditar (mapa completo)

**Edge functions**
- `supabase/functions/agent-chat`, `supabase/functions/_shared/agent/*` (AgentCore, IntentRouter, parser, PolicyEngine, ToolRuntime, tools, prompt, ResponseValidator, AppAdapter, OutboundQueue, Observability, CommunicationDispatcherV2, llm)
- `supabase/functions/artifact-render/index.ts` e `_shared/artifacts/png.ts`
- `supabase/functions/whatsapp-webhook/index.ts` (fire-and-forget), `whatsapp-send/index.ts` (worker fila), `whatsapp-ack-watchdog`

**Tabelas / RPCs**
- `transactions` (colunas `competence_date`, `movement_kind`, `status`, `credit_card_id`); triggers `_touch_updated_at`, `bump_transaction_version`
- `agent_artifacts` (schema, estados), `agent_turn_events` (`artifact_status`), `agent_runs`, `agent_tool_calls`
- `outbound_messages` (`media_status`, `artifact_id`, `last_error`, `idempotency_key`), `job_heartbeats`
- RPCs `agent_upsert_draft`, `agent_execute_confirmation`, `credit_card_competence`, `claim_outbound_batch`

**Front-end**
- `src/pages/Lancamentos.tsx` (form manual, FAB), `src/lib/db/finance.ts` (useSaveTransaction, useTransactions), `src/lib/db/invalidation.ts`
- `src/pages/Cartoes.tsx` (agrupamento por fatura), `src/lib/engine/facts.ts` (duas fontes de fatura)
- `src/components/home/HeroDisponivelCard.tsx`, `PonteCaixaCard.tsx`, `AssessorPanel.tsx`, `ChartArtifactRenderer.tsx`

---

## 3. Plano de correção (ondas)

### Onda 1 — Estancar sangramento (P0, 1 sprint)
1. **Watchdog cron real para `outbound_messages`** — instalar `cron.schedule` (ex. `whatsapp-send-watchdog-30s`) chamando `whatsapp-send` para reprocessar linhas com `status in ('queued','processing')` e `lease_expires_at < now()`. Fecha C2/C3.
2. **Timeout explícito no `fetch(artifact-render)`** — `AbortController` 25s + retry com backoff (max 3). Fecha C4.
3. **Guardrail de artefato no `ResponseValidator`** — nova regra `GRAPH_CLAIM_RX`: se resposta afirma "gerei/enviei/segue gráfico", exigir `ValidationContext.artifact_ready === true` (com `media_url` no WhatsApp, `payload` inline no App). Fecha C1.
4. **Update de `agent_turn_events.artifact_status` para `delivered/failed`** no `whatsapp-send` após `sendImage`/fallback. Fecha C8.
5. **Campo de competência no form manual de cartão**:
   - Adicionar `competence_date` ao payload de `useSaveTransaction` quando `credit_card_id != null`;
   - default via RPC `credit_card_competence(card_id, occurred_at)`;
   - unificar `Cartoes.tsx` e `facts.ts:172-194` para usar a mesma função canônica de "fatura em aberto" (competência derivada, não coluna direta). Fecha B1/B2/B3.
6. **`useSaveTransaction`/`useDelete`/`useCreateTransfer` chamar `invalidateFinancialQueries`** em vez de invalidar chaves parciais. Fecha B4.

### Onda 2 — Contratos e observabilidade (P1, 1 sprint)
7. **Estado canônico em `agent_artifacts`**: colunas `status ('pending'|'rendering'|'ready'|'failed'|'delivered')`, `render_attempts`, `render_duration_ms`, `last_error`, `dedupe_key` (única por `run_id + kind + hash(payload)`). Fecha C5/C6.
8. **Intent determinístico para cartão**:
   - `parser.ts` reconhece "fatura", "no crédito", "no cartão do X" e retorna `ParsedIntent.kind = "credit_card_expense" | "credit_card_payment"`;
   - `PolicyEngine` roteia para tools distintas: `create_credit_card_expense_draft` (com `competence_date` obrigatório) e `register_credit_card_payment_draft` (quitação). Fecha A1/A2/A3.
9. **Validação server-side de mutual exclusion** `account` × `credit_card` em `create_transaction_draft.execute`. Fecha A5.
10. **Realtime seletivo**: subscription `postgres_changes` em `transactions` filtrada por `user_id`, invalidando `invalidateFinancialQueries` no client. Fecha B5.
11. **Enrich em `agent_tool_calls`**: colunas `resolved_ids jsonb` (ex. `{credit_card_id, competence_date, account_id}`) para auditoria de "cartão certo".

### Onda 3 — UX de operação demorada (P2, 0.5 sprint)
12. **App**: quando artefato está `rendering`, resposta do chat deve exibir `ChartSkeleton` + toast "gerando…"; ao concluir, hidratação via realtime em `agent_artifacts`.
13. **WhatsApp**: se `render_duration_ms > 8000`, enviar `sendText("Preparando gráfico… mando em instantes.")` e disparar imagem quando pronta (segunda `outbound_messages`, `idempotency_key = artifact:{id}:media`).
14. **Prompt update**: instrução explícita "nunca afirme entrega de gráfico; espere confirmação da ferramenta" alinhada com C1.

---

## 4. Testes automatizados

- **Unit / edge (Deno)**
  - `parser.test`: "paguei R$120 no cartão Nubank ontem" → `credit_card_expense` com `competence_date` derivado.
  - `parser.test`: "paguei a fatura do Itaú" → `credit_card_payment`.
  - `ResponseValidator.test`: "aqui está o gráfico" sem `artifact_ready` → **rejeitado**, resposta reescrita.
  - `artifact-render.test`: timeout artificial ≥25s → caller cai para fallback, `outbound_messages.media_status='fallback_text'`, `agent_artifacts.status='failed'`.
- **Integração (SQL)**
  - RPC `credit_card_competence` para várias datas (antes/depois do fechamento).
  - `insert transaction` com `credit_card_id` sem `competence_date` → **falha** por check/trigger.
- **UI (Vitest + Testing Library)**
  - Criar lançamento no cartão via form → aparece imediatamente em Home, Ponte Caixa, Cartões (na fatura correta).
  - `invalidateFinancialQueries` disparado por `useSaveTransaction` (mock `qc.invalidateQueries` recebe cada chave).
- **E2E (Playwright headless localhost)**
  - Chat: pede gráfico → skeleton aparece → gráfico renderiza (sem afirmação prematura no texto).
  - Simular falha do render → mensagem de fallback textual, sem "gerei o gráfico".

## 5. Métricas e SLAs

Novo dashboard admin (RPC `admin_v2_agent_delivery`):
- `artifact_render_p50_ms`, `p95_ms`, `failure_rate_24h` — **SLA p95 ≤ 6s, failure ≤ 1%**.
- `outbound_media_success_rate_24h` — **SLA ≥ 98%**.
- `queued_over_60s_count` — **alerta se > 0 por >2min**.
- `agent_hallucination_rate` = respostas rejeitadas pelo `ResponseValidator.GRAPH_CLAIM_RX` / total — **SLA ≤ 0,5%**.
- `credit_card_expense_intent_precision` (amostra revisada semanal) — **≥ 95%**.
- `manual_entry_visibility_gap_ms` (tempo entre insert e visibilidade na UI) — **p95 ≤ 500ms com realtime**.

## 6. Idempotência e retry

- `outbound_messages.idempotency_key` já existente — bom.
- Adicionar `idempotency_key = "artifact:{artifact_id}:media"` para segundo envio de imagem (Onda 3, item 13).
- `dedupe_key` em `agent_artifacts` evita re-inserts (Onda 2, item 7).
- Retries com backoff exponencial (2s, 8s, 30s) para `artifact-render`, ceiling `render_attempts=3` → `status='failed'` e fallback text.

## 7. Critérios de aceite

- **A**: 20 mensagens variadas de "fatura/cartão" (compra, quitação, parcelado) → intent correto e `competence_date` derivado em ≥ 19/20; nenhum draft com `credit_card_id` e `competence_date` nulo simultaneamente.
- **B**: Lançamento manual em cartão aparece em Home, PonteCaixa, Extrato **e** dentro da fatura correta em Cartões, em ≤ 500ms, sem F5.
- **C**: Em 50 pedidos de gráfico, 0 respostas contêm "gerei/enviei gráfico" sem que o cliente já tenha `payload` (App) ou `media_url` (WhatsApp). Em cenário de falha simulada do render, o usuário recebe **texto de fallback claro em ≤ 30s**, nunca alegação falsa de entrega.
- **Observabilidade**: para qualquer turno, é possível reconstruir do banco: intent, tools executadas, artifact_id, render duration, delivery status, canal — sem depender de logs efêmeros.

---

## 8. Riscos e ordem de execução

- Onda 1 é aditiva e reversível (cron novo, timeout, guardrail, coluna opcional). Aplicar primeiro.
- Onda 2 exige migration com `dedupe_key` unique e backfill de `competence_date` para transações antigas — testar em staging com snapshot real.
- Onda 3 depende de realtime — validar RLS de `transactions`/`agent_artifacts` antes de habilitar canal para `authenticated`.

**Nada foi alterado neste turno.** Aguardo aprovação para executar em ondas.
