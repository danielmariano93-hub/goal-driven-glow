## Diagnóstico

`uploadToSignedUrl` resolve sem erro no cliente, mas o objeto não aparece em `storage.objects` (evidência: `5bfc3d5b…` com `arquivo_existe=false`). Sintomas típicos: bloqueio por extensão/rede intermediária, Service Worker/proxy interceptando o PUT, ou navegador cancelando o corpo após o response head. Como o cliente reporta sucesso, o `finalize` roda, tenta baixar e falha — hoje sinalizado como `upload_missing`, mas depois do fato consumado. A correção é **verificar do lado do servidor antes de finalizar** e ter um **fallback autenticado** pelo mesmo endpoint.

## Plano (mínimo, execução única)

### 1. Novo modo `verify-upload` em `assistant-ingest-document`
Antes de qualquer chamada a `finalize`, o cliente chama `verify-upload` com `{ document_id }`. O servidor:
- resolve `storage_path` do `document_imports` (dono = `auth.uid()`);
- consulta `storage.objects` (service role) por `bucket_id='documents' AND name=storage_path` e lê `metadata->>'size'`;
- responde `{ exists: boolean, size: number }`.

Sem side effects; puramente diagnóstico.

### 2. Fallback autenticado no cliente (`AssessorAttachButton.ingestDocument`)
Após `uploadToSignedUrl` retornar sem erro:
1. chamar `verify-upload`;
2. se `exists && size>0` → seguir para `finalize` (fluxo atual);
3. se ausente → **uma única** tentativa via `supabase.storage.from('documents').upload(storage_path, blob, { contentType, upsert: true })` (autenticado, respeita RLS por prefixo `user_id/`);
4. chamar `verify-upload` de novo;
5. se ainda ausente → chamar novo modo `mark-upload-missing` (servidor faz `UPDATE document_imports SET status='failed', error='upload_missing', user_message='Não consegui salvar o arquivo. Tente novamente.'`) e lançar erro amigável para o chat. **Não** chamar `finalize`, **não** iniciar IA.

Sem reupload após o passo 3 — no máximo dois PUTs físicos (assinado + autenticado).

### 3. Retomada silenciosa (`AssessorPanel`)
`resumeIngestion` passa a chamar `verify-upload` primeiro. Se o objeto sumiu para um doc `uploaded` antigo (ex.: `5bfc3d5b…`), marca `failed/upload_missing` em vez de tentar `resume` (que hoje só reprocessa). Sem reupload automático — o usuário reenvia manualmente pelo chat.

### 4. Teste (`src/test/assistant-ingest-retry.test.ts`, novo caso)
Cenário adicional:
- `create-upload` OK;
- `uploadToSignedUrl` resolve `{ error: null }`;
- `verify-upload` → `{ exists: false }`;
- fallback `storage.from('documents').upload` → OK;
- `verify-upload` → `{ exists: true, size: >0 }`;
- `finalize` chamado 1x, termina em `needs_review`.

Segundo cenário: fallback também falha → `mark-upload-missing` chamado, `finalize` **nunca** invocado, erro propagado com mensagem amigável.

### 5. Deploy + publicação
- `supabase--deploy_edge_functions(["assistant-ingest-document"])`;
- `preview_ui--publish` do frontend.

### 6. Validação pós-deploy
Consulta em `document_imports` do usuário afetado: novos uploads não podem permanecer em `uploaded` sem objeto correspondente em `storage.objects`; devem ir para `needs_review` (sucesso) ou `failed/upload_missing` (falha real, com mensagem clara no chat).

## Fora de escopo (não tocar)
- Parsing, extração, categorias, cálculos financeiros.
- WhatsApp, WAHA, webhooks.
- Migrations (nenhuma nova).
- Prompt do agente, review sheet, edição de lançamento.
- Outras Edge Functions.

## Arquivos alterados
- `supabase/functions/assistant-ingest-document/index.ts` (dois modos novos: `verify-upload`, `mark-upload-missing`; nenhuma mudança em finalize/resume/status/create-upload).
- `src/components/assessor/AssessorAttachButton.tsx` (verify + fallback + mark-missing entre upload e finalize).
- `src/components/assessor/AssessorPanel.tsx` (retomada usa verify antes de resume).
- `src/test/assistant-ingest-retry.test.ts` (dois cenários novos).
