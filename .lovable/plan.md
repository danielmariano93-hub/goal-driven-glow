
## Contexto

Danielmariano93 conciliou manualmente julho/2026 e os totais bancários corretos são: saldo inicial 3.275,59 + entradas 11.840,65 − saídas 14.976,29 = 139,95. O que já está entregue (Home bruta, `computeAccountStatementTotals`, reclassificação pontual do CDB de 03/07, `reconcile_document_balance`) fica preservado. Este plano corrige as cinco raízes ainda abertas em uma única rodada.

## Objetivos

1. OCR/normalização nunca classifica “-EST” / ELECTRON …EST como despesa.
2. Deduplicação passa a preservar ocorrências legítimas repetidas.
3. Aplicação/resgate de CDB movimenta `investments` de forma transacional e idempotente.
4. Aprovação de importação bloqueia se `saldo_inicial + entradas − saídas ≠ saldo_final`.
5. Home separa fluxo bancário bruto, comportamento e patrimônio, e mostra a ponte.

Todos os valores citados (3.275,59 / 11.840,65 / 14.976,29 / 139,95 / CDB 2.498,38) são apenas alvo de teste — nenhum é hardcoded na lógica.

## Mudanças de código

### 1. Estornos e classificador (arquivo: `supabase/functions/_shared/documents/normalize.ts` e `types.ts`)

- Em `normalize.ts`, novo helper `classifyBankLine(raw, amountSign)` que retorna `{ type, movement_kind }` a partir de:
  - Sufixo/prefixo `EST`, `ESTORNO`, `DEVOLUCAO`, `-EST`, `REVERSAL`, `CHARGEBACK` → `refund` (income se cartão devolveu; expense se estorno de crédito indevido) usando o sinal do valor.
  - `APLICACAO`/`APLICA(Ç|C)AO` → `investment_application` (expense).
  - `RESGATE`/`REDEMPTION` → `investment_redemption` (income).
  - `TRANSFERENCIA ENTRE CONTAS`, `TED PROPRIA`, `PIX PROPRIO` → `internal_transfer`.
- Em `types.ts` `normalizeMovementKind` chama `classifyBankLine` antes das heurísticas legadas para override determinístico, e `sanitize` respeita o `type` retornado (não confia mais no `type` bruto do LLM quando a linha é reconhecidamente estorno).
- Regra: OCR pode dizer “expense R$164,28 ELECTRON …EST” — o pipeline reclassifica para `income + refund` antes de calcular fingerprint, gravar em `extracted_items` e casar com histórico.

### 2. Deduplicação por ocorrência (arquivo: `supabase/functions/_shared/documents/normalize.ts` + `assistant-ingest-document/index.ts`)

- `computeFingerprint` passa a incluir `occurrence_ordinal` além dos campos atuais. Ordinal = índice sequencial (1-based) da combinação `(user_id, occurred_at, amount, type, normalized_description, account_id|credit_card_id)` **dentro do mesmo documento**. Duas cobranças Uber idênticas no mesmo dia recebem ordinais 1 e 2 → fingerprints distintos.
- Nova coluna `extracted_items.occurrence_ordinal int NOT NULL DEFAULT 1` (migration abaixo). Coluna espelhada em `transactions.occurrence_ordinal` para permitir dedupe entre documento e histórico.
- Dedupe forte contra `transactions` só dispara quando **fingerprint completo** bate (que inclui `bank_reference` quando existir e o ordinal quando não existir). `bank_reference` continua sendo a chave preferencial: quando o extrato traz `Nº doc`/`E2E`, ele vence e o ordinal é ignorado.
- Reimportação do mesmo PDF: a chave `(user_id, sha256_documento)` já existe em `document_imports`; adicionamos índice único `(user_id, storage_path)` como redundância. Como o ordinal é reproduzível, a segunda passada gera os mesmos fingerprints → 100% marcados como `duplicate_suspect`.

### 3. Vínculo transação ↔ investimento (nova tabela e RPC)

Modelo explícito, sem heurística por descrição:

- Nova tabela `public.investment_movements`:
  - `id, user_id, investment_id, transaction_id, kind ('application'|'redemption'|'yield'|'fee'|'loss'), amount numeric(14,2), occurred_at date, source ('document'|'manual'|'agent'), source_document_id uuid, created_at, updated_at`.
  - Unique `(transaction_id)` — 1 transação bancária ↔ no máximo 1 movimento de investimento.
  - Unique `(user_id, investment_id, occurred_at, kind, amount, transaction_id)` para idempotência.
  - Grants + RLS por `user_id`.
- Função `public.apply_investment_movement(p_movement_id)` mantém a coerência: `UPDATE investments SET invested_amount = invested_amount + delta, current_value = current_value + delta, reference_date = greatest(...)` onde delta = `+amount` (aplicação), `-amount` (resgate), `+amount` (rendimento). Executada por trigger `AFTER INSERT` na tabela.
- `confirm_document_import` (edição da função existente) passa a, dentro da mesma transação:
  1. Criar transações bancárias como hoje.
  2. Para itens com `movement_kind IN ('investment_application','investment_redemption')`, inserir `investment_movements` referenciando a transação recém-criada. Se `extracted_items.investment_id` estiver nulo, resolve por (nome do CDB no `account_hint`/`description` × `institution` da conta). Se ambíguo, o item é enviado para `needs_review` com `reason='investment_target_missing'` — **nunca cria transação sem vincular ao investimento**.
- Nova coluna `extracted_items.investment_id uuid REFERENCES investments(id)` para o usuário resolver ambiguidade no ReviewSheet (dropdown novo só aparece quando `movement_kind` é aplicação/resgate).
- `rollback_document_import` também deleta os `investment_movements` do documento (trigger `AFTER DELETE` reverte o `invested_amount`).

Regra contábil: aplicação/resgate **não** vira renda/despesa comportamental (já respeitado por `isRealMonthlyMovement`); e o patrimônio líquido só muda quando entra um `yield`/`fee`/`loss`.

### 4. Ponte de saldo bloqueante (arquivo: `types.ts` + `assistant-ingest-document` + `confirm_document_import`)

- Novo bloco em `extractStatementMetadata` para capturar saldos diários (`daily_balances jsonb`) quando presentes. Persistido em nova coluna `document_imports.daily_balances jsonb`.
- Função `public.check_document_reconciliation(p_document_id)` calcula:
  - `delta_transacoes = Σ income − Σ expense − Σ pagamento_fatura` (itens não-informacionais e não-ignored/rejected/rolled_back).
  - `delta_saldos = statement_closing_balance − statement_opening_balance`.
  - `difference = delta_saldos − delta_transacoes`.
  - Se saldos diários existem, também computa a divergência dia-a-dia e retorna array `suspects` com as datas e linhas próximas.
  - Retorna `{ ok: |difference| < 0.005, difference, suspects, daily_diff }`.
- `confirm_document_import` chama `check_document_reconciliation` no início. Se `!ok`, retorna `{ ok:false, error:'reconciliation_pending', ... }` e **não confirma nada**. Só é possível confirmar depois de: (a) revisar/ignorar os `suspects` até fechar, ou (b) usar novo action `assistant-review-actions{action:'force-confirm', reason}` que grava `document_import_audit` com o motivo — sem “ajuste silencioso”.
- Documento com `statement_opening_balance IS NULL` ou `statement_closing_balance IS NULL` cai em `needs_review` com bandeira `reconciliation_unknown`; nunca aprova automaticamente.

### 5. UI da revisão e Home (arquivos: `src/components/assessor/ReviewSheet.tsx`, `src/pages/Assessor.tsx`, `src/components/home/PatrimonioCard.tsx`, `src/pages/Index.tsx`)

- `ReviewSheet`:
  - Banner de conciliação: mostra “Saldo inicial X + entradas Y − saídas Z = W. Extrato fecha em V. Diferença Δ.” Botão “Confirmar” desabilitado enquanto |Δ| ≥ 0,01 (ou substituído por “Confirmar com ressalva”).
  - Chip `Estorno`/`Aplicação`/`Resgate` ao lado dos itens correspondentes; edição de `movement_kind` permitida (`assistant-review-actions{action:'update', patch:{movement_kind}}`, incluído em `ALLOWED_PATCH_KEYS`).
  - Dropdown de destino de investimento (só para aplicações/resgates).
  - Lista de “Linhas suspeitas” quando `daily_diff` não bate.
- Home:
  - Novo card “Ponte de caixa (mês)”: Saldo início · Entradas · Saídas · Saldo hoje, com valores vindos de `computeAccountStatementTotals` + snapshot mais recente.
  - Cards já existentes ganham legendas explícitas “Fluxo bancário bruto” vs. “Renda/consumo (exclui transferências e investimentos)” para o usuário entender que 11.840,65 é bruto e a métrica comportamental é menor.
  - `PatrimonioCard`: `Contas + Investimentos − Faturas − Outras dívidas`, exibindo cada parcela e a data de conciliação (`cashAnchor` já existe).

### 6. Backfill seguro (dentro da migration)

- Update em `extracted_items` recomputando `movement_kind` apenas onde:
  - `user_edited_at IS NULL` **e**
  - `raw_description` casa com as regex de estorno/CDB/transferência interna.
- Update em `transactions` idem, com `user_id, description` derivada — **nunca** para linhas com `updated_at > (SELECT updated_at FROM extracted_items WHERE ...) + 5min` (mesma proteção usada em `rollback_document_import`).
- Preenche `occurrence_ordinal` por window function `ROW_NUMBER() OVER (PARTITION BY user_id, occurred_at, amount, type, normalized_description, account_id, credit_card_id ORDER BY created_at)` em documentos passados. Idempotente.
- Não altera nenhum snapshot ou valor de investimento existente; nem os números manuais atuais de Daniel.

## Arquivos alterados

- Migration nova: `supabase/migrations/20260721000000_docv3_bank_pipeline.sql`
  (colunas `extracted_items.occurrence_ordinal`, `extracted_items.investment_id`, `transactions.occurrence_ordinal`, `document_imports.daily_balances`; tabela `investment_movements` + triggers + grants + RLS; funções `apply_investment_movement`, `check_document_reconciliation`; atualização de `confirm_document_import`, `rollback_document_import`; backfill controlado).
- `supabase/functions/_shared/documents/normalize.ts` — `classifyBankLine`, ordinal no fingerprint.
- `supabase/functions/_shared/documents/types.ts` — sanitize respeita reclassificação, extrai `daily_balances`.
- `supabase/functions/assistant-ingest-document/index.ts` — atribui ordinal por lote, propaga `investment_id` sugerido, grava `daily_balances`.
- `supabase/functions/assistant-review-actions/index.ts` — `ALLOWED_PATCH_KEYS` += `movement_kind, investment_id`; novo action `force-confirm`; retorna estado de conciliação em `list`.
- `src/components/assessor/ReviewSheet.tsx` + `src/pages/Assessor.tsx` — banner de conciliação, chips, dropdown de investimento.
- `src/pages/Index.tsx` + `src/components/home/PatrimonioCard.tsx` + novo `src/components/home/PonteCaixaCard.tsx` — legendas e ponte.
- `src/lib/engine/facts.ts` e `supabase/functions/_shared/engine/facts.ts` — `computeAccountStatementTotals` passa a receber `snapshots` e devolver `bridge = { openingBalance, in, out, closingBalance }`. Regras de bruto (inclui investimentos/refunds) preservadas.
- `src/lib/db/finance.ts` — expor `useInvestmentMovements`, invalidar em confirmar/rollback.

## Testes

Novos arquivos em `src/test/`:

- `docs-estorno-refund.test.ts` — `classifyBankLine` reclassifica todas as variações de ELECTRON …EST como `refund`.
- `docs-occurrence-ordinal.test.ts` — duas linhas Uber 99 idênticas geram fingerprints distintos; reimportação do mesmo documento gera mesmos fingerprints e todos viram `duplicate_suspect`; três PIX iguais preservam 3 ocorrências.
- `docs-reconciliation.test.ts` — `check_document_reconciliation` bloqueia quando |Δ|≥0,01; libera após corrigir. Cenário exato do extrato de julho fecha em 139,95.
- `investments-movements.test.ts` — aplicação de 5.000 aumenta `invested_amount`; resgate reduz; rollback reverte; rendimento aumenta sem debitar caixa.
- `facts-bridge.test.ts` — `computeAccountStatementTotals` devolve `openingBalance + in − out === closingBalance` para o mês do Daniel usando `account_balance_snapshots`.
- `home-labels.test.tsx` — Home renderiza “Fluxo bancário bruto” e a ponte com os quatro valores.

Todos os fixtures usam os números do usuário para servir de critério de aceite.

## Critério de aceite

- 100% dos testes atuais (313) + os 6 novos verdes.
- Query no banco de produção pós-migration para julho/2026 do usuário:
  - `sum(entradas brutas) = 11.840,65`, `sum(saídas brutas) = 14.976,29`, `snapshot em 18/07 = 139,95`.
  - `investments.invested_amount` do CDB Itaú termina em `2.498,38` (5.000 − 2.501,62), com `investment_movements` correspondentes.
  - Nenhuma transação foi apagada ou reclassificada em linhas com `user_edited_at IS NOT NULL`.
- Fluxo end-to-end: reimportar o PDF de julho não cria nada; forçar reconciliação com diferença ≠ 0 é bloqueado; após ajustar, `document_imports.status = 'confirmed'`.
- Home mostra: Ponte (3.275,59 → 139,95), cards de fluxo bruto (11.840,65 / 14.976,29) com legenda, e Patrimônio com contas + investimentos − faturas.

## Deploy

Ordem única: migration → deploy `assistant-ingest-document`, `assistant-review-actions`, `insights-generate` → publicação frontend. Sem microetapas.

## Fora de escopo

- Open Finance, importação OFX de outros bancos, alterações no fluxo do WhatsApp, mudanças no agente, mudanças em Divisão do Rolê, refatoração da UI de Investimentos além do dropdown de destino.
