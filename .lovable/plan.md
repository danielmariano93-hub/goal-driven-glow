## Objetivo
Corrigir os KPIs "Entrou / Saiu / Fatura" da Home para refletirem **fluxo bancário literal** (bruto), mantendo `isRealMonthlyMovement` intocado para uso comportamental. Reclassificar 1 lançamento mal categorizado ("APLICACAO CDB DI" R$ 5.000,00 em 03/07/2026), sem reimportar documentos nem duplicar dados.

Acceptance numérico obrigatório (usuário/conta Banco Itaú, julho/2026):
- Entrou na conta = **R$ 11.193,82**
- Saiu da conta = **R$ 14.893,54**
- Fatura do cartão = **R$ 271,88**
- Resultado geral = **-R$ 3.971,60**
- Patrimônio inalterado: Em conta R$ 139,95 · Fatura R$ 271,88 · Patrimônio -R$ 131,93.

## Alterações

### 1. `src/lib/engine/facts.ts` — novas funções puras (aditivas)
Adicionar, sem tocar em `isRealMonthlyMovement` / `computeMonthlyTotals` / `computeMonthlyIncomeExpense`:

```ts
// Movimento bruto de EXTRATO da conta (fluxo literal).
// Inclui: transaction, investment_application, investment_redemption, refund.
// Exclui: type='transfer' (usa lógica de pares), planned/cancelled, settles_card_id
//         (evita dupla contagem com card), movement_kind='internal_transfer'
//         (transferência entre contas próprias no consolidado).
export function isGrossAccountMovement(t: TransactionRow, opts?: { scopeAccountId?: string }): boolean

// Movimento bruto de CARTÃO — despesas confirmadas com origem credit_card,
// exceto internal_transfer/planned. Não subtrai refund do cartão do total de conta.
export function isGrossCardMovement(t: TransactionRow): boolean

// Totaliza: { accountIn, accountOut, cardOut } em BRL arredondado.
// Refund entra em accountIn (é crédito real na conta), NUNCA abate accountOut.
// Aplicação em investimento entra em accountOut. Resgate entra em accountIn.
export function computeAccountStatementTotals(
  txs: TransactionRow[],
  range: { start: string; end: string },
  opts?: { scopeAccountId?: string }
): { accountIn: number; accountOut: number; cardOut: number; net: number }
```

Regras internas:
- `range` = intervalo ISO fechado (dd usa `occurred_at >= start && <= end`).
- Filtro base: `status === 'confirmed'`.
- Transferências (`type='transfer'`): quando `scopeAccountId` é passado, entra na perna correspondente (in/out); quando ausente (consolidado), ambas as pernas se cancelam → **ignoradas**.
- `movement_kind='internal_transfer'` no consolidado é ignorado; com `scopeAccountId`, entra normalmente.
- `settles_card_id` presente → ignora nos totais de conta (para evitar dupla contagem com fatura).
- Sem limite de linhas.

### 2. `src/pages/Index.tsx` — trocar consumidor dos KPIs
Substituir o `useMemo(periodSummary)` (linhas 54–83) para chamar `computeAccountStatementTotals(tx, { start, end })` e mapear:
- `income = accountIn`
- `expense = accountOut`
- `cardExpense = cardOut`

Manter o subtítulo do card de saída ("+ R$ X foi para a fatura do cartão"). Nenhum outro componente mexido.

### 3. `supabase/functions/_shared/engine/facts.ts` — espelhar
Adicionar exatamente as mesmas 3 funções (`isGrossAccountMovement`, `isGrossCardMovement`, `computeAccountStatementTotals`) para uso server-side (insights, agent). `isRealMonthlyMovement` fica como está — continua sendo a métrica comportamental "gastos de consumo".

### 4. `supabase/functions/insights-generate/index.ts` — usar helper correto
- Onde o insight comunica **fluxo do mês** ("entrou / saiu / resultado"), passar a usar `computeAccountStatementTotals`.
- Onde ele comunica **gastos de consumo** (ex: "esse mês tá apertado"), manter `isRealMonthlyMovement` mas rotular como "gastos de consumo" no texto (ajuste de string somente).
- Nenhum limite silencioso de 300/1000 (auditar e remover se presente).

### 5. Migration idempotente — reclassificar APLICACAO CDB DI
`supabase/migrations/<ts>_reclassify_cdb_di_application.sql`:

```sql
-- Corrige movement_kind do único registro APLICACAO CDB DI de 5.000,00
-- em 03/07/2026 para a conta Itaú (idempotente, escopo estrito).
UPDATE public.transactions
   SET movement_kind = 'investment_application'
 WHERE id = '59fb2920-a328-4f10-abbf-0cad2b9941a9'
   AND account_id = '6c1cf814-2a25-4b3d-980d-c6454ccd35e0'
   AND occurred_at = '2026-07-03'
   AND amount = 5000.00
   AND raw_description ILIKE 'APLICACAO CDB DI%'
   AND movement_kind = 'transaction';
```

Sem outros updates. RESGATE CDB DI e ESTORNO já estão corretamente marcados (verificado).

### 6. Classificador de importação — endurecer regras
`supabase/functions/_shared/documents/normalize.ts` (ou onde `movement_kind` é atribuído no `assistant-ingest-document`): garantir mapeamento determinístico por regex sobre `raw_description`:
- `/^APLICACAO\s+CDB/i` → `investment_application` (expense)
- `/^RESGATE\s+CDB/i` → `investment_redemption` (income)
- `/^(EST|ESTORNO)\b/i` → `refund`

Estas regras aplicam-se apenas a novos itens; **não** re-executam sobre `transactions` já persistidas.

## Testes

### 7. `src/test/facts-statement-totals.test.ts` (novo)
- Resgate contabiliza como `accountIn`.
- Estorno contabiliza como `accountIn` (não abate `accountOut`).
- Aplicação contabiliza como `accountOut`.
- Cartão separado em `cardOut`.
- Transferência entre contas próprias (par) no consolidado → cancela.
- Filtrando por `scopeAccountId`, a perna aparece.
- `settles_card_id` ignorado nos totais de conta.
- Contrato numérico julho/danielmariano93: fixture reduzida (ou dataset sintético) que produza exatamente `{accountIn: 11193.82, accountOut: 14893.54, cardOut: 271.88}` e `net = -3971.60`.

### 8. Testes existentes
`isRealMonthlyMovement` / `computeMonthlyTotals` inalterados — suíte atual deve continuar 100% verde.

## Ordem de implantação
1. Migration de reclassificação (isolada, reversível manualmente).
2. Novas funções em `src/lib/engine/facts.ts` + espelho no server.
3. Trocar consumidor em `Index.tsx`.
4. Atualizar `insights-generate` + rótulos.
5. Endurecer classificador de importação.
6. Testes (unitários + contrato numérico).
7. `bun test` + `bun run build` — publicar somente se 100% verde.

## Validações SQL pós-implantação
```sql
-- Deve retornar 1 linha com movement_kind='investment_application'
SELECT id, movement_kind FROM transactions
 WHERE id='59fb2920-a328-4f10-abbf-0cad2b9941a9';

-- Recomputação de sanidade (sem código):
SELECT
  SUM(amount) FILTER (WHERE type='income'  AND settles_card_id IS NULL
                       AND (movement_kind IS NULL OR movement_kind NOT IN ('internal_transfer'))
                       AND credit_card_id IS NULL) AS account_in,
  SUM(amount) FILTER (WHERE type='expense' AND settles_card_id IS NULL
                       AND (movement_kind IS NULL OR movement_kind NOT IN ('internal_transfer'))
                       AND credit_card_id IS NULL) AS account_out,
  SUM(amount) FILTER (WHERE type='expense' AND credit_card_id IS NOT NULL) AS card_out
FROM transactions
WHERE account_id='6c1cf814-2a25-4b3d-980d-c6454ccd35e0'
  AND status='confirmed'
  AND occurred_at BETWEEN '2026-07-01' AND '2026-07-31';
-- Esperado: 11193.82 | 14893.54 | 271.88 (após migration).
```

## Riscos
- Insights antigos que reciclam `isRealMonthlyMovement` para narrar "entrada/saída": mitigado renomeando rótulos e trocando cálculo onde a semântica é "extrato".
- Reclassificação afeta a saída de `computeAccountBalances`? **Não** — a função ignora `movement_kind` e opera por `type`/`origin`. Saldo conciliado permanece R$ 139,95.
- Nenhuma alteração em fatura, snapshot ou dados históricos além da 1 linha citada.
