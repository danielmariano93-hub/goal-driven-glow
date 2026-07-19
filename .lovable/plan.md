
# Plano definitivo — Pipeline Documental (Assessor) e Ingestão WhatsApp

Objetivo: fechar simultaneamente todas as lacunas remanescentes de ingestão, extração, revisão, conciliação, WhatsApp e segurança. Nada será deixado como backlog aberto.

## 0. Estado real hoje (verificado nesta investigação)

- `document_imports`, `extracted_items`, `document_item_rejections`, `document_processing_events`, `account_balance_snapshots`, `document_import_audit` **existem**. Colunas úteis já presentes: `attempt_count`, `counters` (jsonb), `statement_bank`, `statement_opening_balance`, `statement_closing_balance`, `statement_balance_date`, `expires_at`, `raw_text`, `conversation_id`, `source`, `user_instructions`, `sha256`.
- `extracted_items.movement_kind` com CHECK que **não inclui `informational`**. Regressão real: `sanitize()` em `_shared/documents/types.ts` chama `normalizeMovementKind` que colapsa qualquer valor desconhecido em `"transaction"` — linhas "informational" viram transações se escaparem do filtro por palavra-chave. O contrato não preserva `informational` até o filtro determinístico.
- `pdfFragments.ts` divide o PDF em memória, mas **nenhuma tabela persiste fragmentos**. Se o worker cai no meio, o próximo `resume` reexecuta o LLM em tudo, contando apenas com `extracted_items` já salvos como âncora de dedupe.
- `document_imports` não tem `source_account_id`, `source_credit_card_id`, `source_context_method`, `source_context_confidence`. Contexto é reinferido item a item por matching de string em `enrichItems`.
- `extracted_items` guarda `raw_description` e `normalized_description`, mas não `bank_description` (linha bruta reformatada pelo banco) nem `friendly_description` como campo próprio; o "friendly" fica em `description`. Não há tabela de aliases aprendidos.
- `AssessorPanel` mostra contagem simples. Não expõe fragmentos (não existem), motivos de rejeição, total por status, conta de origem nem soma reconciliada.
- Bucket `documents` no arquivo `20260716220000_document_import_hardening.sql` está restrito a imagens/10MB. A liberação de PDF/20MB citada em histórico foi feita fora do repositório e precisa ser reafirmada por migration versionada.
- `wahaMedia.ts` tenta 3 endpoints × 3 esquemas de auth cegamente. Não usa metadados reais do payload (`mediaKey`, `mediaUrl`, `directPath`, `messageTimestamp`), não distingue `chatId`/`id.serialized`, não expõe `correlation_id`.
- `documents-cleanup` só disparava `assistant-ingest-document` com `mode: "process-inbound-media"` para stale — modo errado para docs criados pelo app (esses vêm de `finalize`). Bug de retomada silenciosa: docs do app nunca eram reprocessados corretamente pelo watchdog.
- `whatsapp-webhook` chama `assistant-ingest-document` diretamente com mode `process-inbound-media`, criando `document_imports.source='whatsapp'`, mas o corpo do pipeline usado é o mesmo — a paridade existe conceitualmente mas o `process-inbound-media` **não** entra no lock/retomada do finalize (branch separado).
- Limite `MAX_ITEMS_PER_DOCUMENT=240` é constante fixa. Não configurável, não sobre-escrito por preferência do usuário nem por tamanho do documento.

## 1. Persistência durável de fragmentos

Nova tabela `public.document_fragments`:

- Colunas: `id uuid pk`, `document_id uuid fk`, `user_id uuid`, `fragment_index int`, `total_fragments int`, `page_start int`, `page_end int`, `status text check in ('pending','processing','completed','failed','skipped')`, `attempts int default 0`, `heartbeat_at timestamptz`, `items_found int default 0`, `duplicates_found int default 0`, `error text`, `error_code text`, `tokens_in int`, `tokens_out int`, `extraction_ms int`, `partial bool default false`, `created_at`, `updated_at`.
- Índice único `(document_id, fragment_index)` para idempotência.
- RLS: `authenticated` lê próprios (`document_id` do próprio user); apenas `service_role` escreve.
- Trigger `updated_at`.

Fluxo:

- No `processDocument`, gerar/atualizar linhas de fragmento **antes** de chamar o LLM (idempotente via `ON CONFLICT DO NOTHING`).
- Marcar `processing` + `heartbeat_at=now()` ao começar cada fragmento; `completed` com métricas ao terminar; `failed` (com `error_code` estável) se o batch quebrar.
- `resume` só processa fragmentos com status `pending|failed(attempts<3)|processing(heartbeat>5min)`. Fragmentos `completed` nunca são reprocessados — o loop os pula.
- `MAX_ITEMS_PER_DOCUMENT` continua funcionando: se o limite for atingido, fragmentos restantes ficam `skipped` com motivo `max_items_reached`.
- Watchdog em `documents-cleanup` também respeita fragmentos: só reenfileira o documento se algum fragmento estiver reprocessável.

## 2. Contexto de origem no nível do documento

Adicionar em `document_imports`:

- `source_account_id uuid null references public.accounts(id) on delete set null`
- `source_credit_card_id uuid null references public.credit_cards(id) on delete set null`
- `source_context_method text check in ('user_selected','statement_bank','guidance','single_account','none')`
- `source_context_confidence numeric(3,2)`
- `source_context_reason text` (livre, para UI)
- Regra: apenas UM entre `source_account_id`/`source_credit_card_id`.

Resolução server-side no início de `processDocument`, na ordem:

1. Valor já preenchido pelo cliente/WhatsApp (user_selected, confidence 1.0).
2. `statement_bank` do metadata + match único em `accounts.institution`/`name` (confidence 0.9).
3. `guidance` textual com nome inequívoco de conta/cartão (confidence 0.7).
4. Usuário tem exatamente uma conta ativa E o documento parece extrato de conta (confidence 0.6).
5. Caso contrário `none`, `source_context_confidence=0`.

Propagação:

- `enrichItems` passa a preferir o contexto do documento sobre matching por item, mas ainda permite override quando um item tem `card_hint` explícito e claro (cartão diferente aparecendo dentro da fatura).
- Itens sem contexto herdado ficam com `account_id`/`credit_card_id` `null` e são exibidos com badge "conta a definir" na revisão. O usuário pode atribuir a todos de uma vez.

Frontend `AssessorAttachButton`: novo passo opcional "Qual conta ou cartão?" (dropdown das contas ativas + cartões) antes do upload; se selecionado, cria o `document_imports` já com `source_account_id`/`source_credit_card_id` e `source_context_method='user_selected'`.

## 3. Descrição em camadas

Em `extracted_items` e `transactions`:

- `raw_description` (já existe): texto literal capturado, nunca alterado.
- Renomear conceitualmente: reutilizar `raw_description` como o único armazenamento do texto literal.
- Nova coluna `bank_description text null` em ambas: linha bruta pós-limpeza mínima do banco (sem prefixos ruidosos como "COMPRA APROV"), preservando conteúdo semântico.
- `normalized_description` (já existe): chave estável para categoria e dedupe.
- Nova coluna `friendly_description text null`: rótulo curto exibido; se null, cai para `normalized_description`, depois `raw_description`.
- Migration preenche `bank_description=raw_description` e `friendly_description=description` para linhas existentes.

Nova tabela `public.merchant_aliases`:

- `id`, `user_id`, `alias_key text` (normalizado), `friendly_name text`, `category_id uuid null`, `learned_from text check in ('manual','confirmation')`, `hits int default 1`, `last_used_at`, `created_at`, `updated_at`.
- Unique `(user_id, alias_key)`.
- RLS: usuário gerencia próprios.
- Ao usuário editar `friendly_description` ou `category_id` de um item na revisão e confirmar, gravar/atualizar alias.
- `enrichItems` consulta `merchant_aliases` antes de `MERCHANT_DICT` interno; após dicionário, ainda usa histórico.

## 4. Tela de revisão reconciliada (mobile-first)

Refatorar `ReviewSheet`:

- Cabeçalho com: `document_kind` humanizado, banco detectado, período, conta/cartão de origem (editável), botão de conciliação.
- Barra de métricas: encontrados / válidos / duplicados / corrigíveis / rejeitados / ignorados. Chips clicáveis filtram a lista.
- Bloco "Extração": fragmentos concluídos/pendentes/falhos com barra de progresso; motivos de fragmentos falhos com botão "reprocessar fragmento" (chama `assistant-ingest-document` mode `resume-fragment`).
- Bloco "Reconciliação": saldo do banco vs. calculado (soma dos itens ativos + saldo inicial), diferença destacada em cor. Botão "conciliar" chama RPC existente `reconcile_document_balance`.
- Lista de itens agrupada por dia (data), cada item com: friendly editável inline, valor, categoria, conta/cartão herdada com badge de origem ("do documento", "definido por você", "aprendido"), motivo (para rejeitados/duplicados).
- Aba "Rejeitados" mostra linhas de `document_item_rejections` com `reason_code`, permite "recuperar" (converte rejeição em item `needs_review` se o motivo for reciclável).
- Rodapé sticky: "Salvar N lançamentos" (só ativos e revisados), "Cancelar tudo", "Reverter importação" (se já confirmada).

Mobile-first: `ReviewSheet` já é sheet full-screen no mobile — reforçar padding seguro, evitar tabelas horizontais, chips com scroll horizontal.

## 5. Reprocessamento seguro de rejeições antigas

- Nova RPC `reprocess_rejected_items(p_document_id uuid, p_reason_codes text[])`:
  - Busca `document_item_rejections` do doc com códigos alvo (`invalid_movement_kind`, `invalid_payment_method`, `empty_description`, `invalid_date`).
  - Para cada uma, tenta normalização determinística (movement_kind → `transaction`; payment_method → null; date inválida → data do extrato). Se conseguir, cria `extracted_items` `needs_review` com o mesmo `source_span` e apaga a rejeição correspondente.
  - Skip se já existe `extracted_items` com mesma `fingerprint` naquele documento.
- Botão "recuperar" na aba Rejeitados chama a RPC.
- Nenhuma transação existente é tocada — só rejeições viram itens para revisão.

## 6. Preservar `informational` até o filtro determinístico

- Ampliar `MovementKind` no contrato em `_shared/documents/types.ts` para incluir `"informational"` **apenas no tipo TS**, sem alterar CHECK do banco.
- `normalizeMovementKind`: adicionar aliases `saldo|balance|limit|limite|subtotal|total|header|periodo|resumo → 'informational'`.
- `sanitize`: se `movement_kind === 'informational'` OU `isNonTransactionLine(description)` OU descrição casa com regex de saldo/limite/total, o item é excluído e contabilizado em `counters.informational_dropped`.
- Nenhuma linha `informational` chega a `enrichItems`/`validateExtractedRow` — portanto nunca vira `extracted_items` (CHECK do banco continua rejeitando, mas nunca é acionado).
- Reforçar `SYSTEM_PROMPT` para permitir e recomendar `"informational"` no campo movimento; deixa de depender apenas do filtro por palavra-chave.

## 7. Datas documentais robustas

Utilitário compartilhado `_shared/documents/dates.ts` (novo):

- `resolveDocumentDates({ text, statement_period_start, statement_period_end, today })` retorna `{ occurred_at, confidence, reason }` para cada linha.
- Regras:
  - Se linha tem data completa `dd/mm/aaaa` válida no calendário → aceita quando cai dentro de `[period_start - 7d, period_end + 7d]`.
  - Se linha tem só `dd/mm` → inferir ano a partir do `period_end` (não do `today`).
  - Se linha só tem dia da semana → usar a data mais próxima do período, nunca `today`.
  - Datas > `today + 1d` em fluxo de extrato: rejeitar (queda para fallback = period_end).
  - Datas > 400 dias antes de `today`: exigir confidence>=0.9 explícita.
  - Datas com virada de ano: se dia 31/12 aparece antes de 01/01 no mesmo doc, o segundo é `year+1`.
- `normalizeDateBR` fica como fallback para itens sem contexto de período.
- Migration adiciona `document_imports.statement_period_start`, `statement_period_end` (já não existiam — adicionar) com defaults null.

Confirmar: essas colunas ainda não existem no schema atual (não vistas em migrations). Já existem `statement_balance_date`, `statement_bank`, `statement_opening_balance`, `statement_closing_balance`. Adicionar as duas de período.

## 8. Observabilidade ponta a ponta

- `correlation_id` já é gerado; expor no retorno de `finalize`/`status` (já parcial) e no botão "copiar diagnóstico" da revisão.
- Nova função `emitEvent(sb, doc, event_type, extras)` em `assistant-ingest-document` que grava `document_processing_events` **sem dedup** por `event_type` — dedup atual bloqueia eventos legítimos repetidos (ex.: `fragment_completed` de fragmentos diferentes).
- Eventos padronizados: `document_uploaded`, `processing_started`, `fragment_started`, `fragment_completed`, `fragment_failed`, `items_persisted`, `reconciliation_ready`, `review_ready`, `processing_completed`, `processing_failed`, `resumed`, `watchdog_terminated`, `user_confirmed`, `user_canceled`, `user_rolled_back`.
- Códigos de erro estáveis (whitelist): `upload_missing`, `mime_mismatch`, `pdf_encrypted`, `size_exceeds`, `gateway_error`, `gateway_no_api_key`, `extraction_invalid_json`, `extraction_empty`, `fragment_timeout`, `items_insert_failed`, `download_failed`, `unsafe_url`, `watchdog_max_attempts`.
- Sanitização de logs: nunca gravar `raw_text`, `description`, `amount`, `friendly_description`, `bank_description` em eventos ou em `document_imports.error`. Só código + hash truncado quando útil.
- Notificações amigáveis: `notifyDocumentTransition` passa a considerar eventos por documento inteiro (não só primeira ocorrência) mas com throttle de 60s entre outbound do mesmo tipo.
- Painel admin `admin_document_metrics` recebe drill-down por `event_type` e `error_code` (nova função `admin_document_error_breakdown`).

## 9. Download WAHA compatível com a versão real

Reescrever `_shared/messaging/wahaMedia.ts` para:

- Aceitar payload rico: `{ id, chatId, mediaKey, mediaUrl, directPath, filename, mimeType, mediaSize, mediaType, messageTimestamp }`.
- Path 1 (preferido): se `mediaUrl` HTTPS público → SSRF-guard + download direto + magic bytes.
- Path 2: base64 inline (já existente).
- Path 3: endpoint autenticado da WAHA usando **o path exato configurado** — ler `WAHA_MEDIA_ENDPOINT_TEMPLATE` (novo secret opcional, ex.: `/api/{session}/files/{id}` ou `/api/files/{session}/{id}`). Se ausente, tentar matriz atual como fallback com telemetria `download_failed_endpoint`.
- Cabeçalhos: `X-Api-Key` (o WAHA docs oficial usa esse nome), com fallback `Authorization: Bearer`.
- Aceitar tanto `id` quanto `id.serialized` (limpar `@lid`/`@c.us` sufixos antes de encodar).
- Validar `content-type` de resposta contra whitelist antes de gastar tempo com o buffer.
- Toda falha registra `document_processing_events.processing_failed` com `error_code` estável (`download_failed`, `size_exceeds`, `mime_not_allowed`, `unsafe_url`, `timeout`) — e enfileira outbound amigável específica ("não consegui baixar seu arquivo, reenvie por favor").

## 10. Paridade app ↔ WhatsApp

- Unificar os dois branches em um único helper `runIngestion(document_id, options)` chamado tanto por `finalize` quanto por `process-inbound-media` e pelo watchdog.
- `process-inbound-media` passa a usar o mesmo `acquireProcessingLock`, os mesmos fragmentos e o mesmo emitEvent — hoje é um branch curto.
- Bucket `documents` recebe migration versionada reafirmando `allowed_mime_types = {jpeg,png,webp,application/pdf}` e `file_size_limit = 20971520`. Documento vindo do WhatsApp passa a ser salvo no bucket (hoje `storage_path` existe e é criado pelo webhook; garantir MIME liberado).
- `document_imports.source in ('app','whatsapp')` fica canônico. Frontend AssessorPanel exibe origem.

## 11. Testes automatizados

Adicionar em `src/test/` (Vitest) e casos correspondentes de edge functions:

- `documents-informational-drop.test.ts`: linhas "Saldo do dia", "Limite disponível", "SUBTOTAL" nunca viram transações mesmo se modelo retornar `movement_kind` inválido.
- `documents-fragment-persistence.test.ts`: mock supabase → após 2 fragmentos completed e 1 failed, `resume` só reexecuta o failed.
- `documents-source-context.test.ts`: precedência das 5 estratégias e nunca preencher dois campos ao mesmo tempo.
- `documents-dates-period.test.ts`: `dd/mm` inferido pelo período, virada de ano, data futura rejeitada, `today` como fallback só quando não há período.
- `documents-reject-recovery.test.ts`: `reprocess_rejected_items` cria itens `needs_review` e apaga rejeições com códigos elegíveis; não duplica transações confirmadas.
- `documents-large-100items.test.ts`: fixture de 120 itens em 3 fragmentos → contagem, dedupe intra-doc, e respeito ao `MAX_ITEMS_PER_DOCUMENT`.
- `waha-media-download.test.ts`: matriz de endpoints, sucesso path 1, fallback path 3, size_exceeds e unsafe_url produzem outbound específico.
- `whatsapp-webhook-media-parity.test.ts`: mídia entrante cria `document_imports.source='whatsapp'` com mesmo shape que app.
- `documents-cleanup-fragment-aware.test.ts`: watchdog reenfileira só quando há fragmento pendente/failed e nunca depois de `attempts>=3`.
- `merchant-aliases-learning.test.ts`: editar friendly + confirmar aprende alias; próxima extração usa alias.
- Manter os 252 testes atuais verdes.

Fixtures reais anonimizadas: 1 extrato Itaú corrente, 1 fatura Nubank, 1 recibo simples, 1 print de PIX, 1 lista textual, 1 PDF vazio/1 página, 1 PDF grande (>= 12 páginas).

## 12. Segurança

- Confirmar que a migration recente que revogou `EXECUTE` de PUBLIC/anon nas funções `SECURITY DEFINER` não removeu grants a `authenticated` de RPCs usadas pelo cliente (`confirm_document_import`, `cancel_document_import`, `reconcile_document_balance`, `rollback_document_import`, `reprocess_rejected_items`). Auditar e reafirmar `GRANT EXECUTE ... TO authenticated` para cada uma explicitamente.
- `document_fragments`: sem acesso `anon`, sem `INSERT/UPDATE/DELETE` para `authenticated` (só leitura), tudo via service role dentro da edge.
- `merchant_aliases`: `authenticated` gerencia próprios via RLS.
- Storage `documents`: reafirmar policy — path prefix `user_id/` obrigatório, `authenticated` lê/escreve só o próprio prefixo, `service_role` acessa tudo.
- `wahaMedia`: `assertPublicHttpsUrl` já bloqueia SSRF; adicionar teste explícito para `169.254.*`, `10.*`, `127.*`, `localhost`, `metadata.google.internal`.
- Secrets tocados: nenhum novo obrigatório. `WAHA_MEDIA_ENDPOINT_TEMPLATE` opcional. `INTERNAL_CRON_SECRET` já existe.
- Logs: passar por sanitização final que remove campos com nomes `description|body|raw_text|content|payload|masked` antes de qualquer `console.log`.

## 13. Compatibilidade Lovable Cloud

- Toda mudança de schema via `supabase--migration` (fluxo Lovable). Sem `supabase db push` manual.
- Sem `ALTER DATABASE`. Sem tocar `auth`/`storage`/`supabase_functions`/`vault` além do `UPDATE storage.buckets` já suportado.
- Deploy das Edge Functions só após aprovação do plano, uma a uma, com verificação individual.

## 14. Limite de 240 itens

Decisão: **transformar em configurável, default 240**.

- Adicionar em `user_financial_settings.doc_max_items int default 240 check (between 40 and 800)`.
- `MAX_ITEMS_PER_DOCUMENT` passa a ler esse valor por usuário.
- Justificativa: extratos de conta corrente com alta movimentação em Itaú/Nubank passam de 240 facilmente; a rigidez atual gera `skipped` silencioso. 240 permanece bom default para reduzir custo LLM em usuários casuais.

## 15. Sequência de implementação (uma rodada de aprovação, execução progressiva)

1. Migration única "doc-pipeline-v2":
   - Bucket `documents` → mime {jpeg,png,webp,pdf}, 20MB.
   - `document_imports`: colunas source_* + statement_period_start/end.
   - `document_fragments` (tabela + índices + RLS + trigger).
   - `extracted_items` + `transactions`: `bank_description`, `friendly_description`.
   - `merchant_aliases` (tabela + RLS).
   - `user_financial_settings.doc_max_items`.
   - RPCs: `reprocess_rejected_items`, atualização de `enrichment` triggers, GRANTs reafirmados.
2. Edge functions:
   - `_shared/documents/types.ts` (informational preservado + dropped).
   - `_shared/documents/dates.ts` (novo).
   - `_shared/documents/normalize.ts` (consulta aliases).
   - `_shared/messaging/wahaMedia.ts` (reescrito).
   - `assistant-ingest-document/index.ts` (fragmentos persistidos, source context, emitEvent sem dedup, resume-fragment mode, paridade).
   - `documents-cleanup/index.ts` (fragment-aware).
   - `whatsapp-webhook/index.ts` (payload rico WAHA, correlation_id).
   - `assistant-review-actions/index.ts` (rota `reprocess-rejected`, `set-source-context`, `learn-alias`).
3. Frontend:
   - `AssessorAttachButton` (passo opcional conta/cartão).
   - `ReviewSheet` (métricas, fragmentos, reconciliação, rejeitados, aliases).
   - `AssessorPanel` (badge origem, correlation_id no diagnóstico).
4. Testes (todos verdes) e typecheck.
5. Deploy incremental: `assistant-ingest-document`, `assistant-review-actions`, `documents-cleanup`, `whatsapp-webhook`. Verificar individualmente.
6. Publicar frontend somente após validação E2E manual.

## 16. Critérios de aceite mensuráveis

- 0 linhas em `extracted_items` com `movement_kind='transaction'` originadas de descrição `saldo|limite|total|subtotal` em fixtures + amostra real.
- 100% dos `resume` após crash não reexecutam fragmentos `completed` (validado por métrica `tokens_in` no segundo run == 0 para os concluídos).
- 100% dos documentos com `source_context_confidence>=0.9` chegam à revisão com conta/cartão preenchida em todos os itens elegíveis.
- Taxa de `document_imports.status='failed'` por `error_code='items_insert_failed'` cai a 0 (quarentena + recuperação).
- `documents-cleanup` nunca marca `watchdog:max_attempts` em documento com fragmento `completed>0` sem antes tentar reprocessar os `failed` restantes.
- Todo item confirmado tem `friendly_description` estável; segunda importação da mesma linha detecta duplicata forte por `fingerprint`.
- WhatsApp: 100% dos uploads de PDF/imagem em fixtures resultam em `document_imports.source='whatsapp'` com `correlation_id` e pelo menos um evento `processing_started`.
- Testes: `vitest` 100% verde; typecheck limpo; linter Supabase sem novos WARN.

## 17. Plano de rollback

- Migration escrita em blocos idempotentes (`IF NOT EXISTS`, `DROP ... IF EXISTS`). Rollback manual: `DROP TABLE document_fragments`, `DROP TABLE merchant_aliases`, `ALTER TABLE ... DROP COLUMN` para as novas colunas; RPCs novas com `DROP FUNCTION IF EXISTS`.
- Edge functions: manter tag/backup do commit anterior (`f0d1b6c5...`). Redeploy da versão anterior via CLI Lovable em caso de regressão.
- Frontend: publish anterior fica disponível para revert.
- Dados: nenhuma alteração destrutiva em `transactions`/`extracted_items` existentes. Só adição de coluna. Rollback não perde histórico.

## 18. Checklist fechada

Implementação:
- [ ] Migration doc-pipeline-v2 aplicada (bucket, colunas, tabelas, RPCs, GRANTs).
- [ ] `_shared/documents/types.ts` preserva `informational` e conta drop.
- [ ] `_shared/documents/dates.ts` novo + integrado.
- [ ] `_shared/documents/normalize.ts` consulta `merchant_aliases`.
- [ ] `_shared/messaging/wahaMedia.ts` reescrito com payload rico + template.
- [ ] `assistant-ingest-document` usa `document_fragments`, `resume-fragment`, source_context, emitEvent sem dedup, `MAX_ITEMS_PER_DOCUMENT` do settings.
- [ ] `assistant-review-actions` com `reprocess-rejected`, `set-source-context`, `learn-alias`.
- [ ] `documents-cleanup` fragment-aware.
- [ ] `whatsapp-webhook` unificado + correlation_id.
- [ ] `AssessorAttachButton` com passo conta/cartão.
- [ ] `ReviewSheet` novo com métricas, fragmentos, reconciliação, rejeitados.
- [ ] `AssessorPanel` badge origem + diagnóstico.

Publicação (Lovable Cloud):
- [ ] Deploy `assistant-ingest-document` verificado.
- [ ] Deploy `assistant-review-actions` verificado.
- [ ] Deploy `documents-cleanup` verificado.
- [ ] Deploy `whatsapp-webhook` verificado.
- [ ] Frontend publicado.

Testes:
- [ ] Vitest 100% verde (novos + antigos).
- [ ] Typecheck limpo.
- [ ] Supabase linter sem novos WARN de segurança.
- [ ] Suite de fixtures reais: Itaú, Nubank, PIX, recibo, lista, PDF vazio, PDF grande — todas terminam em `needs_review`/`partial` com métricas coerentes.
- [ ] E2E manual: (a) upload PDF pelo app com seleção de conta; (b) envio de PDF pelo WhatsApp; (c) confirmar 5 itens; (d) editar friendly e aprender alias; (e) reconciliar saldo; (f) reprocessar rejeitados; (g) rollback.
