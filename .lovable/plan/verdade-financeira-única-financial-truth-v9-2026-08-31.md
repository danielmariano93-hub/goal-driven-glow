# Verdade financeira única — Financial Truth v9

Objetivo: um só número por indicador em Home, Relatórios, Metas, Nino/WhatsApp, MCP e motores — com três lentes explicitamente separadas (competência financeira, comportamento, caixa) e sem nenhuma ação manual no backend.

## Estado atual verificado

- `src/lib/engine/canonicalFacts.ts` recorta período por `occurred_at` nas linhas 157, 207 e 288 (totais canônicos, fatos por categoria e total por categoria). O breakdown já migrou para competência — daí a divergência que sobra entre Home/canônico e Relatório/Metas.
- `FINANCE_TRUTH_VERSION = "finance_truth.v1"`; `FINANCE_CONTRACT_VERSION`/`SPENDING_PROJECTION_VERSION = "financial_snapshot_contract.v8"` (app, espelho `finance-core` e bundle `mcp`).
- `home_snapshot.v3` aparece em `src/lib/db/snapshotContract.ts`, `home-snapshot`, `finance-current-snapshot-worker`, uma migration e dois testes; cache key `home_snapshot_v3|...`.
- `src/lib/reports/intelligent/engine.ts:395` divide a despesa por `expenseDays.size` (só dias com gasto) e soma essencial/flexível apenas quando `exp > 0`, então estorno não abate a composição.
- `card_cycle_for` existe nas migrations de 18/08 e recebe `closing_day` + `due_day`; a derivação de competência ainda será auditada antes de qualquer alteração — o passo 1 da onda C é confirmar se algum caminho usa o mês do vencimento.

## Ondas de implementação

### A. Lente financeira canônica (`finance_truth.v2`)
- Introduzir `financialConsumptionDate()` (= `reportingCompetenceDate`) em `canonicalFacts.ts` e aplicar em `computeCanonicalPeriodTotals`, `computeCanonicalCategoryFacts`, `computeCanonicalCategoryTotal`, `computeCanonicalComparison` e `computeMonthlyTotals` (`facts.ts`).
- Baselines e comparações de metas por categoria passam pela mesma lente (actual, baseline, projeção).
- `computeBehavioralExpense`, ritmo diário, dia da semana e hábitos permanecem em `occurred_at`/`behavioral_day` — guarda de teste impedindo regressão.
- Caixa/saldo continua em `posted_at`; pagamento de fatura afeta caixa na data paga e nunca vira consumo.

### B. Contratos e invalidação de read model
- `financial_snapshot_contract.v8 → v9`, `home_snapshot.v3 → v4`, `finance_truth.v1 → v2`, `AGENT_RUNTIME_VERSION` bump.
- Atualizar todos os consumidores reais: `metrics.ts`, `spendingSimulation.ts`, `snapshotContract.ts`, `home-snapshot`, `finance-current-snapshot-worker`, `_shared/proactive/contracts.ts`, `_shared/intelligence/diagnosisToCommunication.ts`, `_shared/agent/tools.ts`, `ReplyHumanizer.ts`, bundle `mcp` e testes de contrato.
- Cache key vira `home_snapshot_v4|...`.
- Migration: invalidar snapshots v3/v8 (`financial_current_snapshots`, `financial_derived_cache`, `pulse_snapshots`, fila de refresh) marcando para recomputo — sem apagar transação nenhuma; relatórios gravados com template antigo continuam com aviso de recálculo.
- RPC `my_financial_home_snapshot` atualizada para o contrato novo na mesma migration.

### C. Fatura: competência ≠ vencimento
- Auditar e corrigir `card_cycle_for` e o equivalente TypeScript: `competence_month` = mês de fechamento do ciclo; `due_date` segue sendo vencimento; `period_start/period_end/closing_date` coerentes; nenhuma função derivando competência do mês do vencimento.
- Backfill conservador: não reescreve histórico já conciliado com statement oficial; toda mudança auditada em `card_reconciliation_events`.
- Pagamento em 01/09 de fatura de agosto: caixa em setembro, liquidação via `credit_card_payments` + `credit_card_payment_allocations`, zero consumo novo.

### D. Relatórios Inteligentes
- `dailyAvgExpense` = despesa ÷ dias corridos do período; `daysWithExpense` continua métrica separada.
- Estorno abate despesa total, categoria original e a fatia essencial/flexível (atribuição de refund aplicada na composição).
- Cartão em aberto passa a vir de `CardExposure`/`credit_card_statements` quando há statement oficial, distinguindo dívida atual, fatura do mês e parcelas futuras.
- Bump de `REPORT_TEMPLATE_VERSION`.

### E. Importação de fatura, parcelamento e autoridade documental
- Nunca derivar `total_amount = amount × installments_total` sem evidência de que o valor é a parcela; validação + testes com os casos Eventim (661,44 / 3 = 220,48) e Turbi (306,08 / 4 = 76,52).
- Hierarquia de evidência explícita (statement reconciliado > arquivo bancário > PDF oficial > manual confirmado > OCR/screenshot > inferência), com supersede/cancel do registro inferior, cancelamento das parcelas futuras derivadas e auditoria da decisão.
- Matcher de parcelas por cartão + merchant normalizado + janela de data + `installment_number`/`installments_total` + relação matemática total↔parcela + autoridade; valor deixa de ser identidade absoluta.
- Calendário de parcelas: sem mês repetido, sem mês pulado, `installments_total` exato, centavos distribuídos, nada de parcela futura de compra superseded.
- Fatura que não reconcilia: `requires_manual_review = true` e nunca vira autoridade máxima.
- Lifecycle unificado entre schema, SQL e TypeScript para statements/purchases/installments (só estados que as constraints permitem).

### F. MCP e Nino
- Paginação obrigatória (`fetchAllPages`) em toda leitura analítica de `transactions` no MCP; guarda estática estendida.
- MCP usa a mesma competência financeira para mês e categoria.
- Roteamento analítico: evidência de período incompatível descartada antes da síntese; evidência global bloqueada sob escopo travado; anáforas sem escopo recuperável = fail-closed; `expected_entity_count` derivado do conjunto esperado, nunca do retornado.
- Compact ledger: âncora derivada deixa de ser `bank_confirmed` e passa a `derived_carry`.

### G. Testes e validação
Cobertura dos 13 casos pedidos (competência 30/07→agosto, comportamento em 30/07, fatura agosto com vencimento 01/09, pagamento em 01/09, Eventim, Turbi, supersede cancelando parcelas futuras, estorno na composição, média diária 300/10 dias = 30, rejeição de `home_snapshot.v3`, baseline×actual na mesma lente, MCP sem truncar em 1.000, escopo do Nino preservado).

Validação final: `npm run sync:finance-core`, `npm test`, `npm run test:deploy-contract`, `npm run build`, varredura de referências residuais a v8/v3/v1 e competência por vencimento, TypeScript e imports.

## Detalhes técnicos

- Espelho `supabase/functions/_shared/finance-core` regenerado por `scripts/sync-finance-core.mjs` (paridade testada); mesma disciplina para reports-core.
- Migrations novas em `supabase/migrations/`, idempotentes, sem `DELETE` em `transactions`; invalidação por `contract_version`/enfileiramento de recomputo.
- Deploy atômico das funções listadas em `_shared/agent/DEPENDENTS.md` + `home-snapshot`, `finance-current-snapshot-worker`, `financial-reports-generate` e `mcp`, com `AGENT_RUNTIME_VERSION` novo para conferir o que está em produção.

## Fora de escopo

Landing page, identidade visual e qualquer mudança destrutiva em histórico financeiro.
