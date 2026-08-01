## 1. Diagnóstico confirmado (validado no código e no banco conectado)

Evidências obtidas agora no banco real:

| Consulta | Resultado |
|---|---|
| `credit_card_statements` (única fatura) | competência 2026-08: stated 4.636,08 · reconciled 4.636,08 · paid 4.636,08 · **outstanding 0,00** · status `paid` |
| compras cartão 01–31/07 por `occurred_at` | **2.593,49** |
| transações cartão com `competence_date` em ago/2026 | **5.691,17** (diferença 1.055,09 vs fatura oficial) |
| `credit_card_installments` | 71 `paid` (11.139,03) · 23 `scheduled` (**2.788,49**), sendo **2 scheduled com competência ≤ ago/2026** (já absorvidas por fatura paga) |
| 31/07 | 10 despesas = 226,98 · refunds (`income`/`refund`) = 274,81 · pagamento de fatura 4.636,08 (corretamente fora) → líquido **−47,83** |
| `financial_daily_facts`, `financial_current_snapshots`, `financial_daily_category_facts`, `financial_metric_diffs`, `reconciliation_issues`, `recurring_entries/occurrences/rules`, `import_batches/rows`, `debt_payments`, `credit_card_payment_reversals` | **0 linhas** |
| `credit_card_purchases` 44 · `credit_card_statement_items` 42 · `credit_card_payments` 1 | modelo novo ativo apenas parcialmente |

| # | Problema | Causa raiz (arquivo/função) | Sev |
|---|---|---|---|
| D1 | Home rotula “Cartão” como se fosse fatura/dívida | `dailyAverage.ts:computeCardSpending` soma compras por `occurred_at`; `RitmoCard` exibe sem escopo semântico | P0 |
| D2 | Cartões mistura 3 fontes; “Próxima” reconstrói fatura por `transactions` mesmo com statement oficial | `Cartoes.tsx` `stats` useMemo: `outstanding_amount` + `competence_date` + installments, sem precedência | P0 |
| D3 | Dívida de cartão do patrimônio vem do modelo legado | `facts.ts:computeCreditCardOutstanding` (“estimativa v1”) consumido em `metrics.ts:430` `computeNetWorth` → patrimônio, disponível, projeção, Nino | P0 |
| D4 | Dia com refund > gasto aparece como R$ 0,00 | `spendingRhythm.ts:197` agrega refund no mesmo `byDay` e `:253` aplica `Math.max(0, …)` | P0 |
| D5 | Série não reconcilia com o total | `total` (`:200`) inclui refunds negativos; série clampada → soma da série ≠ total; comentário de `RitmoGastosCard` é falso | P1 |
| D6 | Ritmo típico inexplicável | exclusões por substring (`FIXED_CATEGORY_PATTERNS`), todo parcelado excluído, outliers Tukey; sem detalhamento na UI | P1 |
| D7 | Relatórios recalcula localmente | `Relatorios.tsx:24,62` chama `computeRhythm` + `aggregations.ts` (que também faz `Math.max(0, …)` em `:68,82`) | P1 |
| D8 | Duplicação frontend/backend divergente | `src/lib/engine/facts.ts` 636 linhas vs `_shared/engine/facts.ts` 281; `metrics.ts` 487 vs 394; **backend não tem `spendingRhythm` algum** (Nino usa `analytics/dailyAverage` + `timeseries`, fórmula diferente); `ledger/canonical.ts` é cópia byte-idêntica | P0 |
| D9 | Modelos concorrentes de cartão sem ownership | `transactions` × `credit_card_purchases/installments/statement_items/statements/payments`; risco de dupla contagem (evidência: 5.691,17 vs 4.636,08) | P0 |
| D10 | Estruturas vazias criando caminhos alternativos | tabelas de facts/snapshots/imports/recurring com 0 linhas, porém referenciadas em código e docs | P2 |
| D11 | Contratos de erro heterogêneos em Edge Functions/RPCs | sem `request_id`/`error_code`/`retryable` unificados | P1 |
| D12 | Parcelas futuras contam itens já cobertos por fatura paga | `Cartoes.tsx` filtra só `paid/refunded/cancelled`; 2 `scheduled` ≤ ago/2026 permanecem | P1 |

## 2. Arquitetura-alvo

**Fonte de verdade por conceito**
- Compra no cartão: `credit_card_purchases` (+`credit_card_installments` para o cronograma); `transactions` = projeção comportamental/UX.
- Obrigação da fatura: `credit_card_statements` (+`statement_items`). Sempre precede `transactions`.
- Pagamento: `credit_card_payments` + `payment_allocations` + `payment_reversals`.
- Consumo comportamental diário: `transactions` via `behavioralMetricAmount`.

**Precedência de cartão (`CardExposure` canônico)**
1. statement oficial da competência → `official`;
2. sem statement → reconstrução por `competence_date` → `estimated` (rótulo obrigatório na UI);
3. installments só para competências > última fatura fechada/paga e sem statement;
4. statement `paid`/`settled` zera outstanding em todas as superfícies.

**Cinco métricas de cartão distintas e nomeadas**: `cardSpendInPeriod`, `currentStatementOutstanding`, `nextStatementEstimate|Official`, `futureInstallments`, `totalCardDebt`.

**Modelo diário do ritmo**: `grossExpense`, `refunds`, `netConsumption`, `typicalExpense` — sem clamp; invariantes `Σgross = totalGross`, `Σrefunds = totalRefunds`, `Σnet = gross − refunds`.

**Onde o cálculo vive**: um único pacote TypeScript `supabase/functions/_shared/finance-core/` (fonte) espelhado para o frontend por *script de sync verificado em teste* (falha o CI se divergir). RPCs SQL permanecem só para escrita/conciliação. `formula_version` retornada em todo payload.

## 3. Implementação em etapas (pequenas, reversíveis)

**E1 — Contratos e testes vermelhos**: definir tipos `CardExposure`, `DailyRhythmPoint`, `FinancialSnapshotV2` + testes de invariante e fixtures com os dados reais acima (fatura 4.636,08 paga, 31/07 refund maior). Sem mudança de comportamento.

**E2 — Ritmo bruto/líquido (D4,D5)**: reescrever `computeRhythm` para o modelo de 4 séries, remover clamps; `RitmoGastosCard` passa a plotar gasto bruto + série/tooltip de refund + líquido no resumo.

**E3 — Exposição de cartão canônica (D1,D2,D3,D12)**: nova `computeCardExposure(statements, installments, payments, txs)`; `computeNetWorth` passa a usar `totalCardDebt` canônico com `computeCreditCardOutstanding` apenas como fallback marcado; `RitmoCard` renomeia para “Gasto no cartão no período (dd/mm–dd/mm)”; `Cartoes.tsx` mostra os 5 números com badge `oficial`/`estimativa`.

**E4 — Ritmo típico explicável (D6)**: exclusões declarativas (`category_kind` estrutural configurável em vez de substring), parcelado deixa de ser exclusão automática (só quando `installments_total > 1` **e** origem recorrente), lista “o que ficou de fora e por quê” na UI.

**E5 — Fonte única (D7,D8)**: `finance-core` + script de paridade; `Relatorios.tsx` passa a consumir `useFinancialSnapshot` (agregações só formatam); remover `spendingRhythm` duplicado do caminho do Nino/WhatsApp fazendo `analytics/*` chamar o core.

**E6 — Integridade de dados (D9)**: migration de detecção (view `v_card_double_counting`) + backfill que marca installments absorvidas por statement pago; sem apagar dados. Idempotência por `idempotency_key`.

**E7 — Contrato de erro (D11)**: helper `respond()`/`fail()` compartilhado com `request_id`, `error_code`, `retryable`, incidente persistido; proibir `ok:true` em falha financeira.

**E8 — Classificação de estruturas (D10)**: documento `docs/FINANCIAL_SOURCES.md` classificando cada tabela como ativa/planejada/legada/experimental/substituída.

Flags: `finance_core_v2` (métricas), `card_exposure_v2`, `rhythm_gross_v2`. Rollout: dev → founder → geral. Rollback: desligar flag (E2–E5 são só leitura).

## 4. Arquivos por etapa

- E2: `src/lib/engine/spendingRhythm.ts`, `src/components/home/RitmoGastosCard.tsx`, `src/lib/reports/aggregations.ts` (remover clamps 68/69/82).
- E3: `src/lib/engine/facts.ts`, `metrics.ts`, `dailyAverage.ts`, `src/components/home/RitmoCard.tsx`, `src/pages/Cartoes.tsx`, `src/lib/db/creditCards.ts`.
- E5: novo `supabase/functions/_shared/finance-core/*`; `src/lib/engine/*` vira re-export; `src/pages/Relatorios.tsx`; `_shared/analytics/{dailyAverage,timeseries,compare,forecast}.ts`; deletar cópia `src/lib/ledger/canonical.ts` (re-export do core).
- E7: `supabase/functions/_shared/http.ts` + agent-chat, whatsapp-webhook, assistant-ingest-document, assistant-review-actions, insights-generate, pulse-compute, mcp, finance-backfill-runner.
- Eliminar: `computeCardSpending` como “dívida”, `computeCreditCardOutstandingByCard` legado na UI, `computeDailyAverageComparison` (mês anterior de tamanho diferente).

## 5. Testes obrigatórios

Unitários (fixtures reais): compra no cartão; refund > gasto no dia (31/07 → bruto 226,98 / refund 274,81 / líquido −47,83); invariantes de série; fatura paga → outstanding 0; parcial; próxima fatura com e sem statement; installments absorvidas; antecipação; duplicidade de importação; patrimônio; disponível hoje; projeção fim de mês.
Paridade: `finance-core` frontend × backend byte/resultado idêntico; Home × Relatórios × Nino × WhatsApp para o mesmo período.
SQL: outstanding = stated − paid; sem dupla contagem; idempotência de pagamento/reversão.
E2E (Playwright): Home → Cartões → Relatórios → pergunta ao Nino por categoria e por fornecedor com os mesmos totais.

## 6. Critérios de aceite

- Fatura paga ⇒ outstanding 0,00 na Home, Cartões, Relatórios, Nino e WhatsApp.
- “Gasto no cartão no período” continua 2.593,49 em julho após o pagamento, nunca rotulado como dívida.
- Dia 31/07: bruto 226,98 · refund 274,81 · líquido −47,83; nenhum dia com despesa real exibido como zero.
- Σséries = totais (bruto, refund, líquido); último ponto acumulado fecha com o topo do card.
- Toda estimativa carrega rótulo; nenhum pagamento de fatura entra como consumo.
- Mesmos totais nas 4 superfícies para mesmo usuário/período/`formula_version`.

## 7. Matriz antes/depois (resumo)

| Atual | Fórmula atual | Problema | Novo | Nova fórmula / fonte |
|---|---|---|---|---|
| “Cartão” (Home) | Σ compras por `occurred_at` | lido como dívida | “Gasto no cartão no período” | igual, com período explícito · `transactions` |
| “Em aberto na fatura” | `outstanding_amount` do mês | ok, mas coexiste com fallback | `currentStatementOutstanding` | `credit_card_statements` |
| “Próxima” | Σ `competence_date` | ignora statement oficial | `nextStatement (oficial/estimativa)` | statement → fallback txs |
| “Parcelas futuras” | Σ installments não pagas | inclui absorvidas | `futureInstallments` | installments com competência futura |
| `cardsOwed` (patrimônio) | reconstrução legada | dívida fantasma | `totalCardDebt` | statements abertos + parcelas futuras |
| “Gasto do dia” | líquido clampado | apaga gasto real | `grossExpense` + `refunds` + `netConsumption` | `transactions` |
| “Ritmo típico” | exclusões por substring | inexplicável | `typicalExpense` com exclusões declaradas | `transactions` + regras configuráveis |

## 8. Riscos e decisões que precisam da sua aprovação

1. **Parcelamento entra ou não no ritmo típico?** (hoje sempre excluído — recomendo incluir, pois é consumo real).
2. **Fonte única espelhada por script** vs mover o cálculo para RPC/SQL — recomendo espelhamento TS com teste de paridade (menor risco, mantém MCP e WhatsApp).
3. **`totalCardDebt` inclui parcelas futuras?** Recomendo separar: dívida = faturas abertas; parcelas futuras como compromisso.
4. Renomear rótulos muda a leitura do usuário — precisa do seu ok no texto final.
5. Cartão sem statement importado: exibir estimativa rotulada ou “—”?
6. Não haverá exclusão de tabelas nesta rodada (só classificação) — confirmar.

## 8. Status de implantação (2026-08-01)

- **E1 concluída** — contratos (`CardExposure`, `DailyPoint`/ritmo de 4 séries, `FinancialSnapshot` com exposição de cartão) e testes de invariante com fixtures reais (`src/test/financial-truth-rhythm-cards.test.ts`).
- **E2 concluída** — `spending_rhythm.v3` sem clamps, bruto/estorno/líquido/típico.
- **E3 concluída** — `cardExposure.v1` com precedência oficial > estimativa > parcelas; patrimônio e página Cartões usam a mesma dívida; rótulo “Compras no cartão · período” (não é dívida).
- **E4 concluída** — exclusões declarativas (`categoryKindById`/`structuralCategoryIds`, nome só como fallback); parcelamento deixa de ser exclusão automática (só parcela de compromisso recorrente); `excludedByReason` explicado na UI.
- **E5 concluída** — pacote canônico `supabase/functions/_shared/finance-core/` gerado por `scripts/sync-finance-core.mjs` e verificado em `src/test/finance-core-parity.test.ts`; `analytics/dailyAverage` (Nino/WhatsApp) passou a chamar o core (`daily_average.cumulative.v2-core`); Relatórios consome o ritmo do `useFinancialSnapshot`.
- **E6 concluída** — migration com `credit_card_installments.absorbed_by_statement_id/absorbed_at`, backfill idempotente e view `v_card_double_counting`; o motor ignora parcelas absorvidas.
- Pendentes: E7 (contrato de erro) e E8 (classificação de estruturas). Publicação do frontend aguarda autorização explícita.
