# Fontes financeiras do Meu Nino — classificação canônica (E8 / D10)

Última revisão: 2026-08-02 (`finance_contract.v2`).

Toda leitura ou escrita financeira nova deve usar exclusivamente tabelas
**ativas**. Tabelas legadas, experimentais ou substituídas não podem ser
consultadas por novas telas, Edge Functions, RPCs ou tools do Nino.

## Legenda

| Estado | Significado |
| --- | --- |
| **ativa** | Fonte de verdade. Pode ser lida e escrita. |
| **derivada** | Materialização/cache de fontes ativas. Somente leitura para a UI; escrita apenas por job. |
| **planejada** | Estrutura existe mas ainda não é fonte de verdade. Não usar em produto. |
| **legada** | Mantida para histórico. Leitura só em migração/backfill. Nunca escrever. |
| **substituída** | Papel assumido por outra tabela. Nenhum uso novo. |
| **experimental** | Em validação. Uso restrito a laboratório/admin. |

## Núcleo transacional

| Tabela | Estado | Papel |
| --- | --- | --- |
| `transactions` | ativa | Lançamento canônico (competência em `competence_date`, caixa em `occurred_at`). |
| `accounts` | ativa | Contas de caixa/banco. |
| `categories` | ativa | Categorias do usuário + globais. |
| `recurring_rules`, `recurring_occurrences` | ativa | Compromissos recorrentes e suas ocorrências. |
| `recurring_entries` | substituída | Antecessora de `recurring_rules`. Sem escrita nova. |
| `account_balance_snapshots` | derivada | Saldo conciliado por data. |
| `financial_current_snapshots`, `financial_daily_facts`, `financial_daily_category_facts` | derivada | Agregados de leitura (Home/Relatórios). |
| `financial_metric_diffs`, `financial_backfill_checkpoints` | derivada | Auditoria de backfill e variação de métricas. |

## Cartão de crédito (verdade oficial de fatura)

| Tabela | Estado | Papel |
| --- | --- | --- |
| `credit_cards` | ativa | Cadastro do cartão. |
| `credit_card_statements` | ativa | **Fonte oficial** da obrigação por competência (`card_exposure.v1` dá precedência a ela). |
| `credit_card_statement_items` | ativa | Linhas oficiais da fatura (compras, créditos, pagamentos, encargos). |
| `credit_card_purchases` | ativa | Compra original, base do parcelamento. |
| `credit_card_installments` | ativa | Parcelas futuras; `absorbed_by_statement_id`/`absorbed_at` marcam o que já foi faturado (E6). |
| `credit_card_payments`, `credit_card_payment_allocations` | ativa | Pagamento/antecipação de fatura e sua alocação. |
| `credit_card_payment_reversals` | ativa | Reversão auditável de pagamento. |
| `v_card_double_counting` | derivada | Conferência oficial × lançamentos × parcelas (detecção de dupla contagem). |

Regras invioláveis: compra no cartão não movimenta conta; pagamento de fatura
não é consumo; fatura `paid`/`settled` tem obrigação zero em todas as telas.

## Ingestão de documentos

| Tabela | Estado | Papel |
| --- | --- | --- |
| `document_imports` | ativa | Cabeçalho da importação e conciliação. |
| `extracted_items` | ativa | Itens extraídos, revisados e confirmados. |
| `document_fragments` | ativa | Trechos determinísticos do PDF (cobertura da extração). |
| `document_processing_events`, `document_import_audit`, `document_item_rejections` | ativa | Rastro de processamento e quarentena. |
| `merchant_aliases` | ativa | Normalização amigável e categorização por estabelecimento. |
| `import_batches`, `import_rows` | legada | Importação CSV/OFX anterior ao pipeline documental v2. |

## Dívidas, metas e investimentos

| Tabela | Estado | Papel |
| --- | --- | --- |
| `debts`, `debt_payments` | ativa | Dívidas e amortizações (neutras em resultado). |
| `goals`, `goal_contributions` | ativa | Metas individuais. |
| `shared_goals`, `shared_goal_members`, `shared_goal_invites`, `shared_goal_contributions` | ativa | Metas conjuntas. |
| `investments`, `investment_movements` | ativa | Carteira e movimentações. |
| `category_spending_goals`, `category_spending_goal_cycles` | ativa | Metas por categoria e seus ciclos. |
| `user_financial_settings` | ativa | Renda, ciclo e preferências financeiras. |
| `company_accounts`, `company_transactions`, `company_categories`, `company_budgets`, `company_vendors` | planejada | Módulo PJ ainda não exposto no produto. |

## Divisão do Rolê

| Tabela | Estado | Papel |
| --- | --- | --- |
| `shared_expenses`, `shared_expense_participants`, `shared_expense_events` | ativa | Rateio, participantes e histórico. |
| `reminder_jobs`, `split_reminder_policy` | ativa | Régua de lembretes (vencimento e +24h). |
| `split_link_audit` | ativa | Auditoria de acesso por link. |

## Observabilidade e operação

| Tabela | Estado | Papel |
| --- | --- | --- |
| `edge_incidents` | ativa | Incidentes do contrato `edge_error.v1` (E7), rastreáveis por `request_id`. |
| `agent_runs`, `agent_steps`, `agent_tool_calls`, `agent_decisions`, `agent_turn_events` | ativa | Telemetria do Agent Core. |
| `reconciliation_issues` | ativa | Divergências financeiras abertas. |
| `job_heartbeats`, `provider_health_events`, `provider_inbound_drops` | ativa | Saúde de jobs e provedores (inclui `product_events_prune` e `whatsapp-ack-watchdog`). |
| `wave1_pre_snapshot` | legada | Foto pré-migração de uma onda específica. |
| `behavior_hypotheses`, `pending_proactive_suggestions` | experimental | Motor proativo em validação. |
| `agent_sessions`, `agent_memory`, `agent_knowledge_entries` | ativa | Sessão, memória e base de conhecimento do Nino. |

## Motores canônicos (código)

| Módulo | Papel |
| --- | --- |
| `src/lib/engine/spendingRhythm.ts` (`spending_rhythm.v3`) | Ritmo bruto, estornos, líquido e típico. |
| `src/lib/engine/cardExposure.ts` (`card_exposure.v1`) | Dívida de cartão, faturas atual/próxima e parcelas futuras. |
| `src/lib/ledger/canonical.ts` | Invariantes contábeis da ingestão. |
| `supabase/functions/_shared/finance-core/` | Espelho gerado por `scripts/sync-finance-core.mjs` (rodado em `prebuild`/`pretest`); paridade garantida por teste. |
| `src/lib/engine/metrics.ts` (`finance_contract.v2`) | Snapshot único: totais do mês, breakdown por categoria, metas, investimentos, dívidas, compromissos e exposição de cartão. |
| `src/lib/db/invalidation.ts` | Ponto único de invalidação de cache após qualquer escrita financeira. |
| `supabase/functions/_shared/insights/detectors.ts` (`insights_catalog.v1`) | Catálogo determinístico de dicas; a IA só reescreve o texto. |
| `src/lib/mcp/shared.ts` (`edge_error.v1`) | Envelope de sucesso/erro das tools MCP, alinhado às Edge Functions. |
| `supabase/functions/_shared/http.ts` (`edge_error.v1`) | Contrato único de resposta e erro das Edge Functions. |

## Consumidores obrigados ao contrato único

`Home`, `Relatórios`, `Cartões`, `Investimentos`, `Dívidas`, `Metas`,
`pulse-compute`, `insights-generate`, tools MCP (`monthly_summary`,
`financial_position`) e o Nino leem **exclusivamente** o `finance-core`.
Dívida de cartão sempre vem de `card_exposure.v1`; quando há exposição oficial,
`computeAvailableUntil` recebe `cardDebtOverride` e nunca reconstrói o valor por
transações. Auditoria de resíduo por fatura: `public.audit_card_reconciliation`.

Alterar qualquer classificação acima exige atualizar este documento no mesmo
commit — o teste `src/test/financial-sources-doc.test.ts` falha se o documento
não citar as fontes ativas do núcleo financeiro.
