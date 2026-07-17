
# Corrigir upload órfão do assessor (documentos travados em `uploaded`)

## Causa raiz confirmada
- Upload ao Storage funciona (blob existe, linha `document_imports` criada com `status='uploaded'`).
- Nos dois documentos em uploaded, os campos `model`, `tokens_in/out`, `extraction_ms` e `error` estão nulos. Isso comprova que a Edge Function **nunca chegou à linha 250** (`update status='processing'`) — logo, a chamada `invoke("assistant-ingest-document", { mode: "finalize" })` do cliente ou não iniciou, ou foi abortada antes de qualquer efeito colateral.
- Em `AssessorPanel.tsx > ingestDocument`, o fluxo é síncrono e frágil: `create-upload` → `uploadToSignedUrl` → `invoke(finalize)` numa única `Promise`. Extração multimodal + download + I/O pode passar de 30–45s. Se o usuário fecha o painel, troca de rota, perde rede, ou o `fetch` do `invoke` sofre timeout do borda/proxy, o request é abortado no cliente. A Edge Function nunca marca `processing`, o documento fica em `uploaded` para sempre, sem retry, sem retomada.
- Não há mecanismo de resume: o cliente só chama finalize inline; nada rebusca documentos em `uploaded/processing`.
- `finalize` também não é totalmente idempotente para o caso `status='processing'` (uma segunda chamada re-baixa, re-cobra tokens, reinsere itens duplicados).

## Objetivo
Após `uploadToSignedUrl`, o documento nunca fica indefinidamente em `uploaded`. Falhas transitórias se recuperam sozinhas, o usuário vê progresso e mensagens claras, e a revisão continua obrigatória.

## Plano de implementação (uma rodada)

### 1. `supabase/functions/assistant-ingest-document/index.ts`
- **Finalize assíncrono**: quando `mode=finalize` recebe um doc em `status='uploaded'`, transiciona atomicamente para `processing` (UPDATE ... WHERE status='uploaded' RETURNING; se afetou 0 linhas, tratar como já em andamento) e dispara o trabalho pesado via `EdgeRuntime.waitUntil(processDocument(doc))`. Retorna imediatamente `202 { status: 'processing', document_id }`.
- **Idempotência**:
  - `status IN ('confirmed','partially_confirmed','canceled','needs_review')` → retorna estado atual, sem reprocessar.
  - `status='processing'` com `updated_at` < 3 min → retorna `processing`, sem duplicar trabalho.
  - `status='processing'` com `updated_at` ≥ 3 min (stale) OU `status='failed'` com `error` transitório (`gateway:`, `fetch_error`, `download:`) → permite retomada: apaga `extracted_items` órfãos deste `document_id`, volta a `processing`, reprocessa.
- **Classificação de erro** persistida em `document_imports.error` com prefixo padronizado, guardado junto com `correlation_id` (novo UUID por tentativa, retornado no JSON):
  - `upload_missing:` (blob não achado no Storage), `mime_mismatch:`, `size_exceeds:`, `pdf_encrypted:` (detectar `/Encrypt` no PDF), `auth:`, `timeout:` (AbortError), `gateway:<status>`, `extraction:` (JSON inválido), `items_insert:`.
  - O log inclui `correlation_id`; a resposta ao cliente inclui `correlation_id` e uma `user_message` amigável mapeada do prefixo.
- **Novo modo `resume`**: `POST { mode: 'resume', document_id }` — reexecuta finalize seguindo as mesmas regras acima. Serve para retomada manual ou automática.
- **Modo `status` existente**: manter, mas incluir `correlation_id` e `user_message` no retorno.

### 2. `src/components/assessor/AssessorAttachButton.tsx` (`ingestDocument`)
- Após `uploadToSignedUrl` bem-sucedido, chamar `invoke(finalize)` com timeout curto do lado do cliente (via `AbortController` de ~15s apenas para o *disparo*, já que o servidor devolve 202 imediatamente).
- Se a resposta for `status='needs_review'` ou terminal → retornar como hoje.
- Se `status='processing'` (ou timeout/erro transitório no invoke) → iniciar **polling** com backoff exponencial limitado: 2s, 4s, 8s, 15s, 30s (máx ~1 min total), chamando `mode='status'`. Parar em qualquer estado terminal.
- Se ainda `uploaded` ou `processing` após backoff → chamar `mode='resume'` uma única vez, reiniciar polling curto. Se ainda não resolver, devolver erro classificado ao chamador com `correlation_id` para mensagem amigável.
- Distinguir e propagar: `upload` (falha no `uploadToSignedUrl`), `auth` (401), `timeout`, `pdf_encrypted`, `gateway`, `extraction`. `AssessorPanel.onExtracted` já cobre a maioria; adicionar branch para `pdf_encrypted` ("Esse PDF está protegido por senha. Remova a senha e envie de novo.") e `timeout` ("Demorou mais que o esperado. Vou continuar processando; toque em Reenviar se não aparecer em 1 min.").
- **Nunca** re-upar o PDF se `document_id` já existe em `uploaded`/`processing`: expor um caminho de retomada (chamada direta a `resume` reutilizando o mesmo `document_id`) — reaproveitado tanto pelo fluxo inline quanto pelo passo (3).

### 3. Retomada de documentos órfãos ao abrir o painel
- Em `AssessorPanel` (montagem), consultar `document_imports` do usuário atual em `status IN ('uploaded','processing')` criados nas últimas 24h. Para cada um, chamar `mode='resume'` em background (fire-and-forget com polling leve). Não bloquear a UI, apenas atualizar as mensagens correspondentes (se existirem) ou silenciosamente. Nada é gravado em `transactions` sem revisão explícita.

### 4. Teste automatizado (Deno + fetch mock)
- `supabase/functions/assistant-ingest-document/test.ts` (ou vitest com mock do handler) cobrindo o cenário-âncora:
  1. `create-upload` cria linha `uploaded`.
  2. Primeiro `finalize`: mockar `callMultimodal` para lançar `AbortError` → doc termina em `failed` com `error='timeout:...'` e `correlation_id` gravado.
  3. Segundo `finalize` (retomada): mock retorna JSON válido → doc vira `needs_review`, `extracted_items` inseridos exatamente uma vez, sem duplicatas do item da primeira tentativa.
- Asserção final: `SELECT status FROM document_imports WHERE id=$1` retorna `needs_review`, `COUNT(extracted_items)` bate com o mock.

### 5. Deploy & publicação
- `supabase--deploy_edge_functions(["assistant-ingest-document"])`.
- `preview_ui--publish` (sem alterar slug/metadados).
- Não tocar em `whatsapp-*`, `agent-chat` nem qualquer outra função.

### 6. Validação pós-deploy (manual, no banco)
- Repetir upload do PDF de referência com `danielmariano93@gmail.com`.
- Consultar `document_imports` recentes: nenhum registro do teste deve permanecer em `uploaded` por mais de ~90s. Estado terminal esperado: `needs_review` (ou `failed` com `error` e `correlation_id` visíveis).
- Se houver algum documento antigo ainda em `uploaded` do usuário, um `mode='resume'` disparado pelo passo (3) deve destravá-lo.

## Fora do escopo
- Nada de mudanças em cálculo financeiro, prompt do agente, WhatsApp, esquema de `transactions`, ou reescrita de `AssessorPanel`/`ReviewSheet`.
- Sem migrations novas: `document_imports.error` já é texto livre; `correlation_id` fica armazenado inline no prefixo do `error` (ex.: `timeout:cid=…`) para evitar migration. Se depois quisermos coluna dedicada, avaliamos separadamente.

## Detalhes técnicos-chave
- `EdgeRuntime.waitUntil` é a primitiva Deno Deploy para tarefa pós-resposta; mantém a função viva até ~150s após o 202.
- Detecção de PDF com senha: se `bytes` contém `/Encrypt` dentro dos primeiros 4KB do PDF, marcar `failed` com `error='pdf_encrypted:'` antes de chamar o LLM (economiza tokens e devolve mensagem correta).
- Anti-reprocessar itens: antes de reinserir em `extracted_items` na retomada, `DELETE ... WHERE document_id=$1 AND status IN ('needs_review','duplicate_suspect')`. Itens já confirmados/canceled não são apagados (mas nesse caso o doc não seria reprocessado).
- Todas as respostas continuam com `corsHeaders`. `user_message` sempre em pt-BR.
