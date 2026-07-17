## Diagnóstico (confirmado no banco e no código)

Documento real do usuário: `703108bb-...` — PDF 690KB, `status='processing'` há 3+ min, `extraction_ms=180315`, `tokens_out=44188`, 0 linhas em `extracted_items`. O anterior (`0252fd7f-...`) falhou com `timeout:aborted` após 90s. Padrão: extração termina ou fica presa, mas a gravação final não acontece; o painel repõe o job em cima do que ainda está rodando.

Causas raiz (todas verificadas nos arquivos):

1. **Saída do LLM sem teto** (`supabase/functions/assistant-ingest-document/index.ts` L113–158). O prompt não limita quantidade de linhas, extratos grandes produzem 40k+ tokens de saída e a chamada rasga o timeout de 4 min do `EdgeRuntime.waitUntil`. Sem `max_tokens`, sem paginação, sem limite explícito no prompt.
2. **Sem heartbeat durante o processamento** (mesma função, `processDocument`). `updated_at` só muda no `finish` final. O `PROCESSING_STALE_MS=3min` (L21) faz o `acquireProcessingLock` considerar stale qualquer job com mais de 3 min, e dispara **um segundo worker sobre o primeiro** (o painel chama `resumeIngestion` no mount e a cada 5s).
3. **N+1 no enriquecimento** (L219–295 + L168–212). Para cada item extraído são feitas 3 queries sequenciais em `transactions` (`dedupe_fingerprint`, `bank_reference`, `type+amount+occurred_at`). Extrato com 60 linhas ≈ 180 RTTs em série. Depois `enrichItems` volta a fazer `normalizeDescription(...)` para cada linha do histórico dentro de outro loop.
4. **Painel repõe job automaticamente** (`src/components/assessor/AssessorPanel.tsx` L108–128 e L141–153). Ao abrir, dispara `resumeIngestion` em todos os `uploaded/processing`, e depois ainda faz polling `getIngestionStatus` a cada 5s. Combina com o item 2 e vira corrida.
5. **Base64 síncrono em memória** (L429–436). Aceitável, mas em conjunto com o resto amplifica o problema.

## Correção proposta (uma rodada, backend + 1 arquivo de frontend)

### A. Extração enxuta e bounded (`assistant-ingest-document/index.ts`)

- Adicionar no `SYSTEM_PROMPT`: **"máximo 80 lançamentos por documento; se houver mais, devolva os 80 mais recentes e explique em `notes`. Descrições ≤ 80 caracteres."**
- Passar `max_tokens: 8000` na chamada do gateway. 8k é suficiente para 80 itens em JSON compacto.
- Reduzir `EXTRACTION_TIMEOUT_MS` para 90s (era 240s). Se estourar, marca `timeout` — que já é retentável — em vez de deixar o edge runtime matar o processo silenciosamente.

### B. Heartbeat + lock robusto

- Antes de chamar o LLM, no `processDocument`: gravar `updated_at = now()` a cada etapa (download → chamada LLM → enrich → insert).
- Elevar `PROCESSING_STALE_MS` para 5 min e checar heartbeat separado.
- `acquireProcessingLock`: se `status='processing'` e não stale, retornar `{acquired:false}` **sem apagar itens**.

### C. Enriquecimento em lote (mata o N+1)

Substituir o loop de `classifyDuplicates` por três queries agregadas:

```ts
// 1. Todas as fingerprints do lote em uma query
sb.from("transactions").select("id, dedupe_fingerprint")
  .eq("user_id", userId).in("dedupe_fingerprint", allFingerprints)

// 2. Bank refs em uma query
sb.from("transactions").select("id, bank_reference")
  .eq("user_id", userId).in("bank_reference", allBankRefs)

// 3. Candidatos type+date+amount: uma query com OR agrupado por (type, occurred_at) IN (...) + amount IN (...)
```

No `enrichItems`, também: buscar histórico apenas para as `normalized_description` do lote (`.in("description", uniqueDescriptions)`), não os 1000 últimos.

### D. Painel não reprocessa jobs em andamento (`AssessorPanel.tsx`)

- No mount, para docs `processing`/`uploaded`: chamar apenas `getIngestionStatus` (não `resumeIngestion`). Só disparar `resume` se o `updated_at` do doc for > 5 min atrás (documento realmente órfão).
- Manter o polling de 5s como está — ele apenas consulta status, não reprocessa.

### E. Limpeza do documento travado do usuário

Após deploy, marcar `703108bb-...` como `failed` com `error='timeout:aborted|cid=recovery'` para permitir retry limpo. Um único `UPDATE` via migration ou SQL manual — não altera schema.

## Fora do escopo (não mexer)

- WhatsApp webhook, WAHA, sessão.
- Bucket `documents` (já corrigido).
- Schema de `document_imports` / `extracted_items`.
- Prompt do agente conversacional (`agent-chat`).
- Publicação do frontend não é objetivo, mas o arquivo `AssessorPanel.tsx` faz parte do fix.

## Arquivos afetados

- `supabase/functions/assistant-ingest-document/index.ts` (prompt, timeout, heartbeat, lock, enriquecimento em lote)
- `src/components/assessor/AssessorPanel.tsx` (não reprocessar em job vivo)
- Deploy: `assistant-ingest-document`
- SQL pontual: um `UPDATE` no documento travado

## Validação

- `bun test` (deve manter 195/195).
- Reenviar o PDF real; verificar `document_imports` finalizando em < 2 min com `status='needs_review'` e `extracted_items` populado.
- Confirmar que abrir/fechar o painel durante processamento não cria segundo worker (checar `updated_at` monotônico).
