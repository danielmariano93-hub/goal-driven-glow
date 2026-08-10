# Verdade de Caixa Única — Extrato Itaú 10/08 fecha em R$ 52,63

Release único: contrato de âncora bancária, separação entre data econômica e data bancária, reconciliação canônica, estorno/pagamento de fatura corretos e saneamento auditável dos dados atuais. Alvo: extrato = ledger = snapshot = Home = **R$ 52,63**, sem ajuste artificial.

## 1. Auditoria — cada diagnóstico confirmado ou contestado

| # | Diagnóstico | Veredito | Evidência levantada agora |
|---|---|---|---|
| A | Snapshot 02/08 = 589,39 usado como âncora dura | **Confirmado** | `account_balance_snapshots`: 589,39 em 2026-08-02, `status=confirmed`, `source='statement'`, **`source_document_id` NULL** (sem proveniência). `computeAccountBalances` (facts.ts ~150-180) usa o último snapshot `confirmed` e aplica tudo com `cashDateOf > cutoff`. Não existe âncora 31/07 = 923,85 no banco. |
| B | `posted_at_source='inferred'` tratado como data bancária | **Confirmado** | Quase todo o ledger de agosto tem `posted_at_source='inferred'` (Autopass, Souk4u, iFood, CDB). `cashDateOf` usa `posted_at` sem distinguir a origem. |
| C | Falta reconciliar registro em tempo real com a linha do extrato | **Confirmado** | Autopass 5,40 manual em 01–08/08 (`origin=manual`, sem `source_document_id`) coexiste com as linhas do extrato; o importador só cria transação nova ou marca suspeita, nunca "anexa" postagem bancária ao lançamento econômico existente. |
| D | Entity resolution não compartilhada com dedupe | **Parcialmente confirmado** | `_shared/import/dedupe.ts` já importa `merchantCanonical` de `categorization/normalize.ts` — o normalizador é único. O que falta é a camada de **identidade de entidade** (`merchant_aliases` / `merchant_global_knowledge` / `user_merchant_preferences`): `souk4u` ≠ `market4you` na comparação literal. Correção: resolver alias antes de comparar, sem novo catálogo. |
| E | `itemSignature` colapsa linhas idênticas do extrato | **Confirmado** | `assistant-ingest-document/index.ts:1101-1108` filtra `freshItems` por `data|valor|descrição` **antes** da lógica de `repeated_legitimate` para statements. |
| F | `duplicate_suspect` pode ser confirmado | **Confirmado** | `confirm_invoice_import_atomic` seleciona itens com `status IN ('needs_review','duplicate_suspect','failed')`. |
| G | Conciliação nova não aplicada ao documento atual | **Confirmado** | Doc `a1481e01`: `source_account_id` NULL, `reconciliation_status/delta/reconciled_at` NULL. |
| H | Dois reconciliadores em paralelo | **Confirmado** | `assistant-review-actions/index.ts:173` chama `reconcile_account_statement`; linha 232 (`action='reconcile'`) ainda chama `reconcile_document_balance`. |
| I | `statement_balance_date` semanticamente errado | **Confirmado** | Doc `a1481e01`: `period_end=2026-08-10`, `statement_closing_balance=52.63`, `statement_balance_date=2026-08-09`. Há movimentos em 10/08. Corte em 09/08 produz o −199,48. |
| J | Estornos sem vínculo econômico | **Confirmado** | `refund_of_transaction_id` NULL em todos: EST 57,94 / 49,37 / 31,93 (`movement_kind='refund'`, categoria "Estornos") e **Estorno iFood 21,10 com `type='income'`, `movement_kind='transaction'`** — entra como receita. |
| K | Pagamentos de fatura como consumo | **Confirmado** | 210,00 (03/08), 90,00 (04/08) e o de 185,00: `movement_kind='transaction'`, categoria "Fatura Cartão", `settles_card_id` NULL. |
| L | "Livre após compromissos" mistura renda futura | **Confirmado (rótulo, não matemática)** | `HeroDisponivelCard.tsx:66` e `AvailableBalanceDetails.tsx:45` mostram "Livre após compromissos conhecidos" sem sinalizar que inclui renda estimada. `availableToday` já é caixa puro. |

**Contrapontos que o plano assume explicitamente**

1. **Autopass é o item mais arriscado.** Existem 10+ lançamentos manuais de 5,40 em datas distintas (01,01,02,03,03,04,04,05,05,06...). O pedido diz "manter exatamente DUAS cobranças reais de 5,40 no extrato". Isso só se resolve por **casamento com as linhas do documento**, não por regra global de valor: cada 5,40 manual só é superseded quando existir uma linha bancária correspondente que o absorva. O que sobrar sem linha bancária permanece e é reportado — nunca deletado, nunca inventado.
2. **O bug E significa que o documento no banco pode estar incompleto** (segundo Autopass colapsado, e as linhas de 01–02/08 e 08–09/08 ausentes). Sem essas linhas não há evidência documental para os itens "faltantes" (Uber 45,94, 99 28,75, rendimento 0,01). Nesses casos o plano **não cria lançamento**: o release corrige o parser e pede **reupload do mesmo extrato**, que passa a ser idempotente e a completar o período. O fechamento em 52,63 só é declarado após esse reupload.
3. **O snapshot 589,39 pode estar contaminado** (autorizações postadas em 03/08). Ele será reclassificado como posição inferida (`superseded`), não apagado. A âncora dura passa a ser 31/07 = 923,85, derivada do extrato com proveniência.

## 2. Arquitetura final — uma única verdade

```text
documento (statement) ──▶ extrato parseado
   linhas preservadas com ordinal (source_line_index) e multiplicidade
        │
        ├── entity resolution única (merchant alias) ──▶ dedupe + categorização
        │
        ├── match com transação econômica existente
        │        ├── casou  ▶ ATTACH: posted_at + posted_at_source='statement'
        │        │             + source_document_id/source_line_index  (0 novos movimentos)
        │        └── não casou ▶ nova transação (posted_at_source='statement')
        │
        └── closing balance (as_of validado) ──▶ reconcile_account_statement (ÚNICA)
                     │ delta = 0 ▶ snapshot bank_confirmed com provenance
                     └ delta ≠ 0 ▶ pending_review (falha fechada, sem ajuste)

ledger ──▶ facts.ts: âncora = APENAS snapshot bank_confirmed com provenance
                       cash date = posted_at só quando source='statement'
```

Regras invioláveis do contrato `bank_cash_truth.v1`:

- **Âncora dura** = snapshot com `anchor_kind='bank_confirmed'`, `source_document_id` não nulo e `reconciliation_delta=0`. Posição inferida nunca ancora.
- **Data econômica ≠ data de caixa.** `posted_at_source='inferred'` não define caixa; usa a data econômica até o extrato postar.
- **Estorno**: preserva caixa (+), abate economicamente a categoria/meta da compra original via `refund_of_transaction_id`; nunca é renda.
- **Pagamento de fatura**: `movement_kind='card_payment'`, debita caixa, não conta como consumo.
- **Idempotência**: chave documento + linha ordinal + fingerprint. Reupload não gera movimento.
- **Falha fechada**: inconsistência bloqueia confirmação em vez de gerar ajuste.

## 3. Mudanças exatas

### Migrations (uma por bloco lógico, mesmo release)
1. `bank_anchor_contract` — `account_balance_snapshots`: `anchor_kind` (`bank_confirmed|inferred_position`), `as_of`, `provenance jsonb`, `reconciliation_delta`; backfill dos existentes como `inferred_position` quando `source_document_id` for NULL; índice parcial da âncora válida.
2. `statement_balance_semantics` — `document_imports`: `balance_source` (`header_current|day_line|computed`), `balance_as_of`, `balance_as_of_confidence`; trigger-guard que rejeita `balance_as_of` anterior a movimentos que compõem o mesmo closing balance.
3. `statement_line_identity` — `extracted_items`: `source_line_index` obrigatório para statements, `line_fingerprint` único por (documento, ordinal); permite gêmeos legítimos.
4. `duplicate_resolution` — `extracted_items.duplicate_resolution` (`keep_as_legitimate|link_to_existing|supersede`) + `resolved_by/at`; `confirm_invoice_import_atomic` passa a **excluir** `duplicate_suspect` sem resolução; trilha em `document_item_rejections`/`ledger_corrections`.
5. `reconciliation_single_truth` — `reconcile_document_balance` reescrita como wrapper que delega 100% a `reconcile_account_statement`; `reconcile_account_statement` corta pelo `balance_as_of` validado (não por `statement_balance_date` cru) e emite snapshot `bank_confirmed` só com delta 0.
6. `attach_statement_posting` — RPC `attach_bank_posting(p_transaction_id, p_document_id, p_line_index)`: atualiza `posted_at`, `posted_at_source='statement'`, proveniência; **não cria movimento**; idempotente.
7. `card_payment_semantics` — RPC `reclassify_as_card_payment(p_transaction_id, p_card_id)` com auditoria; guard para futuras categorias "Fatura Cartão" com `movement_kind='transaction'`.
8. `refund_backfill_deterministic` — extensão de `link_document_refunds` para casos manuais/históricos; corrige o iFood 21,10 para `movement_kind='refund'` com vínculo; ambíguos ficam `needs_review`.
9. `data_sanitation_20260810` — saneamento item a item (seção 4), tudo via `apply_ledger_correction`/`superseded`, idempotente por chave de correção.

### Edge Functions
- `assistant-ingest-document` — remover o colapso por `itemSignature` para `document_kind='statement'`; persistir ordinal/multiplicidade; derivar `balance_source`/`balance_as_of`; resolver alias de comerciante antes do dedupe; propor **attach** em vez de nova transação.
- `assistant-review-actions` — `action='reconcile'` delega ao contrato único; exigir resolução explícita de `duplicate_suspect`; expor attach na conferência.
- `finance-backfill-runner` / `finance-bridges-backfill` — rematerializar facts/bridges/snapshots derivados após o saneamento.

### Shared modules
- `_shared/import/dedupe.ts` — comparar por entidade resolvida (alias), não string literal; manter "uma transação absorve um item".
- `_shared/categorization/normalize.ts` + `merchant_aliases` — expor `resolveMerchantEntity` reutilizado por dedupe e categorização (sem catálogo novo).
- `src/lib/engine/facts.ts` — `computeAccountBalances`: aceitar só âncora `bank_confirmed`; `cashDateOf` ignora `posted_at` com `source='inferred'`; `card_payment` fora de consumo; estorno abate categoria original (já iniciado em `buildRefundAttribution`).
- `src/lib/engine/metrics.ts` — metas/comportamento com refund líquido e sem `card_payment`.
- `supabase/functions/_shared/finance-core/*` — regerar via `scripts/sync-finance-core.mjs` (espelho obrigatório).

### UI (mínimo necessário)
- `ReviewSheet.tsx` — seleção de conta obrigatória no statement, resolução explícita de duplicidade, ação "é a mesma compra já registrada" (attach).
- `HeroDisponivelCard.tsx` / `AvailableBalanceDetails.tsx` — renomear para "Projeção até o fim do mês" com composição explícita (inclui R$ 7.800 estimados); `Disponível hoje` permanece caixa puro.

### Testes (gates A–X)
`src/test/bank-cash-truth-close.test.ts` (fixture 11/07–10/08 → 52,63 e fechamento por dia A–H), `statement-line-multiplicity.test.ts` (I, J, M), `statement-attach-dedupe.test.ts` (K, L, D), `duplicate-resolution.test.ts` (N), `refund-economics.test.ts` (O, P, Q), `card-payment.test.ts` (R), `reconciliation-single-truth.test.ts` (S, T), mais suíte financeira existente (X).

## 4. Saneamento — item a item, idempotente, sem delete

Todo passo grava `ledger_corrections` com chave determinística (reexecução não duplica) e usa `superseded`, nunca `DELETE`, nunca lançamento de ajuste.

1. **03/08 duplicidades (99 66,00 / 34,55 / 33,00 e compra 100,00)** — o par existe: cópia de `origin=import, source_document_id=11b6dcde, posted_at_source=inferred` vs. cópia de `6e768b47, posted_at_source=statement`. Regra: **mantém a de proveniência bancária**, superseda a inferida, com `superseded_by` apontando para a mantida. Excedente removido do caixa: R$ 233,55.
2. **Linhas bancárias faltantes (Uber 45,94 + estorno, 99 28,75 + estorno, Uber 15,95, rendimento 0,01)** — buscar em `extracted_items` dos documentos existentes; se houver item `ignored/duplicate_suspect/needs_review` correspondente, reativar e confirmar pelo fluxo canônico. Se não houver evidência documental, **não criar**: bloqueia o gate e exige reupload do extrato (o parser corrigido passa a trazer as linhas). Efeito líquido esperado: −15,94.
3. **05/08 Resgate CDB** — 659,00 (`type=income, movement_kind=transaction`, manual) é superseded; entra a linha bancária de 500,67 com `movement_kind='investment_redemption'`, preferencialmente reativando o `extracted_item` da linha do extrato. Ajuste de caixa: −158,33.
4. **08–10/08 (Souk4u/Market4You 24,47 e 8,59; OXXO 19,58; Autopass 5,40)** — para cada linha bancária, `attach_bank_posting` na transação econômica existente (resolvida por alias) em vez de nova transação; a cópia importada redundante é superseded. Autopass: mantidas exatamente as ocorrências que casarem com linhas bancárias reais; as manuais sem linha correspondente ficam listadas em relatório de pendência para decisão, não são apagadas. Efeito: −58,04 de duplicidade econômica.
5. **Refunds** — vincular EST 57,94 / 49,37 / 31,93 e Uber 12,95 às compras originais por identidade econômica (valor + comerciante + janela); corrigir iFood 21,10 para `refund`. Caixa inalterado; categorias corrigidas.
6. **Pagamentos de fatura 210 / 90 / 185** — `reclassify_as_card_payment`, `settles_card_id` quando identificável; saem do consumo (R$ 485), permanecem no caixa.
7. **Conciliação final** — vincular `a1481e01` à conta Itaú `6c1cf814…`, corrigir `balance_as_of` para 10/08 com `balance_source='header_current'`, rodar `reconcile_account_statement`; snapshot `bank_confirmed` 52,63 com proveniência. Snapshot 589,39 → `inferred_position`/`superseded`; criar âncora 31/07 = 923,85 a partir do extrato correspondente.
8. **Rematerialização** — recomputar `financial_daily_facts`, `financial_current_snapshots`, bridges, `behavioral_*` e caches Nino do período 01/07–10/08.

**Rollback:** cada correção guarda o estado anterior em `ledger_corrections`; RPC inversa restaura `confirmed` e desfaz attach/reclassificação por chave de correção. Nenhum dado é destruído, então o rollback é sempre completo.

## 5. Prevenção de regressão
- Statement nunca colapsa gêmeos; identidade = documento + ordinal.
- Reupload é idempotente por `line_fingerprint`; gate J roda em CI.
- Attach é o caminho padrão quando existe transação econômica compatível.
- Confirmação de statement falha fechada sem conta, sem `balance_as_of` válido ou com `duplicate_suspect` não resolvido.
- Âncora só de snapshot reconciliado; nada de âncora sem proveniência.

## 6. Ordem de deploy (um release)
1. Migrations 1→9 na ordem (contratos antes do saneamento).
2. Regenerar finance-core espelhado; atualizar `facts.ts`/`metrics.ts`.
3. Deploy `assistant-ingest-document`, `assistant-review-actions`, `finance-backfill-runner`, `finance-bridges-backfill`.
4. UI (ReviewSheet + rótulos da Home).
5. Suíte completa + typecheck + build.
6. Reupload do extrato Itaú 11/07–10/08 pelo fluxo novo.
7. Saneamento (migration 9) + reconciliação + snapshot.
8. Rematerialização dos derivados e verificação dos gates.

## 7. Go / no-go
- **Go:** closing 52,63 = ledger = snapshot `bank_confirmed` = `Disponível hoje`; fechamentos diários A–H exatos; gates I–X verdes; zero lançamento de ajuste; zero delete; `ledger_corrections` explica 100% do delta de 451,78.
- **No-go:** qualquer delta residual ≠ 0, qualquer item confirmado sem transação, `duplicate_suspect` confirmável, dois reconciliadores ativos, ou necessidade de inventar lançamento sem evidência documental (nesse caso o release para e pede o extrato faltante).

## 8. Riscos
- Linhas de 01–02/08 e 08–09/08 podem não existir no documento: sem reupload, o fechamento fica bloqueado por desenho.
- Autopass tem alta chance de ambiguidade legítima; parte pode exigir decisão sua na tela de conferência.
- Mudar a regra de âncora altera saldos históricos exibidos (esperado: passam a refletir extrato, não posição inferida).
