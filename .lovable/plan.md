# Rodada consolidada: correções críticas + hardening + WhatsApp mídia

## 1. Bug bloqueador: "operator does not exist: text = text[]"

**Causa real (confirmada no banco):** RPC `public.transaction_update_direct` (migração `20260716205948_...sql`) tem, no bloco de dismiss de insights:

```sql
(evidence->>'transaction_id')::text = any(
   (select array_agg(x::text) from unnest(affected_ids) x)
)
```

Quando `= ANY(subquery)` recebe uma subquery *escalar* que devolve `text[]`, o Postgres interpreta como `text = text[]` (operador de conjunto em vez de operador de array). Só dispara quando `category_id` está no patch — exatamente o cenário do print.

**Correção (migration nova, idempotente `CREATE OR REPLACE FUNCTION`)** — trocar por:

```sql
and (evidence->>'transaction_id') in (
  select x::text from unnest(affected_ids) x
)
```

Mantém tudo o resto do RPC. Nenhum dado é alterado.

**Frontend (`LancamentoDetalhe.tsx`)**: mapear `error.message` do RPC para toasts amigáveis (`conflict → "Este lançamento foi atualizado em outro dispositivo, recarregue"`, `not_owned → "Lançamento não encontrado"`, demais → "Não consegui salvar agora. Tente novamente."). Detalhe técnico apenas no `console.error`.

**Extensão do RPC**: adicionar suporte a `account_id`, `credit_card_id`, `payment_method` no `p_patch` (hoje só aceita description/category/amount/occurred_at/notes/purchase_date/competence_date). Aplicar regra: se muda `payment_method` para `credit_card` exigir `credit_card_id`; caso contrário exigir `account_id`. Trigger `validate_transaction` já cobre o resto.

**LancamentoDetalhe**: adicionar selects de Conta/Cartão e método de pagamento (radio account/credit_card), preservando semântica atual. Bloquear edição de transferências (já é bloqueada em Lancamentos, replicar no detalhe).

**Testes**: teste vitest chamando o RPC via mock que valida shape do patch; teste de UI para toast amigável no erro; migração aplicada + smoke real (curl RPC autenticado via psql/edge function).

## 2. Semântica do assistente (descrição ≠ método)

**Problema:** o agente gravou `description = "crédito"`. Isso vem do `prompt` + `tools.createTransaction` que hoje aceita descrição livre sem separar do método.

**Correções:**

- **`supabase/functions/_shared/agent/prompt.ts`**: nova versão `v5` (persistir em `agent_prompt_versions`, ativar) explicitando: "descrição = o que foi comprado/pago/recebido, nunca o meio de pagamento. 'crédito', 'débito', 'pix', 'dinheiro', 'cartão', 'boleto' NÃO podem ser descrição — são payment_method/origin. Se o usuário só disser o meio, pergunte 'o que foi essa compra?' antes de confirmar."
- **`supabase/functions/_shared/agent/tools.ts`** (`createTransaction`, `requestTransactionConfirmation`): validar server-side — se `description` normalizada (lowercase, sem acento) ∈ {crédito, credito, débito, debito, pix, dinheiro, cartão, cartao, boleto, transferência, ted, doc}, rejeitar com `needs_description`, forçando o modelo a perguntar.
- Adicionar tool `updateTransactionById(id, patch)` e `findRecentTransactions(query)` para o agente conseguir corrigir lançamentos existentes quando o usuário disser "era Y" / "foi referente a Z" / "muda a categoria pra X".
- **Estado da conversa**: `conversations` já persiste; garantir que ao receber correção o agente busque o último `transaction_id` executado no thread (novo campo em `conversation_messages.metadata.executed_ids`) para saber qual editar.
- **Testes conversacionais** (`src/test/agent-semantics.test.ts`): 6 cenários — "gastei 50 no crédito" (deve perguntar descrição), "gastei 50 no bar no crédito" (description=bar, method=credit_card), "era referente ao mercado" (edita última tx), "muda pra alimentação" (edita category), "foi 60 e não 50" (edita amount), "apaga esse último" (delete com confirmação).

## 3. Responsividade global

**Diagnóstico do print:** `LancamentoDetalhe.tsx` tem grid `grid-cols-2` para Valor/Data — no iPhone SE (375px) o campo de data ("16 de jul. de 2026") não cabe. Toast sobreposto ao safe-area inferior (falta `pb-[env(safe-area-inset-bottom)]` no toaster ou padding no layout).

**Escopo de auditoria**: todas as rotas em `src/pages/**` + `src/pages/admin/**` (~35 páginas). Ferramenta: Playwright headless nos 6 viewports (320/360/375/390/414/430), scroll horizontal detectado via `document.documentElement.scrollWidth > innerWidth`.

**Correções globais em `src/index.css`**:
- `.input-base` ganha `min-w-0`, `max-w-full`;
- container principal `.app-content` já é `max-w-4xl`, garantir `px-4 md:px-6` e `pb-24 md:pb-8` (safe area do bottom tab bar).

**Correções pontuais**:
- `LancamentoDetalhe`: Valor/Data viram `grid-cols-1 sm:grid-cols-2`; data como `<input type="date">` (mais compacto e nativo mobile). Botões Salvar/Excluir: `flex-wrap gap-2`.
- Tabelas admin (`Usuarios.tsx`, `Financeiro.tsx`, `Operacao.tsx`, etc.): envolver em `<div className="overflow-x-auto -mx-4 px-4">` OU converter para cards abaixo de `md`.
- FAB do assessor: `bottom-24 md:bottom-6` para não colidir com bottom tab.
- Toaster (`sonner`): `position="top-center"` no mobile para não brigar com nav inferior.

**Teste automatizado** (`src/test/responsive.test.ts`): playwright puppeteer script que abre cada rota autenticada nos 6 viewports e falha se houver overflow horizontal.

## 4. Hardening da importação de imagens

**Bucket**: nova migração `alter storage bucket documents set file_size_limit=10485760, allowed_mime_types='{image/jpeg,image/png,image/webp}'` (via `supabase--storage_update_bucket` ou UPDATE em `storage.buckets` se permitido — verificar; caso contrário, manter validação server-side que já existe).

**FKs e validações** (migration):
- `extracted_items.user_id` — adicionar CHECK ou trigger `BEFORE INSERT/UPDATE` que `NEW.user_id = (select user_id from document_imports where id = NEW.document_id)`;
- FKs: `extracted_items.account_id → accounts(id)`, `credit_card_id → credit_cards(id)`, `category_id → categories(id)`, `duplicate_of → transactions(id)`, todos `ON DELETE SET NULL`;
- Trigger `validate_extracted_item` que confere ownership de account/card/category = user_id do item.

**`assistant-review-actions`**: remover `status` de `ALLOWED_PATCH_KEYS` (usuário só muda via `ignore`/`confirm`/`cancel`). Adicionar validação: se `patch.payment_method='credit_card'` exigir `credit_card_id`, senão exigir `account_id`. Validar ownership dos IDs antes do update.

**RPC `confirm_document_import`**: envolver em transação explícita com savepoint por item; se algum item falhar, retornar `{ok:true, inserted:[...], failed:[{item_id, reason}]}` para UI mostrar parcial recuperável. Idempotência: já usa `import_source_id`; reforçar com unique constraint parcial em `transactions(user_id, import_source_id) where import_source_id is not null`.

**Purchase group**: hoje agrupa por (user_id, occurred_at, credit_card_id, installments_total). Corrigir para incluir `description` normalizada + `amount_per_installment` — ou melhor, gerar `purchase_group_id` = `gen_random_uuid()` uma vez por linha extraída com parcelamento (no lado do ingest, não no RPC), garantindo unicidade.

**`documents-cleanup`**: adicionar verificação de header `x-internal-secret` == `Deno.env.get("INTERNAL_CRON_SECRET")`. Trocar `pg_cron` para chamar via `net.http_post` passando o header. Migração remove credenciais literais.

**Base64 grande**: `assistant-ingest-document` hoje faz `String.fromCharCode(...bytes)` (spread → stack overflow em >100KB). Trocar por loop em chunks de 8KB + `btoa` incremental, ou usar `encodeBase64` do `std/encoding/base64.ts` do Deno.

**Deduplicação concorrente**: adicionar `unique(user_id, sha256_hash)` em `document_imports` (já existe? verificar migration). Se colisão → retornar document_id existente.

**Recuperação de falha**: `document_imports.status` ganha `retry_count`, cron reprocessa `failed` com retry_count<3.

**Testes reais**: script Playwright autenticado que sobe uma imagem fixture (recibo), aguarda extração, edita 1 item, confirma, checa transação criada, checa isolamento com segundo usuário.

**Métricas**: nova tabela `document_processing_metrics(document_id, tokens_input, tokens_output, latency_ms, model, status)` populada pelo `assistant-ingest-document`, agregada no admin `/admin/financeiro` (sem exibir para o usuário).

## 5. WhatsApp: imagens ponta a ponta

**`whatsapp-webhook/index.ts`** (autorizado alterar nesta rodada):
- Branch `if (event.hasMedia && ALLOWED_MIME.includes(event.mediaMimeType))`:
  1. Resolver user via `whatsapp_links` pelo `from_phone` normalizado; se não vinculado → responder "Vincule seu WhatsApp em app.nocontrole.ia primeiro" e ignorar;
  2. Dedup por `external_message_id` (texto do WAHA) em `inbound_messages` — se já existe, sair;
  3. Baixar mídia via `messaging/waha.ts:downloadMedia(event.mediaUrl)` com `WAHA_API_KEY`, timeout 15s, tamanho máx 10MB;
  4. Chamar `assistant-ingest-document` internamente (service-role) com o buffer;
  5. Ao retornar `needs_review`, gravar `document_id` em `pending_confirmations(kind='document_review', payload={document_id, item_ids})`;
  6. Responder: "Achei N lançamentos nessa imagem: 1) X R$Y  2) Z R$W ... Responda: CONFIRMAR TODOS, CONFIRMAR 1,3, IGNORAR 2, ou CANCELAR."
- Parser de comandos em texto no mesmo webhook: se última `pending_confirmations` do user for `document_review` e texto casar regex `/^(confirmar|ignorar|cancelar)/i`, executar via `assistant-review-actions`.

**Feature flag** `WA_MEDIA_ENABLED` (env var); se `false` → responder "Envio de imagens está sendo liberado". Default `true` após smoke test real; se smoke falhar, deploy com `false` e reportar como gap único.

**Tratamento de erros amigáveis**: ilegível → "não consegui ler, envia mais nítida?"; não financeiro → "não parece recibo/fatura"; grande → "manda uma imagem menor que 10MB"; timeout → "tenta de novo em instantes".

**Teste WAHA E2E**: enviar imagem real pelo simulador WAHA para número de teste; validar toda a cadeia + confirmação por texto.

## 6. Qualidade e entrega

**Migrations** (todas idempotentes, sem DROP de dado):
1. `fix_transaction_update_direct_text_array` — RPC corrigida + patch estendido.
2. `harden_extracted_items` — FKs, trigger de ownership, unique de dedup.
3. `document_metrics` — tabela + GRANTs + RLS admin.
4. `documents_cleanup_secret` — cron atualizado.

**Ordem de execução**:
1. Migrations (aprovação do usuário — supabase--migration surge após aprovação do plano).
2. Edits de código (RPC extension, tools, prompt v5, UI Detalhe/responsivo, ingest hardening, webhook mídia).
3. Deploy edge functions: `agent-chat`, `agent-run`, `assistant-ingest-document`, `assistant-review-actions`, `documents-cleanup`, `whatsapp-webhook`, `whatsapp-send` (só as tocadas).
4. Prompt v5 ativado via INSERT em `agent_prompt_versions` + UPDATE em `agent_settings.active_version`.
5. Testes: vitest full, typecheck, build, Playwright autenticado 2-user e responsivo.
6. Preview atualizado (sem publish).

## Critérios de aceite

- [ ] Editar categoria no mobile grava sem erro.
- [ ] Toast de erro é amigável; stack fica no console.
- [ ] Agente não grava "crédito"/"pix" como descrição; pergunta o quê foi.
- [ ] Agente edita tx existente por comando textual.
- [ ] 6 cenários conversacionais passam.
- [ ] Nenhuma rota tem overflow horizontal em 320-430px.
- [ ] Bucket documents com limites; unauthorized POST no cleanup retorna 401.
- [ ] Upload → review → confirm cria transaction correta com payment_method preservado.
- [ ] Isolamento entre 2 users validado.
- [ ] WhatsApp: imagem real vira review; CONFIRMAR TODOS cria transações; mensagens de erro amigáveis.
- [ ] `pnpm typecheck && pnpm build && pnpm test` verdes.
- [ ] Métricas de tokens/latência aparecem no admin.

## Gaps conhecidos que serão declarados

- Se WAHA smoke real falhar em produção (ex.: API key sem permissão de download), entrega com `WA_MEDIA_ENABLED=false` e reporta como único bloqueio.
- Ajuste de `storage.buckets.file_size_limit` pode exigir `supabase--storage_update_bucket`; se rejeitado, mantém validação server-side (10MB já enforced).

## Arquivos tocados

**Migrations (novas)**: 4 arquivos em `supabase/migrations/`.

**Backend**:
- `supabase/functions/_shared/agent/prompt.ts` (v5)
- `supabase/functions/_shared/agent/tools.ts` (validação descrição, updateTransactionById, findRecentTransactions)
- `supabase/functions/_shared/agent/orchestrator.ts` (persistir executed_ids)
- `supabase/functions/assistant-ingest-document/index.ts` (base64 chunked, dedup, métricas)
- `supabase/functions/assistant-review-actions/index.ts` (remover status, validar ownership, parcial)
- `supabase/functions/documents-cleanup/index.ts` (secret header)
- `supabase/functions/whatsapp-webhook/index.ts` (branch mídia + comandos textuais)
- `supabase/functions/_shared/messaging/waha.ts` (downloadMedia)

**Frontend**:
- `src/pages/LancamentoDetalhe.tsx` (conta/cartão/método, grid responsivo, erros amigáveis)
- `src/pages/Lancamentos.tsx` (ajustes finos)
- `src/index.css` (safe-areas, min-w-0 default)
- `src/components/AppLayout.tsx` / `BottomTabBar.tsx` (padding safe-area)
- `src/pages/admin/*.tsx` (tabelas responsivas — auditoria completa)
- `src/components/assessor/AssessorFab.tsx` (bottom offset)

**Tests**: `src/test/agent-semantics.test.ts`, `src/test/responsive.test.ts`, `src/test/transaction-update-rpc.test.ts`, atualização de fixtures.

**Secrets**: `INTERNAL_CRON_SECRET` (novo) e verificar `WAHA_API_KEY`.
