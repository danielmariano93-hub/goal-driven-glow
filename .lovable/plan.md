
# Plano — Correção definitiva: WhatsApp texto + Assessor de documentos

## 1. Evidências reais do banco (não hipóteses)

### 1a. WhatsApp: silêncio total pós-vinculação
Após a última vinculação bem-sucedida em `2026-07-17 22:43` (Daniel, `+5511977992569`, link `234901cf` ativo), **nenhuma** mensagem de texto do usuário produziu resposta:

| inbound_id | corpo | received_at | processed_at | outbound? | agent_run? | drop? |
|---|---|---|---|---|---|---|
| `32a101f5` | "Analise os gastos do meu extrato…" | 22:11 | **NULL** | não | não | não |
| `71b12893` | "Você está analisando?" | 22:12 | NULL | não | não | não |
| `38b77ce6` | "Olá, ainda está aí?" | 22:40 | NULL | não | não | não |
| `9ea7147f` | "Acabei de gastar 21,90 no Mc Donalds" | 23:39 | NULL | não | não | não |
| `d8a2f6e9` | "Oi" | 23:45 | NULL | não | não | não |
| `c8696f78` | "Acabei de gastar 21,90…" | 07-18 20:31 | NULL | não | não | não |
| `45502f2e` | "Acabei de gastar 21,90…" | 07-18 20:32 | NULL | não | não | não |

`agent_runs` mais recente é `8dd5ccee` de `2026-07-17 17:23` (antes de tudo isso). Existem 2 runs órfãos com `status='running'` desde 07-16.
`outbound_messages` mais recente é `2bc7b208` de `2026-07-17 22:43` (a saudação da vinculação). Zero outbounds após.
`provider_inbound_drops` só registra `session.status` e `message.ack` — nenhum drop para essas inbounds.
`provider_message_id` das falhas: `false_11746853019855@lid_...` — engine NOWEB com `@lid`.

**Conclusão factual:** o webhook está inserindo o `inbound_messages`, mas nunca chega a chamar `runOrchestrator` (ou o isolate morre antes do try/catch executar o fallback). Nenhum `agent_run` é criado, nenhum outbound (nem o "orch-err") é enfileirado, `processed_at` fica NULL. Isso é diferente do que o patch anterior desta thread afirmou ter resolvido.

**Causa raiz mais provável (a validar no fix, não afirmar como certeza):** o path chegou até `runOrchestrator` mas o isolate foi encerrado por timeout de LLM/edge antes do `catch`. Como `enqueueReply` só é chamado no final do orchestrator, um travamento em `runAgentTurn` (25 s de timeout interno + rede + retries) somado ao restante ultrapassa o wall-clock do isolate, e a fila não recebe nada. O `waitUntil` não é usado aqui, então quando o cliente HTTP cai, o trabalho pendente é abortado.

### 1b. Assessor de documentos: falhas em cadeia
Últimos `document_imports` (excluindo o único `confirmed` em 07-16 22:22):

- `2c72f7f6` (07-17 21:51) — `failed` — `items_insert: extracted_items_amount_check`. Zero linhas em `extracted_items` para esse `document_id` (batch inteiro perdido).
- `910e5d1a`, `f36e4728`, `31e950a0` (07-17 20:56–21:22) — `failed` — `extraction:invalid_json`.
- `703108bb` (07-17 20:34) — `canceled` com 235 itens (usuário desistiu; sinal de UX ruim).
- `0252fd7f` (07-17 17:20) — `failed` — `timeout:aborted`.
- 6 imports (07-17 14:42–16:30) — `failed` — `upload_missing`.

`document_processing_events`, `document_item_rejections` e `provider_inbound_drops` já existem no schema. Colunas `attempt_count`, `next_attempt_at`, `provider_message_id` já existem em `document_imports`. Ou seja, a fundação da rodada anterior está no banco, mas o código que a usa **não** está fechando os buracos.

### 1c. Mídia do WhatsApp
`whatsapp-webhook/index.ts` já tem branch para `evt.media` que cria `document_imports` com `source='whatsapp'` e chama `assistant-ingest-document` em modo `process-inbound-media`. Nenhum `document_imports` com `source='whatsapp'` existe ainda — não há evidência de que o usuário tenha enviado PDF pelo WA nessa janela, então a rota é **não validada em produção**. Vai ficar como validação manual pós-fix.

## 2. Objetivos desta rodada

1. Garantir que **toda** mensagem de texto do WhatsApp de usuário vinculado produza uma resposta — mesmo em falha de LLM, timeout ou crash — e que `processed_at`/`agent_runs`/`outbound_messages` reflitam o resultado.
2. Impedir que uma única linha inválida em `extracted_items` derrube o import inteiro (quarentena real).
3. Endurecer o parser de JSON do Gemini para recuperar itens parciais mesmo em truncamento sem `"i":`.
4. Instituir cap real de tentativas (`attempt_count`) e watchdog de retomada para documentos.
5. Diagnóstico persistido: gravar em `document_processing_events` cada transição para poder auditar sem depender de logs voláteis.
6. Não tocar em WAHA/sessão/QR, nem em migração de banco desnecessária (colunas e tabelas já existem).

## 3. Mudanças de código

### 3a. `supabase/functions/whatsapp-webhook/index.ts`
- Envelopar todo o corpo pós-classificação em try/catch externo. Qualquer erro → `outbound_messages` `kind='agent'`, `idempotency_key='webhook-err:${inbound_message_id}'`, corpo `FRIENDLY_ORCHESTRATOR_ERROR`, `processed_at` marcado com `ignored_reason='webhook_error'`.
- Encaminhar o trabalho pesado (orchestrator) via `EdgeRuntime.waitUntil` **quando não houver mídia** e responder 202 imediatamente, para que o timeout do cliente HTTP nunca aborte o isolate no meio do turno do LLM.
- No mesmo `waitUntil`, gravar checkpoint em `agent_runs` já com `status='running'` **antes** de chamar o LLM (assim mesmo se o isolate morrer, há rastro).
- Se `evt.media` presente e download falhar por `unsafe_url|mime_not_allowed|size_exceeds`, mensagem já é boa; adicionar telemetria `document_processing_events` (`processing_failed`, `error_code=download_failed`).

### 3b. `supabase/functions/_shared/agent/orchestrator.ts`
- `runAgentTurn` timeout: reduzir de 25 s para 15 s + `maxSteps` respeitado.
- Envolver a chamada do LLM em `Promise.race` com timeout interno curto que já dispara o fallback determinístico, evitando que o webhook precise esperar 25 s + rede.
- Anti-loop: contador `steps` em memória e assertiva de que a mesma tool com os mesmos `args_hash` não pode ser chamada 2x sequenciais (aborta com `looped_tool_call`, fallback assume).
- No fim, sempre chamar `enqueueReply`; se `enqueueReply` lançar, capturar e persistir `agent_runs.status='error'` com o motivo — nunca deixar a função sair sem outbound.

### 3c. `supabase/functions/assistant-ingest-document/index.ts`
- Antes de `sb.from("extracted_items").insert(rows)`, iterar `validateExtractedRow(row)` (helper existente em `_shared/documents/types.ts`; se ausente, criar). Separar em `valid_rows` e `rejected_rows`.
- Insert dos válidos com `status='needs_review'`; dos rejeitados com `status='rejected'` e registro em `document_item_rejections` (tabela já existe).
- Se um insert em lote válido ainda assim falhar por constraint (defesa em profundidade), degradar para inserts linha-a-linha; qualquer linha que quebre vai para `rejected` com `reason_code='constraint_violation'`.
- Parser `recoverCompactJson`: procurar o primeiro `[` após o campo `k` (chaves), não exigir `"i":`. Suportar arrays de arrays truncados no meio. Testes cobrem os 3 casos já observados em produção.
- Anti-loop de reprocessamento: incrementar `attempt_count` a cada `finalize/resume`; se `attempt_count >= 3` e `status='failed'`, retornar `terminal:max_attempts` sem chamar o LLM. Endpoint dedicado `reset-attempts` (admin/dono) zera para permitir retry manual.
- Emitir eventos em `document_processing_events` nos pontos: `processing_started`, `fragment_completed`, `items_persisted`, `review_ready`, `processing_failed`, `processing_completed`.

### 3d. `supabase/functions/documents-cleanup/index.ts`
- Varrer `document_imports` com `status='processing'` e `updated_at < now() - interval '5 minutes'`:
  - Se `attempt_count < 3`: disparar `assistant-ingest-document` em modo `resume`.
  - Se `attempt_count >= 3`: marcar `status='failed'`, `error='terminal:max_attempts'`, gravar `document_processing_events.processing_failed`, e se `source='whatsapp'` enfileirar outbound explicando falha.

### 3e. `src/components/assessor/AssessorPanel.tsx`
- Consumir `document_processing_events` (query polling por `document_id, created_at > last_seen`) para exibir estágio real.
- Botão "Reprocessar" só habilitado quando `attempt_count >= 3` e `status='failed'`; chama `reset-attempts` + `finalize`.
- Parar polling em estados terminais estáveis (`completed`, `failed`, `needs_review`, `partial`).

## 4. Sem migração nova
Todas as colunas/tabelas necessárias já existem (`attempt_count`, `next_attempt_at`, `document_processing_events`, `document_item_rejections`, `provider_inbound_drops`). Não há migração nesta rodada.

## 5. Testes (novos + expansão)
Em `src/test/`:

- `webhook-text-resilience.test.ts` — mock supabase-js; inbound de texto de usuário vinculado com `runOrchestrator` mockado para (a) sucesso, (b) throw, (c) timeout de 30 s: em todos os casos, `outbound_messages` recebe uma linha e `inbound_messages.processed_at` é atualizado.
- `orchestrator-timeout-fallback.test.ts` — LLM demora > 15 s → fallback determinístico produz reply e `agent_runs.status='error'` com `error_sanitized='timeout'`.
- `orchestrator-antiloop.test.ts` — mesma tool com mesmos args 2x → `looped_tool_call`, fallback assume.
- `documents-quarantine-integration.test.ts` — lote 49 válidos + 1 inválido → 49 gravados como `needs_review`, 1 como `rejected` em `document_item_rejections`, import termina `needs_review`.
- `documents-recover-json-truncated.test.ts` — JSON truncado sem `"i":`, com objeto misturado, com garbage inicial.
- `documents-attempt-cap.test.ts` — 3ª tentativa falha → `status='failed'`, `error='terminal:max_attempts'`; `resume` recusa.

Toda a suite existente deve seguir verde (238/238 atualmente).

## 6. Deploys
`whatsapp-webhook`, `agent-chat` (compartilha `_shared/agent`), `assistant-ingest-document`, `documents-cleanup`.
Não deployar `whatsapp-send`, WAHA, sessão ou frontend nesta rodada.
Publish do frontend só depois da validação E2E manual dos dois fluxos.

## 7. Validação E2E manual pós-deploy
Cenário A — texto WhatsApp:
1. Enviar "gastei 21,90 no bar hoje no Nubank" pelo número real.
2. Esperar resposta em ≤ 30 s.
3. Query esperada:
```text
inbound_messages.processed_at NOT NULL
agent_runs: 1 linha nova com status='done' e steps>=1 (ou 'error' + fallback com outbound)
outbound_messages: 1 linha nova com kind='agent', channel='whatsapp'
```

Cenário B — PDF WhatsApp (não validado hoje):
1. Enviar PDF pequeno legível.
2. Query esperada:
```text
document_imports source='whatsapp', status termina em 'needs_review' ou 'partial'
document_processing_events com processing_started + review_ready
outbound_messages: "Recebi seu documento…" e outra ao concluir
```

Cenário C — quarentena:
Reproduzir o import `2c72f7f6` (mesmo storage_path) → agora termina `needs_review` com ao menos 1 linha `rejected`.

## 8. Critérios de aceite
1. Nenhuma inbound de texto de usuário vinculado fica com `processed_at=NULL` por mais de 60 s.
2. `outbound_messages` sempre recebe ≥1 linha por inbound (sucesso, fallback determinístico, ou erro amigável).
3. Nenhum documento `failed` por `items_insert:extracted_items_amount_check` — quarentena impede.
4. Documentos com JSON truncado agora entram em `partial` com pelo menos os itens recuperados, não `failed`.
5. `attempt_count` nunca ultrapassa 3.
6. Vitest 100% verde.

## 9. Fora de escopo (P1 declarado)
- Fragmentação determinística por página do PDF.
- Realtime (websocket).
- Reconciliação automática de saldos com contas reais.
- Mudanças em WAHA/sessão/QR.

## 10. Riscos
- **`EdgeRuntime.waitUntil` em webhook público:** garantir que o retorno 202 não conflita com expectativa do WAHA (que só verifica 2xx). Compatível.
- **Timeout do LLM curto (15 s):** pode aumentar taxa de fallback determinístico em turnos complexos; mitigado pelo fato de que hoje o fallback é o único que responde de fato.
- **Reprocessamento de doc antigo:** documentos com `attempt_count=0` e `status='failed'` continuam clicáveis pelo usuário; após o fix, virarão `needs_review/partial` no próximo `resume`.
