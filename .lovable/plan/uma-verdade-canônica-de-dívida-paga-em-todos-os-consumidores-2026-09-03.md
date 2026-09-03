# Uma verdade canônica de dívida paga em todos os consumidores

## O que já foi confirmado no banco e no código

Estado canônico (`debt_obligation_state`, `debt_obligation.v1`) já está **correto** hoje:

| Dívida | ciclo atual | pago em | próximo vencimento |
|---|---|---|---|
| Banco Sim | paid | 2026-09-02 | 2026-10-04 |
| Reneg Cartão Atacadão (Carrefour) | paid | 2026-09-02 | 2026-10-10 |
| Banco Pan | paid | 2026-08-22 | 2026-10-10 |
| Celular | pending | — | 2026-09-28 |

Mesmo assim continuam ativas, atualizadas em 03/09 00:30:
`debt_due_soon:*` e `future:debt:*` para Banco Sim, Carrefour e Banco Pan — ou seja, alertas de vencimento e "parcela se aproxima" para ciclos pagos.

Causas-raiz confirmadas:

1. **Limpeza quebrada**: em `nino_diag_detect_debt_alerts` o bloco de expiração usa `s.dedupe_key`, coluna que não existe (a tabela usa `situation_key`). A instrução falha em execução, então nenhum alerta antigo é expirado quando o pagamento entra.
2. **Detector futuro ignora pagamento**: `nino_evaluate_future_situations` monta `future:debt:*` direto de `debts` com `make_date(..., least(due_day,28))`, sem consultar `debt_obligation_state` — recria a situação para ciclo pago e ainda distorce o dia civil (dia 4 e dia 10 são preservados, mas dia 29–31 vira 28).
3. **O Nino nunca recebe o status de pagamento**: o serializador do agente (`_shared/engine/metrics.ts`, `commitment_agenda`) expõe só `name/type/amount/date/source/estimated`. `payment_status`, `paid_at` e `pendingItems` são descartados, então parcela paga chega ao Nino como compromisso futuro e ele diz "vence amanhã".
4. **Home ficou sem contexto**: `Index.tsx` passa apenas `commitmentAgenda.pendingItems` ao card. Compromissos pagos desapareceram da visão do mês (e, se a Edge `home-snapshot` estiver com bundle anterior a `commitment_agenda.v3`, o campo vem indefinido e o card fica vazio — a verificar no runtime real).
5. **Tela Compromissos soma pago**: `expenseTotal` reduz sobre todos os `items`, incluindo `payment_status === "paid"`.
6. **Duas regras de pagamento**: a agenda TypeScript ainda deriva "ciclo pago" por heurística (`due < canonical.next_due_date`) em `computeDebtStatus`, em paralelo à regra SQL canônica.

## Implementação

### 1. Estado canônico único de obrigação

- `debt_obligation_state` permanece a única regra. `computeDebtStatus` passa a expor explicitamente o contrato de ciclo (`current_cycle_due_date`, `current_cycle_status`, `current_cycle_paid_at`, `installments_paid/total`, `next_due_date`, saldo) e a agenda passa a **ler esses campos**, sem inferir por data.
- Teste de paridade obrigatório: para um conjunto de cenários (pago, parcial, atrasado, antecipado, múltiplos pagamentos, fim de mês), o resultado do TS deve ser idêntico ao da função SQL executada com os mesmos dados.

### 2. Situações do Nino

- Migration corrigindo `nino_diag_detect_debt_alerts` (`situation_key`) e reescrevendo `nino_evaluate_future_situations` para derivar dívidas de `debt_obligation_state`, com data civil real e exclusão de ciclos pagos.
- Nova rotina idempotente de reconciliação (`nino_reconcile_debt_situations`): lê o estado canônico, expira/resolve `debt_due_soon:*`, `debt_overdue:*`, `future:debt:*` e equivalentes de ciclos pagos, e impede recriação enquanto o ciclo estiver pago.
- A mesma reconciliação roda no registro de pagamento (`record_debt_payment`) e no início dos ticks de diagnóstico/proatividade, e limpa também `proactive_signals`, `proactive_situations` e `pending_proactive_suggestions` associados ao ciclo quitado.

### 3. Agenda, Home e tela de Compromissos

- Semântica explícita: `items` = agenda do período com histórico (inclui pagos); `pendingItems` = base de projeção, totais futuros e alertas.
- Home volta a exibir compromissos do mês usando `items`, com pendentes primeiro e selo "Pago" nos quitados; o valor de destaque do card usa somente pendentes.
- Tela Compromissos: total do topo passa a somar apenas `payment_status !== "paid"`, com linha separada de "já pago no período"; o rótulo "Pago" vem do estado canônico, nunca da data.
- Auditoria de todos os consumidores da agenda (projeção, `upcomingConfirmedCommitments`, `freeAfterKnownCommitments`, `projectedEndBalance`, pressão de caixa, antecipação, simulador, relatórios) para garantir que pago não é descontado.

### 4. Contrato do agente

- O serializador do agente passa a incluir `payment_status`, `paid_at`, `next_due_date` e um bloco `pending` separado, e as leituras de compromisso do Nino usam pendentes para "o que vai vencer".
- Revalidação antes de enviar/enfileirar comunicação já existente é estendida a `future:debt:*` e sinais derivados.

### 5. Frescor do estado

- Registro de pagamento passa a: incrementar a versão do ledger financeiro, enfileirar recomputo de snapshot, reexecutar diagnóstico, reconciliar situações e invalidar cache do front — sem depender do job periódico.
- Revisão dos snapshots (`financial_current_snapshots`, `financial_performance_snapshots`, `financial_profile_snapshots`, `nino_diagnosis_snapshots`, `pulse_snapshots`) e da fila de refresh para não servir estado anterior ao pagamento.

### 6. Backfill idempotente (todos os usuários)

Migration/rotina, sem filtro por usuário: recalcula estado canônico, expira situações inválidas, limpa filas proativas de ciclos pagos, marca snapshots/diagnósticos afetados para recomputo e reexecuta o diagnóstico dos usuários atingidos.

### 7. Testes

Casos A–F do pedido (pago, pendente, `debt_due_soon` expirado após pagamento, `future:debt` resolvido, agenda mista 2 pagas + 2 pendentes com Home exibindo o card, data civil sob UTC), mais paridade TS × SQL e regressão do serializador do agente.

### 8. Deploy e validação em produção

- Redeploy do lote de dependentes de `_shared` (as 10 funções de `DEPENDENTS.md`) **mais** `home-snapshot`, `nino-intelligence-tick`, `finance-*` afetadas, com bump de `AGENT_RUNTIME_VERSION`.
- Evidências obrigatórias por query real: estado canônico e situações ativas de Banco Sim, Carrefour/Reneg e Banco Pan; ausência de sinal/sugestão/outbound para ciclo pago; novo diagnóstico gerado; novo relatório financeiro gerado com `goals` preenchido; agenda mostrando pago sem somar em pendente.
- Relatório final com os 17 itens pedidos, incluindo arquivos alterados, migrations, backfill executado, número de testes e as queries de validação.

## Detalhes técnicos

- Arquivos principais: `src/lib/engine/debtStatus.ts`, `src/lib/engine/commitmentAgenda.ts`, `src/lib/engine/metrics.ts`, `src/pages/Index.tsx`, `src/components/home/ProximosCompromissosCard.tsx`, `src/pages/Compromissos.tsx`, `supabase/functions/_shared/engine/metrics.ts`, `supabase/functions/home-snapshot/index.ts`, `_shared/agent/core/CommunicationDispatcherV3.ts`, `_shared/proactive/*`, espelho `_shared/finance-core` via `scripts/sync-finance-core.mjs`.
- Migrations: correção de `nino_diag_detect_debt_alerts`, reescrita de `nino_evaluate_future_situations`, nova `nino_reconcile_debt_situations`, gancho em `record_debt_payment`, backfill idempotente.
- Nenhuma nova fonte de verdade: `debt_obligation_state` continua canônica; TS apenas projeta o estado resolvido, sob teste de paridade.
