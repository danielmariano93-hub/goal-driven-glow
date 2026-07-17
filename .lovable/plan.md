## Diagnóstico consolidado

Evidência confirmada: docs `0a3f1ffb…` e `784ef337…` do usuário `danielmariano93@gmail.com` ficaram em `status='uploaded'` com `error IS NULL`, `model/tokens/extraction_ms` nulos. Isso prova que o handler `finalize` **nunca chegou a executar** para esses IDs — o upload para Storage completou, mas a chamada `supabase.functions.invoke("assistant-ingest-document", { mode: "finalize" })` foi abortada (fetch cancelado por fechamento do painel, timeout de rede/proxy, ou perda de foco em mobile). Como a Edge Function era síncrona (fazia OCR/LLM inline em até dezenas de segundos), a janela de aborto era enorme. Não havia idempotência, retomada, nem polling — logo, sem código para tirar o documento de `uploaded`.

Causas raiz:
1. `finalize` síncrono e longo → alta probabilidade de aborto pelo cliente.
2. Sem transição atômica `uploaded → processing` no início do handler.
3. Sem endpoint de retomada; cliente só sabia reenviar o PDF.
4. Sem polling nem backoff no cliente.
5. Erros não classificados (senha/timeout/gateway/extração) e sem `correlation_id`.

## Plano (implementação única)

### 1. Edge Function `assistant-ingest-document`
- Novo modo `finalize`: aquisição atômica de lock via `UPDATE document_imports SET status='processing', updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('uploaded','failed') AND (status<>'processing' OR updated_at < now()-'3 min'::interval)`. Se `rowCount=0`, retorna estado atual (idempotente). Se adquiriu, dispara trabalho em `EdgeRuntime.waitUntil` e responde **202 em ms** com `{status:'processing', correlation_id, user_message}`.
- Novo modo `status`: leitura enriquecida (`status, items_count, document_kind, error, user_message`).
- Novo modo `resume`: mesma lógica de `finalize` para retomar docs pendentes sem reupload; limpa `extracted_items` órfãos antes de reprocessar.
- Detecção de PDF cifrado (`/Encrypt` no header) antes de gastar tokens → `error='pdf_encrypted'`.
- Erros classificados e persistidos em `error` com `correlation_id`: `upload_missing`, `mime_mismatch`, `size_exceeds`, `pdf_encrypted`, `timeout`, `gateway:<code>`, `fetch_error`, `extraction`, `items_insert`. `user_message` sempre amigável.
- Rascunhos permanecem em `needs_review` — nenhum lançamento é criado sem confirmação do usuário.

### 2. Cliente `AssessorAttachButton.ingestDocument`
- Fluxo: `create-upload` → `uploadToSignedUrl` → `finalize`.
- Se resposta de finalize for `processing` ou fetch abortar: polling `status` com backoff `[2, 3, 5, 8, 12, 20]` s. Se ao final ainda estiver `processing/uploaded`, uma tentativa de `resume` seguida de nova rodada curta de polling.
- **O PDF nunca é reenviado.** Retry só troca chamadas leves.
- Nova função exportada `resumeIngestion(documentId)` para uso do painel.

### 3. `AssessorPanel` — retomada silenciosa
- No mount, `select id from document_imports where status in ('uploaded','processing') and created_at > now()-24h` (limite 5). Para cada, chama `resumeIngestion` em background; ao virar `needs_review`, adiciona card "Revisar N lançamento(s)" no chat. Cobre os dois docs órfãos existentes.

### 4. Mensagens no chat
- `processing/uploaded` → "Ainda estou processando esse documento. Assim que terminar, aviso aqui."
- `failed` → `user_message` retornado pelo servidor (fallback genérico).
- `needs_review` → CTA de revisão (comportamento atual preservado).

### 5. Teste automatizado (`src/test/assistant-ingest-retry.test.ts`, vitest)
- Cenário 1: `create-upload` OK → `uploadToSignedUrl` OK → `finalize` devolve `processing` → dois `status` `processing` → `status` final `needs_review`. Assert: `uploadToSignedUrl` chamado **exatamente 1x**, `create-upload` 1x, `finalize` 1x, `status` ≥ 2x, resultado `needs_review` com `items_count`.
- Cenário 2: falha de upload propaga erro amigável e **não** chama `finalize`.

### 6. Deploy e publicação
- `supabase--deploy_edge_functions(["assistant-ingest-document"])`.
- `preview_ui--publish` do frontend.

### 7. Validação pós-deploy no banco
- Após publicação, reabrir o painel do usuário afetado dispara `resumeIngestion` para `0a3f1ffb…` e `784ef337…`; ambos devem sair de `uploaded`.
- Consulta de verificação: `select id,status,error,items_count from document_imports where user_id=<...> and created_at > now()-2d order by created_at desc`. Nenhum novo doc pode permanecer em `uploaded` > ~90 s.

## Fora de escopo (não tocar)
- Funções `whatsapp-*`, WAHA, sessão, webhook.
- Migrations novas (a tabela `document_imports` e seu trigger `updated_at` já existem).
- Lógica financeira fora do fluxo de ingestão; nenhum lançamento criado sem revisão.
- Reescrita do assessor ou do `ReviewSheet`.

## Arquivos alterados
- `supabase/functions/assistant-ingest-document/index.ts`
- `src/components/assessor/AssessorAttachButton.tsx`
- `src/components/assessor/AssessorPanel.tsx`
- `src/test/assistant-ingest-retry.test.ts` (novo)
