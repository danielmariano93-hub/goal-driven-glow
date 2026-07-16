
# NoControle.ia — Ingestão por imagem/print + Edição acessível de lançamentos

Plano único, executável em uma rodada. **Não altera** WAHA/webhook/sessão em runtime nesta rodada (apenas prepara o parser de mídia dentro do webhook existente, sem tocar infraestrutura Docker/VPS). **Não publica** frontend. Complementa o `.lovable/plan.md` de edição de lançamentos já implementado (RPCs `transaction_update_direct` / `transaction_delete_direct`, `version`, `purchase_group_id`, rota `/app/lancamentos/:id`).

---

## 1. Diagnóstico do estado atual

- `src/pages/Lancamentos.tsx`: lista renderiza apenas botão **Excluir** por linha. Existe `TxModal` com estado `editing`, mas nenhum caminho de UI aciona `setEditing(item)` a partir da lista → **edição não está exposta no mobile nem no desktop**. Toque na linha não faz nada. Modal antigo tampouco cobre cartão, parcelas e conta corretamente.
- Rota `/app/lancamentos/:id` já existe (`LancamentoDetalhe.tsx`) com edição segura, versão otimista, escopo one/future/all e transferência read-only. Deep-link `?edit=1&focus=category` funcional.
- Agente/WhatsApp: hoje só texto. `agent-chat` recebe `{ messages }` de texto; `whatsapp-webhook` ignora mídia. Não há bucket, tabelas de importação nem pipeline multimodal.
- Extração canônica por spans já existe (`src/lib/agent/extract.ts` + shared em `supabase/functions/_shared/agent/extract.ts`).
- `payment_method` schema real = `"credit_card" | "account"`. Vamos manter.

## 2. Integração com o plano anterior (sem conflito)

- Reutilizar `transactions.version`, `purchase_group_id`, `transaction_update_direct`, `transaction_delete_direct`, `agent_execute_confirmation`, `pending_confirmations`.
- Reutilizar `LancamentoDetalhe.tsx` como destino do deep-link a partir da lista, do assessor e das cards do lote confirmado.
- Não recriar migrations existentes. As novas migrations desta rodada adicionam apenas: `document_imports`, `extracted_items`, bucket privado, políticas RLS e função `confirm_document_import`.

---

## 3. Arquitetura de ingestão única (app + WhatsApp)

```text
                       ┌────────────────────────────────────────────┐
 App (chat/anexo) ───▶ │ Edge: assistant-ingest-document            │
 WA webhook (media)─▶  │  1. baixa/valida mídia                     │
                       │  2. upload bucket privado (documents/)     │
                       │  3. cria document_imports (status=processing)
                       │  4. chama LLM multimodal (visão)           │
                       │  5. persiste extracted_items (needs_review)│
                       │  6. dedupe + confidence                    │
                       └────────────────────┬───────────────────────┘
                                            │
     ┌─────────── Assessor UI (chat) ◀──────┤  emite card resumo com CTA
     │                                       │  "Revisar N lançamentos"
     ▼                                       ▼
 ReviewSheet (mobile) / ReviewPanel (desktop)
  ├─ editar item (valor, data, conta/cartão, parcela, categoria)
  ├─ marcar/ignorar duplicatas
  ├─ confirmar seleção → RPC confirm_document_import(items[])
  └─ resultado: transactions criadas com import_source + purchase_group_id
```

Uma única pipeline canônica para app e WhatsApp. Após ingestão, a imagem **não** volta ao modelo em turnos seguintes; a referência estruturada (draft) é anexada à `conversation` do assessor.

---

## 4. Schema/migration mínima

Uma migration única:

```sql
-- 4.1 document_imports
create table public.document_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('app','whatsapp')),
  storage_path text not null,             -- bucket 'documents' (privado)
  mime_type text not null,
  size_bytes int not null,
  sha256 text not null,                    -- hash do arquivo (dedupe global por user)
  document_kind text,                      -- 'receipt'|'invoice'|'statement'|'list'|'unknown'
  status text not null default 'uploaded'
    check (status in ('uploaded','processing','needs_review','confirmed',
                      'partially_confirmed','failed','expired')),
  model text, tokens_in int, tokens_out int, cost_usd_micros bigint,
  raw_text text,                           -- OCR/visão bruto (opcional, retenção curta)
  error text,
  conversation_id uuid,
  message_id uuid,
  expires_at timestamptz default (now() + interval '30 days'),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, sha256)
);
grant select, insert, update, delete on public.document_imports to authenticated;
grant all on public.document_imports to service_role;
alter table public.document_imports enable row level security;
create policy "own docs" on public.document_imports for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4.2 extracted_items
create table public.extracted_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.document_imports(id) on delete cascade,
  user_id uuid not null,
  idx int not null,                        -- ordem no documento
  status text not null default 'needs_review'
    check (status in ('needs_review','ignored','confirmed','duplicate_suspect','rejected')),
  type text not null check (type in ('income','expense')),
  amount numeric(14,2) not null,
  occurred_at date not null,
  description text,
  payment_method text check (payment_method in ('account','credit_card')),
  account_hint text, card_hint text,
  account_id uuid, credit_card_id uuid,
  category_id uuid, category_hint text,
  installments_total int, installment_number int,
  purchase_date date, competence_date date,
  confidence jsonb not null default '{}'::jsonb,   -- por campo
  duplicate_of uuid references public.transactions(id),
  transaction_id uuid references public.transactions(id),
  source_span jsonb,                                -- bbox/linha
  raw jsonb,                                        -- item bruto do modelo
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(document_id, idx)
);
grant select, insert, update, delete on public.extracted_items to authenticated;
grant all on public.extracted_items to service_role;
alter table public.extracted_items enable row level security;
create policy "own items" on public.extracted_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4.3 storage bucket privado 'documents' (criado via storage_create_bucket, public=false)
-- policies em storage.objects: user só lê/escreve prefixo <user_id>/*

-- 4.4 RPC confirm_document_import(p_document_id uuid, p_item_ids uuid[])
-- SECURITY DEFINER, valida auth.uid() == document.user_id, escreve transactions
-- em uma transação, aplica purchase_group_id para parcelamentos, retorna
-- { ok, created:[{item_id, transaction_id}], skipped, errors }.
-- Idempotente: se item.transaction_id já existe, ignora.

-- 4.5 trigger para expirar/limpar raw_text após 7 dias (retenção curta).
```

Sem alteração em `transactions`.

---

## 5. Storage, retenção e privacidade

- Bucket `documents` **privado**, path `{user_id}/{document_id}.{ext}`.
- Signed URL curta (5 min) apenas para o próprio usuário no ReviewSheet quando quiser rever a imagem.
- Remover EXIF antes do upload. Limitar tamanho (10 MB), dimensões (máx 6000px lado maior), MIME real por magic bytes.
- `raw_text` e imagem apagados por cron 7 dias após `status ∈ (confirmed, partially_confirmed, failed)`; `document_imports` metadados retidos 30 dias.
- LGPD: aviso "vamos ler apenas dados financeiros deste documento; imagem apagada em até 7 dias". Nenhum treinamento com dados.

---

## 6. Edge Functions e tools

Novas Edge Functions:

- `assistant-ingest-document` (chamada do app; body `{ storage_path | base64, mime, conversation_id }`): valida, cria `document_imports`, extrai com modelo multimodal (`google/gemini-3.1-flash` inicial; fallback `google/gemini-2.5-flash`), popula `extracted_items`, roda dedupe.
- `assistant-review-actions` (get/update/delete/cancel/confirm): endpoint único para o assessor via tools.
- `whatsapp-webhook` (**edit mínima, sem deploy nesta rodada**): planejar adição de branch `if (event.hasMedia)` que:
  1. baixa `media.url` server-side com `WAHA_API_KEY` (do Vault), timeout curto;
  2. copia para bucket `documents/`; 
  3. chama `assistant-ingest-document`;
  4. responde ao usuário "Recebi sua imagem, estou lendo…";
  5. dedupe por `message_id` + `sha256`.
  Nenhum deploy no WAHA/Docker; apenas código Deno.

Novas tools do agente (`_shared/agent/tools.ts`):

- `ingest_financial_document(storage_ref)` — normalmente disparada pelo cliente após upload; agente confirma recebimento.
- `get_document_status(document_id)`
- `review_extracted_items(document_id)` — devolve lista compacta.
- `update_extracted_item(item_id, patch)`
- `confirm_document_import(document_id, item_ids[])`
- `cancel_document_import(document_id)`

`user_id` sempre do JWT no servidor; nunca do payload/modelo. Prompt do assessor recebe **apenas draft estruturado** (não a imagem) em turnos posteriores.

---

## 7. UI — Edição acessível

`src/pages/Lancamentos.tsx`:

- Linha inteira vira `<button role="link">` com hit target ≥ 48px, navegando para `/app/lancamentos/:id`.
- Adicionar menu "⋯" (Radix `DropdownMenu`) por linha com **Editar**, **Duplicar**, **Excluir**. Excluir deixa de ser a única ação visível.
- Ícone lápis com `aria-label="Editar"` visível em ≥ md.
- Swipe (opcional, `framer-motion`) revela ações; nunca substitui o menu.
- Empty state e loading permanecem.
- Selecionar múltiplos (checkbox) — desativado nesta rodada (fora de escopo mínimo).

`src/pages/LancamentoDetalhe.tsx` (já existe): 

- Adicionar botão "Editar" persistente no topo do detalhe quando `?edit=1` ausente.
- Layout: mobile → tela cheia com safe-area (`env(safe-area-inset-bottom)`), teclado com `interactive-widget=resizes-content` no `index.html`.
- Desktop → modal centralizado (max-w-2xl) sobre a lista.
- Preservar automaticamente **conta vs cartão**: renderiza um bloco ou outro; troca de método exige confirmação explícita e chama `transaction_update_direct` com o patch coerente (`payment_method`, `account_id`, `credit_card_id`, `purchase_date`, `competence_date`).
- Parcelamento: bloco de escopo `one|future|all` já implementado — habilitado só quando `purchase_group_id` existe.
- Transferência: read-only + botão "Excluir par completo".
- Deep-link `?edit=1&focus=<field>` foca campo específico.
- Após salvar/excluir: invalida `transactions`, `assistant-tip`, `home-summary`, `cards-summary`, `insights`, `reports`.

## 8. UI — Ingestão e revisão em lote

Novo componente `AssessorAttachButton` no chat do app:

- Botão clip; opções **Câmera**, **Galeria**, **Arquivo**. Preview miniatura, remover, reenviar.
- Client faz: strip EXIF (canvas), compressão, upload direto para bucket `documents/` com signed upload URL emitida por `assistant-ingest-document` (mode=write). Sem service key no cliente.
- Após upload, chama `assistant-ingest-document` → status card no chat.

Novo `ReviewSheet` (mobile bottom sheet / desktop modal):

- Cabeçalho com resumo (N itens, R$ total, tipo de documento).
- Lista virtualizada de `extracted_items`:
  - Checkbox de seleção; "selecionar todos/nenhum".
  - Campos inline: descrição, valor, data, categoria, conta/cartão, parcelas.
  - Badge de confidence e aviso "possível duplicata de …".
  - Editar abre bottom sheet secundária com o mesmo formulário de `LancamentoDetalhe` reaproveitado.
- Rodapé fixo: "Confirmar N lançamentos" (idempotente) + "Cancelar importação".
- Resultado: toast + card no chat "Registrei N lançamentos. Ver lançamentos →".

Sem transação criada antes da confirmação.

---

## 9. Extração e modelo canônico

Prompt de visão (nova versão filha da ativa) exige JSON:

```json
{
  "document_kind": "receipt|invoice|statement|list|non_financial|illegible",
  "items": [{
    "type":"expense|income",
    "description":"literal",
    "amount":123.45,
    "occurred_at":"YYYY-MM-DD",
    "payment_method":"account|credit_card|null",
    "account_hint":"...", "card_hint":"...",
    "installments_total":null, "installment_number":null,
    "category_hint":"...",
    "confidence":{"amount":0.9,"occurred_at":0.7,...},
    "source_span":{"page":1,"bbox":[...]}
  }],
  "notes":"por que descartei linhas de saldo/limite"
}
```

Regras:
- valores BR (`1.234,56`), datas BR;
- nunca inventar texto ilegível;
- excluir saldo, limite disponível, subtotais e pagamento de fatura de lista de compras;
- reconhecer estorno como `income`;
- se `document_kind` ∈ `non_financial|illegible`, responder pedindo outra imagem e não criar itens.

---

## 10. Duplicidade e reconciliação

Após extração, para cada item:

1. Buscar `transactions` do mesmo `user_id`, mesmo `amount`, mesma `occurred_at` ±2 dias, descrição normalizada Levenshtein ≤ 3, mesma conta/cartão inferida, mesmo `installment_number`.
2. Se match forte → `status='duplicate_suspect'`, `duplicate_of=<tx.id>`.
3. Fatura de cartão: se item for "pagamento fatura Nubank" e existir `transfer` com mesmo valor/data, marcar duplicata; nunca criar automaticamente.
4. Hash `sha256` do documento + `idx` compõem `import_key` para idempotência; reprocessar mesmo doc não recria itens.
5. UI oferece "já registrei", "importar mesmo assim", "ignorar".

`transaction_update_direct`/`_delete_direct` continuam sendo o único caminho para alterar registros existentes.

---

## 11. Agente/conversa

- Draft da importação persistido em `conversations.metadata` (jsonb) com `document_id` — não guardar imagem no histórico textual.
- Assessor entende: "registre esses gastos", "o primeiro foi no Itaú", "não inclua o Uber", "categorize todos de mercado como Alimentação", "confirme só os três primeiros". Traduz para chamadas `update_extracted_item` + `confirm_document_import(item_ids)`.
- Loop guard 6–8 passos; após confirmação, agente não reabre draft.
- Mesma pipeline para WA: usuário manda foto, recebe card resumo por texto ("Encontrei 4 gastos. Toque para revisar: <link app>") — confirmação sempre no app (não expor toda a lista por WA neste release para evitar UX confusa; ampliar depois).

---

## 12. Admin — métricas sanitizadas

Nova aba `/admin/documentos` (fora do painel FinOps): documentos recebidos por origem, processados/falhos/ilegíveis, itens extraídos vs confirmados, duplicatas detectadas, tempo médio, custo médio, taxa de correção manual, erros por etapa. Sem visualização de imagens nem valores brutos.

---

## 13. Testes bloqueadores (Vitest + fixtures)

Unit/integração:
- extractor multimodal com 5 fixtures (3 compras, fatura, recibo, ilegível, não-financeiro, valores BR, datas BR);
- dedupe: hit, near-miss, pagamento fatura vs compra;
- RPC `confirm_document_import`: idempotência, escopo, RLS A/B, `purchase_group_id` gerado para parcelas;
- tools do agente: `update_extracted_item` valida ownership; `confirm_document_import` respeita item_ids;
- UI Lançamentos: linha clicável, menu "⋯" com Editar/Duplicar/Excluir, botão Editar visível no detalhe;
- Deep-link `/app/lancamentos/:id?edit=1&focus=category` foca campo;
- Edição preserva `credit_card_id`/`account_id` conforme método; troca de método exige confirmação;
- Transferência: fluxo read-only; exclusão apaga par;
- WA webhook (unit, mock): dedupe por `message_id`+`sha256`; media.url ausente → mensagem "não consegui baixar";
- Acessibilidade: hit targets ≥44, `aria-label`, foco visível.

Também: typecheck, build, suíte completa verde.

---

## 14. Sequência única de implementação

1. Migration (`document_imports`, `extracted_items`, bucket + policies, RPC `confirm_document_import`, trigger de retenção).
2. Edge Functions: `assistant-ingest-document`, `assistant-review-actions`.
3. Prompt filho v4 (visão multimodal) — criado inativo, ativado após testes.
4. Tools agente + orquestrador (fast-path para intents de revisão).
5. UI: `AssessorAttachButton`, `ReviewSheet`, ajustes em `AssessorPanel`.
6. UI: `Lancamentos.tsx` (linha clicável, menu "⋯", swipe opcional).
7. UI: `LancamentoDetalhe.tsx` (botão Editar persistente, layout mobile sheet).
8. Webhook WA — adicionar branch de mídia **em código** (sem deploy Docker), com feature flag `WA_MEDIA_ENABLED=false` inicial. Deploy só após aprovação.
9. Testes + suite + typecheck + build.
10. Deploy das Edge Functions **exceto** `whatsapp-webhook` (mantido inalterado em runtime).

---

## 15. Critérios de aceite

- Mobile: toque em uma linha da lista abre `/app/lancamentos/:id`; menu "⋯" oferece Editar/Duplicar/Excluir; Excluir não é a única ação aparente.
- Detalhe mostra botão "Editar" persistente; formulário respeita conta vs cartão; parcelas com escopo; transferência read-only.
- Chat do app aceita imagem, exibe preview, mostra card "Encontrei N lançamentos"; ReviewSheet permite editar/ignorar/confirmar; após confirmar, `transactions` criadas em lote com `import_source=document:<id>`.
- Nenhum lançamento é criado antes de confirmação explícita.
- Duplicatas sinalizadas; usuário decide.
- Reprocessar mesmo documento não duplica itens.
- Home, Lançamentos, Cartões, Insights e Relatórios refletem novos registros.
- WA: código presente e testado, feature flag desligada (nenhum deploy WAHA nesta rodada).
- Nenhuma exposição de service key, signed URL longa, EXIF ou PII em logs.
- Suite completa, typecheck e build verdes.

---

## 16. Impacto estimado em tokens/custo

- 1 documento com 3–10 itens ≈ 3–8k tokens (Gemini 3.1 Flash multimodal) ≈ US$ 0,002–0,006 por documento.
- Após ingestão, turnos seguintes usam draft textual (~500 tokens) sem imagem.
- Fast-path para `review_extracted_items`/`confirm_document_import` sem LLM.

---

## 17. Riscos e gaps

- **Modelo multimodal**: variação em faturas mal fotografadas. Mitigação: confidence por campo + revisão obrigatória.
- **WAHA `media.url`**: pode expirar; download server-side imediato; se falhar, pedir reenvio.
- **Bucket público inadvertido**: garantir `public=false` e teste que confirma retorno 403 sem signed URL.
- **Colisão de dedupe**: janela ±2 dias pode ser agressiva; tornar configurável, default 1 dia.
- **UX WA em lote**: revisão real fica no app; WA envia apenas link/resumo.
- **Retenção**: cron de expiração precisa de `pg_cron`/edge scheduled; se indisponível, executar via `agent-run`.
- **Fora de escopo**: PDF multi-página, extratos > 50 linhas, exportação, alteração real de WAHA/Docker/VPS, publicação do frontend.

