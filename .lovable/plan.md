
# Plano consolidado — Fluxo de documentos do assessor + WhatsApp

## 1. Diagnóstico confirmado

**No código (arquivos lidos: `assistant-ingest-document/index.ts`, `_shared/documents/types.ts`, `_shared/documents/normalize.ts`, `whatsapp-webhook/index.ts`, `_shared/messaging/waha.ts`, `_shared/messaging/wahaInbound.ts`, `_shared/agent/orchestrator.ts`, `AssessorPanel.tsx`, `AssessorAttachButton.tsx`):**

- `normalizeAmountBR` rejeita corretamente `0`, negativos, `NaN` e infinitos tanto para número quanto para string. **A hipótese de que zero como número escapa está incorreta.**
- `sanitize` normaliza `type` para `income|expense` e filtra `movement_kind === "informational"`. **Porém não valida o whitelist do banco:** valores como `transfer`, `payment`, `purchase`, `fee`, `credit`, `debit` são reencaminhados literalmente à coluna, violando `extracted_items_movement_kind_check`.
- `normalizeDateBR` valida ISO real e distância <=370 dias, mas aceita mês/dia inválidos em ISO e datas parciais fora de faixa terminam no fallback silenciosamente sem marca de baixa confiança.
- **Inserção em lote sem quarentena:** `sb.from("extracted_items").insert(rows)` — uma linha inválida derruba todas do lote (`items_insert: check constraint`), como registrado no `document_imports 2c72f7f6…`.
- **Batching não determinístico:** cada iteração reenvia o PDF inteiro + exclude list. Sem paginação real (`PDF_BATCHES=5`, `dataUrl` completo). Custo repetido e risco de invalid_json (confirmado em vários `document_imports` recentes com erro `extraction:invalid_json`).
- **Recuperação de JSON truncado exige `"i":`** — se o modelo devolve JSON mal formado antes desse marcador, todo o lote é perdido.
- **Fluxo WhatsApp NÃO trata mídia.** `whatsapp-webhook/index.ts` chama `runOrchestrator` **apenas com texto**; `NormalizedInbound.media` é extraído em `wahaInbound.ts` mas nunca consumido. Não há download, não há criação de `document_imports` a partir de mensagem WhatsApp, não há confirmação ao usuário. Isso responde o "PDF enviado e nada aconteceu".
- **Processamento durável frágil:** `EdgeRuntime.waitUntil` + heartbeat a cada 20s + `PROCESSING_STALE_MS=5min`. Se a isolate morrer, o job só é retomado quando o painel do assessor faz polling e chama `resume`. Sem worker/watchdog independente. Nenhum fluxo assíncrono suportado para o WhatsApp (usuário não abre painel).
- **Anti-loop parcial:** `resume` verifica `updated_at` para não invadir job vivo, mas não há contador `attempt_count` nem `next_attempt_at` durável. Falhas sequenciais podem reprocessar indefinidamente se reabertas.

**No banco (`supabase--read_query`):**

- Constraints reais de `extracted_items`:
  - `amount > 0` (violado 1x hoje, `document 2c72f7f6…`).
  - `movement_kind ∈ {transaction, refund, internal_transfer, investment_application, investment_redemption}` — sem `informational`.
  - `type ∈ {income, expense}`; `payment_method ∈ {account, credit_card, null}`.
  - `status ∈ {needs_review, ignored, confirmed, duplicate_suspect, rejected, failed, rolled_back}` — **`rejected` e `failed` já existem**, podemos usar para quarentena in-line sem migration extra de tabela.
- Últimos 8 `document_imports`: 3 `extraction:invalid_json`, 1 `items_insert:amount_check`, 1 `timeout:aborted`, 2 `upload_missing`, 1 `canceled` com 235 itens.
- Não existe tabela de eventos de progresso; painel do assessor consome `document_imports.counters`/status.

## 2. Hipóteses do usuário — o que foi confirmado

| Hipótese | Confirmada? | Nota |
|---|---|---|
| Falha `amount_check` derruba lote | **Sim** | Mas causa não é number/string — é linha com amount 0 sobrevivendo por outro path. Corrigir com quarentena e revalidação pós-normalização. |
| Falta whitelist de `movement_kind` e `type` | **Sim** para `movement_kind`; parcial para `type` | Precisa normalizar/quarentenar. |
| Um item inválido derruba o lote | **Sim** | Ausência de per-row insert / try-per-row. |
| Batching reenvia PDF inteiro | **Sim** | Reprocessa custo. |
| `waitUntil` insuficiente | **Sim, parcial** | Frontend sustenta o retry, WhatsApp não tem quem sustente. |
| WhatsApp não encaminha mídia | **Sim, crítico** | Nenhum code path. |
| Sem comunicação de status pelo WhatsApp | **Sim** | Ausência de outbound de progresso. |
| Painel sem estados claros / risco de loop | **Parcialmente** | Estados existem mas reabrir dispara `resume`. |

**Não confirmado:** que number 0 escape `normalizeAmountBR`. A rota real do zero é outra (provavelmente item com `movement_kind` desconhecido cujo amount passou zero após normalização adicional externa — a ser fechado no fix).

## 3. Arquivos que serão alterados

**Contrato de extração / validação:**
- `supabase/functions/_shared/documents/types.ts` — endurecer sanitize, exportar `validateExtractedRow` com whitelists e resultado `{ ok, row } | { ok:false, reason, field }`.
- `supabase/functions/_shared/documents/normalize.ts` — sem mudanças estruturais.

**Ingestão:**
- `supabase/functions/assistant-ingest-document/index.ts`:
  - Validar cada `row` antes do `insert` e separar em `valid_rows` / `rejected_rows`.
  - Persistir válidos com insert em lote; se ainda falhar, degradar para insert linha-a-linha (raro).
  - Persistir rejeições em `extracted_items` com `status='rejected'` + `duplicate_reason='rejected:<code>'` OU numa nova tabela leve — decisão: **usar `extracted_items` com `status='rejected'`** (sem migration nova).
  - Substituir `recoverCompactJson` por parser tolerante que aceita JSON truncado mesmo sem `"i":` (procurar primeiro `[` após `k`).
  - Anti-loop durável: novo campo `attempt_count` em `document_imports` (migration idempotente) + `next_attempt_at`; recusar novo `finalize/resume` quando `attempt_count >= 3` e `status='failed'`, exigindo botão de "reprocessar" que zera contador.
  - Novo modo `ingest-whatsapp-media`: chamado pelo webhook após download, cria `document_imports` com `source='whatsapp'`, dispara background processing.
  - Emitir eventos de progresso em `document_processing_events` (migration idempotente): `document_received`, `processing_started`, `fragment_completed`, `review_ready`, `processing_completed`, `processing_failed`.
  - Para documentos com origem WhatsApp: enfileirar `outbound_messages` de status (imediato, no início, revisão pronta, conclusão/erro) — reaproveitando dispatcher existente.

**WhatsApp mídia:**
- `supabase/functions/_shared/messaging/wahaMedia.ts` (novo) — descoberta de mídia no payload NOWEB, download autenticado do endpoint WAHA (`/api/{session}/files/…` ou `hasMedia`+`downloadMedia`), SSRF guard reaproveitando `_shared/security/ssrf.ts`, whitelist MIME, cap 20 MB, magic bytes, `sha256Hex` para idempotência.
- `supabase/functions/_shared/messaging/waha.ts` — expor helper `downloadInboundMedia(payloadOrId)` no provider.
- `supabase/functions/whatsapp-webhook/index.ts` — quando `classified.media` presente: baixar, subir ao bucket `documents/{user_id}/{document_id}/{sha}.pdf` via service role, criar `document_imports` (`source='whatsapp'`, `provider_message_id`, `conversation_id`), disparar `assistant-ingest-document` em modo `ingest-whatsapp-media`, enfileirar outbound "Recebi seu documento…", **não** chamar orquestrador de texto quando o corpo estiver vazio e houver mídia (se houver legenda, gravar como `guidance`).

**Painel do assessor:**
- `src/components/assessor/AssessorPanel.tsx` — consumir `document_processing_events` (via query polling incremental) para exibir estágio real; desabilitar `resume` automático quando `attempt_count >= 3`; expor `correlation_id` só em modo debug/admin; parar polling em `completed|failed|needs_review|partial` estáveis.
- `src/components/assessor/AssessorAttachButton.tsx` — apenas ajustes de mensagens do estado.

**Watchdog:**
- Reaproveitar `whatsapp-ack-watchdog` como referência de padrão. Estender `documents-cleanup` para varrer documentos em `processing` com `updated_at < now()-5min` E `attempt_count < 3`: retomar via `assistant-ingest-document`. Se `attempt_count >= 3`, marcar `failed` com `error='terminal:max_attempts'`.

## 4. Migrations necessárias (idempotentes, uma única)

1. `document_imports` — adicionar `attempt_count int not null default 0`, `next_attempt_at timestamptz`, `source text not null default 'app'` (se ainda não existir), `provider_message_id text unique nullable` (índice único parcial para evitar duplicidade WhatsApp).
2. `document_processing_events` — nova tabela append-only: `id`, `document_id`, `user_id`, `event_type text check in (…)`, `stage text`, `progress_current int`, `progress_total int`, `items_found int`, `items_valid int`, `items_rejected int`, `error_code text`, `user_message text`, `metadata jsonb`, `created_at`. Grants + RLS: `authenticated` SELECT WHERE `user_id = auth.uid()`, `service_role ALL`.
3. Índices: `document_imports (status, updated_at)` parcial WHERE `status='processing'`; `document_processing_events (document_id, created_at desc)`.

Sem alterar constraints existentes.

## 5. Arquitetura final

```text
[App upload]                  [WhatsApp inbound com mídia]
     |                                   |
     v                                   v
assistant-ingest-document          whatsapp-webhook
 (create-upload → finalize)         classifyInbound + wahaMedia.download
     |                                   |
     +----> document_imports <-----------+
                  |
                  v
     background processDocument (waitUntil)
        emite document_processing_events
        valida cada row → válidos/rejeitados
        insere extracted_items (valid=needs_review, rejected=rejected)
        heartbeat a cada 20s + attempt_count
                  |
        +---------+---------+
        |                   |
   status=needs_review   status=failed
        |                   |
   outbound WA        outbound WA (erro terminal)
   painel App         painel App (retry manual)

documents-cleanup (cron 1min):
  retoma processing com updated_at<5min E attempt<3
  falha terminal em attempt>=3
```

Fila = coluna de status + `attempt_count` + `next_attempt_at` em `document_imports`. Não introduz uma nova tabela de jobs (evita complexidade).

## 6. Sequência de implementação (lote único)

1. Migration idempotente (attempt_count, next_attempt_at, source, provider_message_id, document_processing_events).
2. `types.ts`: `validateExtractedRow` + whitelist.
3. `assistant-ingest-document`: quarentena, parser tolerante, attempt_count, novo modo `ingest-whatsapp-media`, eventos de progresso, mensagens WA.
4. `_shared/messaging/wahaMedia.ts` novo.
5. `whatsapp-webhook`: caminho de mídia + idempotência via `provider_message_id` em `document_imports`.
6. `documents-cleanup`: watchdog de retomada / falha terminal.
7. `AssessorPanel.tsx`: consumir `document_processing_events`, respeitar attempt_count.
8. Testes (ver §11).
9. Rodar `vitest run` — verde.
10. Deploy: `assistant-ingest-document`, `whatsapp-webhook`, `documents-cleanup`. Sem `whatsapp-send`, sem WAHA.
11. E2E manual: (A) upload no app, (B) PDF pelo WhatsApp.

## 7. Compatibilidade

- Migration com `add column if not exists`.
- `source` default `'app'` preserva registros antigos.
- `extracted_items` com `status='rejected'` já é aceito pela CHECK atual.
- Nenhuma remoção de coluna/tabela.
- Não invalida imports em `needs_review`.
- Prompt do modelo mantém contrato compacto atual; parser tolerante trata legado.

## 8. Rollback

- Todas as migrations idempotentes; rollback = revert do código + `alter table document_imports drop column if exists attempt_count, next_attempt_at`; `drop table if exists document_processing_events`.
- Feature flag simples: se `whatsapp_media_enabled=false` no `platform_public_config`, webhook cai no comportamento antigo (ignora mídia, responde texto).

## 9. Testes automatizados (novos + expansão)

Em `src/test/`:

- `documents-validate-row.test.ts` — number 0, number negativo, NaN, Infinity, string "0", "-5", movement_kind desconhecido, type desconhecido, payment_method desconhecido, data mês 13, ISO válido, BR "1.234,56", subtotal, saldo, pagamento fatura.
- `documents-batch-quarantine.test.ts` — lote com 49 válidos + 1 inválido: 49 inseridos com `needs_review`, 1 com `rejected` e reason coerente.
- `documents-recover-json.test.ts` — JSON truncado sem `"i":`, JSON com objeto misturado com compacto, JSON com trailing garbage.
- `waha-media.test.ts` (novo) — payload NOWEB com PDF (base64 e URL), imagem, MIME não suportado, > 20 MB, magic bytes mismatch, duplicado por `provider_message_id`.
- `whatsapp-webhook-media.test.ts` (novo, mock supabase) — inbound com mídia cria `document_imports` e outbound imediato; inbound duplicado (`message`+`message.any`) não cria segundo import.
- `assistant-ingest-attempts.test.ts` — attempt_count incrementa, terminal em 3, resume rejeita quando terminal.

Manter toda a suite existente verde.

## 10. Deploys

- `assistant-ingest-document`
- `whatsapp-webhook`
- `documents-cleanup`

Sem `whatsapp-send`, sem WAHA, sem publish do frontend nesta rodada. Publish opcional apenas se AssessorPanel mudar de forma visível relevante — decisão após implementação.

## 11. Critérios de aceite (objetivos)

1. Insert com 49 válidos + 1 inválido → 49 gravados (`status='needs_review'`), 1 gravado (`status='rejected'`), documento termina `needs_review`. Query: `select count(*), status from extracted_items where document_id=$X group by status`.
2. Nenhum documento fica `failed` por causa de constraint violation em lote misto.
3. `document 2c72f7f6` (reproduzido) processa até o fim.
4. WhatsApp: envio de PDF gera 1 linha em `inbound_messages`, 1 em `document_imports` com `source='whatsapp'`, ≥1 em `outbound_messages` com mensagem de recebimento, 1 outbound de conclusão/revisão. `message`+`message.any` do mesmo PDF não duplicam.
5. Fechar/reabrir painel não cria novo job (mesmo `document_id`, `attempt_count` inalterado até estado terminal).
6. `attempt_count` chega no máximo a 3 em falhas repetidas; após, painel exibe "reprocessar" manual e `resume` recusa.
7. Nenhum `@lid` grava em `whatsapp_links.phone_e164` (regressão já coberta).
8. Vitest: 100% verde (suite existente + novos).
9. E2E manual cenários A e B do briefing observados e reportados com IDs.

## 12. Riscos

- **Endpoint de download WAHA depende da build/engine** — pode exigir tanto `GET /api/{session}/files/{msgId}` quanto `POST /api/{session}/chats/{jid}/messages/{msgId}/download`. Mitigação: `wahaMedia.ts` tenta ambos, com telemetria em `provider_health_events`.
- **PDF muito grande no WhatsApp** — cap 20 MB, mensagem clara ao usuário se exceder.
- **`extraction:invalid_json` residual** — parser tolerante recupera itens parciais; ainda assim marcamos `partial` no counters. Fragmentação determinística por página fica **fora do escopo desta rodada** (P1).
- **Migration em produção com dados** — `add column if not exists` é seguro; tabela nova ganha grants explícitos.

## 13. Fora de escopo (P1 declarado)

- Fragmentação determinística de PDF por página (texto extraído + páginas renderizadas separadamente). Fica para próxima rodada, com o parser atual + quarentena estabilizando o fluxo.
- Realtime (websocket) — usaremos polling do `document_processing_events` (barato: query por `document_id` com `> last_seen_at`).
- Reconciliação automática de saldos com efeito colateral em conta real — só leitura/exibição.

## 14. Estimativa de impacto em créditos / chamadas de IA

Fluxo atual: para um extrato denso, até `PDF_BATCHES=5` chamadas × PDF inteiro reenviado = ~5× tokens_in de PDF grande + parcelas duplicadas quando invalid_json.

Fluxo proposto (P0):
- Chamadas continuam no máximo 5, mas:
  - JSON tolerante evita retries por parse (elimina ~30% das chamadas hoje perdidas).
  - Quarentena evita re-execução do documento inteiro por 1 linha ruim (elimina 100% dos retries do usuário).
  - Attempt cap 3 impede loops infinitos em documentos ruins (limite duro).

Ganho estimado por documento problemático: **-60% a -80% de tokens** relativamente ao estado atual.

Custo adicional novo: `document_processing_events` (write barato, sem IA); download de mídia WhatsApp (sem IA); mensagens outbound (sem IA, `kind='system'`).

Fragmentação por página (P1) reduzirá tokens_in em ~4× para PDFs grandes, mas não faz parte desta rodada.
