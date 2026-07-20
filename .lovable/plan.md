## Contexto

Grande parte do escopo já foi entregue no turno anterior:
- `computeAccountStatementTotals` / `isGrossAccountMovement` / `isGrossCardMovement` em `src/lib/engine/facts.ts` **e** `supabase/functions/_shared/engine/facts.ts`.
- `src/pages/Index.tsx` e `supabase/functions/insights-generate/index.ts` já consomem os totais brutos.
- Reclassificação do "APLICACAO CDB DI" de 03/07 para `investment_application` (dado corrigido).
- Endurecimento de `normalizeMovementKind` no importador (regex APLICACAO/RESGATE/ESTORNO).
- Teste `src/test/facts-statement-totals.test.ts` fecha em 11.193,82 / 14.893,54 / 271,88 / -3.971,60 (309/309 verdes).
- Validação no banco: `account_in = 11.193,82`, `account_out = 14.893,54`.

Restam três lacunas objetivas frente ao pedido:

1. **Pagamento de fatura não entra em "Saiu da conta".** `isGrossAccountMovement` ainda descarta linhas com `settles_card_id`. O requisito 3 pede o oposto: quando há débito bancário real (pagamento de fatura), ele conta em `accountOut`. Compras no cartão continuam só em `cardOut` — sem risco de dupla contagem, porque a compra em si nunca teve `account_id`.
2. **Copy do card ainda diz "foi para a fatura do cartão".** O requisito 4 pede "+ R$ X em compras no cartão" (o texto atual sugere que já saiu da conta, o que é falso).
3. **`useAllTransactions` está sujeito ao teto silencioso do PostgREST (1000 linhas).** Precisa paginar para KPIs não perderem lançamentos em contas movimentadas.

Extras pedidos que ainda cabem: mais casos de teste (planned/cancelled, transferência interna multi-conta, paginação) e verificar que `insights-generate` também considera pagamento de fatura como saída bruta.

## Mudanças

### Engine (cliente + servidor, espelhados)
- `src/lib/engine/facts.ts` e `supabase/functions/_shared/engine/facts.ts`:
  - `isGrossAccountMovement`: **remover** o filtro `if (t.settles_card_id) return false;` — pagamento de fatura passa a compor `accountOut`.
  - Continuar excluindo `type === "transfer"`, `status !== "confirmed"`, `movement_kind === "internal_transfer"` (salvo com `scopeAccountId`).
  - `isGrossCardMovement` fica intacto (só compras no cartão).
  - Adicionar guarda para `status` fora de `confirmed` (planned/cancelled/deleted) — hoje só cobre `!== "confirmed"`, o que já basta, mas documentar em comentário para não regredir.

### UI (Home)
- `src/pages/Index.tsx`:
  - Trocar o subtítulo do card "Saiu da conta" de `"foi para a fatura do cartão"` para `"+ R$ X em compras no cartão"`.
  - Manter os rótulos "Entrou este mês / nos últimos N dias" e "Saiu da conta este mês / nos últimos N dias".

### Paginação de transações
- `src/lib/db/finance.ts` (`useTransactions`): trocar o `select` único por loop em páginas de 1000 (`.range(from, from+999)`), até `data.length < 1000`. Comentar que é obrigatório para KPIs brutos.
- Sem mudança de assinatura: continua devolvendo `TransactionRow[]` completo.

### Insights (servidor)
- `supabase/functions/insights-generate/index.ts`: já usa `computeAccountStatementTotals`. Após a mudança de `isGrossAccountMovement`, o cálculo passa a considerar pagamento de fatura automaticamente. Sem alteração adicional de código; apenas re-deploy.

### Testes
Adicionar em `src/test/facts-statement-totals.test.ts` (mesmo arquivo, mais casos):
- `status: "planned"` e `status: "cancelled"` são ignorados.
- Transferência interna entre 2 contas próprias com `scopeAccountId` em cada uma delas (uma vira `accountOut`, outra vira `accountIn`), e no consolidado sem escopo se cancela.
- Pagamento de fatura (`settles_card_id` preenchido) entra em `accountOut` e **não** duplica em `cardOut`.
- Refund em cartão (crédito na fatura) não entra em `accountIn` (permanece fora do fluxo bancário).
- Manter o teste-contrato de julho/2026 (11.193,82 / 14.893,54 / 271,88 / -3.971,60).

Testes existentes de `facts.test.ts` (comportamentais, base `computeMonthlyIncomeExpense`/`computeMonthlyTotals`) permanecem intactos — são a métrica comportamental separada mencionada no requisito 6.

### Migration
Nenhuma migration nova. O reparo do CDB já foi aplicado no turno anterior. Snapshots de conta (R$ 139,95) e fatura (R$ 271,88) não são tocados.

### Deploy
- Deploy da Edge Function `insights-generate` após as mudanças na engine servidor.
- Publicação do frontend.

## Validação

1. `bunx vitest run` — esperado 313/313 verdes (309 atuais + 4 novos casos).
2. Query no banco para julho/2026 do usuário `danielmariano93@gmail.com` confirmando 11.193,82 / 14.893,54 / 271,88 sem qualquer ajuste manual.
3. Snapshot atual preservado: em conta R$ 139,95, fatura R$ 271,88, patrimônio -R$ 131,93 (não depende dos KPIs).
4. Retorno final com arquivos alterados, resultado dos testes, IDs de deploy e valores observados.

## Detalhes técnicos

Equação canônica dos cards da Home e dos insights:

```text
accountIn  = Σ créditos confirmados em conta (transaction + investment_redemption + refund_em_conta)
accountOut = Σ débitos  confirmados em conta (transaction + investment_application + pagamento_de_fatura)
cardOut    = Σ compras confirmadas no cartão (sem settles_card_id)
net_extrato = accountIn - accountOut - cardOut
```

Para julho/2026: `11.193,82 - 14.893,54 - 271,88 = -3.971,60`.

Regras de exclusão comuns:
- `status !== "confirmed"` (planned, cancelled, deleted).
- `movement_kind === "internal_transfer"` no consolidado (sem `scopeAccountId`); com escopo, cada perna vira `accountIn`/`accountOut` da conta escopada.
- `type === "transfer"` só é considerado quando `scopeAccountId` está definido; a segunda perna do grupo é identificada por ordem determinística de `id`.

Métrica comportamental (`computeMonthlyTotals` / `isRealMonthlyMovement`) continua existindo para relatórios de comportamento, mas **não** aparece rotulada como "Entrou / Saiu" na Home.
