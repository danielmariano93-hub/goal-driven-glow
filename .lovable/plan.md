# Divisão do Rolê parcelada — contas a receber com uma única verdade

## O que a auditoria encontrou hoje (verificado no banco e no código)

- Estrutura atual: `shared_expenses` (um único `due_date`, `total_amount`, origem do pagamento, conta de reembolso, `linked_transaction_id`) → `shared_expense_participants` (`amount_due`, `amount_paid`, `status`, `paid_at`) → `shared_expense_events` (auditoria). **Não existe nível de parcela** e **não existe tabela de pagamentos**: o pago é só um acumulado na pessoa.
- Lembretes: `reminder_jobs` com unicidade por `(divisão, participante, tipo)` enquanto o job está vivo; `schedule_split_due_reminders` gera `due_today`/`overdue` a partir do `due_date` único da divisão; elegibilidade em `split_participant_is_eligible` exige saldo > 0. Ou seja, hoje um participante só pode ter uma cobrança viva por tipo — incompatível com 3 parcelas.
- Pagamento: `split_add_payment_v2` soma no participante, marca `paid`/`partial`, lança receita de reembolso (`movement_kind='refund'`, `split_transaction_role='reimbursement'`) na conta de reembolso e encerra jobs vivos daquele participante.
- Contabilidade: a compra original entra **uma única vez** por `split_upsert_original_transaction` (`split_transaction_role='original_expense'`). Essa base está correta e será preservada — nada de duplicidade.
- Front: criação em 3 passos (`DivisaoDoRoleNova`), detalhe por participante (`DivisaoDoRoleDetalhe`), resumo na Home via RPC `split_summary`.
- Nino hoje **não tem leitura** de rolês (só rascunho de confirmação); não há “contas a receber” no motor de projeções.
- Datas civis já têm motor próprio (`src/lib/engine/civilDate.ts`) — será a única forma de calcular vencimentos.

## Modelo canônico a criar

```text
shared_expenses  (à vista = 1 parcela)
  └─ shared_expense_participants        (total que a pessoa deve)
       └─ shared_expense_installments   (NOVA verdade: parcela)
            └─ shared_expense_payments  (NOVA: cada recebimento)
```

`shared_expense_installments`: `id`, `shared_expense_id`, `participant_id`, `installment_number`, `total_installments`, `amount`, `due_date` (DATE civil), `status` (`pending|partial|paid|overdue|cancelled`), `paid_amount`, `paid_at`, `payment_reference`, `created_at`, `updated_at`. Restrições: soma das parcelas de cada participante = `amount_due` (validada na RPC), `paid_amount <= amount`, unicidade `(participant_id, installment_number)`.

`shared_expense_payments`: `id`, `installment_id`, `participant_id`, `amount`, `paid_at`, `transaction_id`, `reference`, `created_at` — histórico imutável; `paid_amount` da parcela e `amount_paid` da pessoa passam a ser derivados dele por trigger.

Status é sempre calculado no banco (função `split_installment_state`), nunca no front: `paid` (≥ valor), `partial` (>0), `overdue` (vencida sem saldo zero), `pending`, `cancelled`. Uma view canônica `split_receivables_v1` expõe por parcela: valor, vencimento, participante, pago, saldo, status — e é a fonte única de UI, Nino, lembretes, projeções e relatórios.

## Etapas

**1. Migration + backfill**
- Criar as duas tabelas com GRANT + RLS por dono (e leitura do participante vinculado, seguindo as políticas atuais de `shared_expense_participants`).
- Triggers de recálculo: pagamento → parcela → participante → divisão (`settled` só quando todas as parcelas fecham).
- Backfill idempotente: cada participante existente ganha **1 parcela** (`installment_number=1`, `total_installments=1`, `amount = amount_due`, `due_date = shared_expenses.due_date`), e o `amount_paid` já existente vira um `shared_expense_payments` histórico. Divisões antigas continuam funcionando sem mudança de comportamento.

**2. RPCs**
- `split_create_v2` / `split_update` passam a aceitar `p_installments` (por participante: número, valor, vencimento) e rejeitam qualquer inconsistência matemática (`soma ≠ total da pessoa`).
- Novo `split_add_installment_payment(installment_id, amount, paid_at, reference)` substitui o caminho por participante: registra pagamento, recalcula saldo, gera o lançamento de reembolso apenas do valor recebido, encerra jobs daquela parcela.
- `split_reverse_payment` passa a estornar por pagamento (sem apagar histórico).
- Edição: parcelas pagas/parciais são imutáveis; só parcelas `pending` futuras podem ser redistribuídas, e a auditoria registra o antes/depois em `shared_expense_events`.
- Cancelamento por parcela, por participante ou da divisão inteira usa `status='cancelled'` e cancela lembretes futuros; nada de apagar histórico pago.

**3. Lembretes por participante + parcela**
- `reminder_jobs` ganha `installment_id`, e a unicidade viva passa a `(divisão, participante, parcela, tipo)`; dedupe adicional por `reference_date`.
- `schedule_split_due_reminders` e `split_participant_is_eligible` passam a operar sobre `split_receivables_v1` (vencimento da parcela, saldo da parcela), respeitando a política de dias já configurada no admin.
- **Late validation obrigatória** no worker `split-reminders-dispatch-v2`: antes de enviar, reconsulta a parcela e os pagamentos; se `paid`, `cancelled` ou saldo 0, não envia e grava o motivo (`already_paid`, `cancelled`, `no_balance_due`) em `reminder_jobs.cancel_reason` + evento de auditoria.
- Mensagens reescritas em `messageTemplates.ts` com markdown do WhatsApp (`*negrito*`), curtas, informando parcela `n/N`, valor, vencimento, saldo restante e — no parcial — quanto já foi pago.

**4. Front**
- Criação/edição: escolha **À vista / Parcelado**; nº de parcelas; “Dividir igualmente as parcelas” (centavos distribuídos, soma exata) ou “Definir valores”; vencimentos por recorrência mensal automática ou manuais; painel permanente `Total a receber / Distribuído / Restante` com bloqueio enquanto restante ≠ 0.
- Card do rolê: Total, Recebido, Pendente, Vencido, Próximo vencimento.
- Detalhe: cada participante expansível com a agenda `1/3 — 10/10 — R$ 150 — Pago`, registro de pagamento por parcela (inclusive parcial), e visão consolidada com contagem de parcelas pagas/pendentes/atrasadas.

**5. Contabilidade e projeções**
- A compra original continua única (`original_expense`); o recebimento continua reembolso (`refund`/`reimbursement`), não receita econômica — comportamento já correto, agora acionado por parcela e apenas pelo valor recebido.
- Parcelas em aberto passam a ser expostas como **recebíveis esperados** (`expected_receivable`) e recebidos como `received_receivable`, semanticamente separados: valor esperado nunca conta como saldo disponível, renda ou média diária.
- Revisar/ajustar os consumidores: saldo, fluxo de caixa, receitas/despesas, média diária, categorias, patrimônio, projeção do mês, próximos recebimentos, relatórios e insights.

**6. Nino e Home**
- Nova ferramenta de leitura canônica (a mesma view) para responder “quanto tenho a receber dos rolês?”, “quem está me devendo?”, “quais parcelas vencem este mês?”, “quanto recebo do João em novembro?”, “quem está atrasado?”.
- Home: resumo passa a ler recebíveis por parcela, separando esperado de recebido, e o próximo vencimento real.

**7. Testes e E2E**
- Os 18 testes pedidos (à vista preservada, 300/3, 100/3 com centavos, valores diferentes, agendas independentes, lembrete só para quem deve, pagamento antecipado, supressão por late validation, parcial cobrando só o saldo, overdue, data civil imune a timezone, edição preservando histórico, cancelamento cancelando lembretes, zero dupla contagem, recebimento sem inflar renda, esperado ≠ recebido, queries do Nino, sem duplicidade de lembretes).
- E2E em fixture: “Viagem”, R$ 900, João e Pedro (R$ 450 cada), 3 parcelas em 10/10, 10/11, 10/12; João paga a 1ª, Pedro paga R$ 100 → João `Pago`, Pedro `Parcial` com saldo R$ 50, recebido R$ 250, a receber R$ 650, lembrete só para Pedro e só dos R$ 50.
- Auditoria completa em `shared_expense_events` (criação, geração de parcelas, mudança de vencimento, pagamento, parcial, quitação, lembrete criado/suprimido/enviado, cancelamento); erros de banco nunca silenciados.
- Redeploy do lote de funções dependentes de `_shared/agent` conforme `DEPENDENTS.md`, com bump de runtime.

## Entrega final
Tabela `ITEM | IMPLEMENTAÇÃO | TESTE | RESULTADO | STATUS` mais riscos residuais explícitos.

## Notas técnicas
- Vencimentos sempre `DATE` + `src/lib/engine/civilDate.ts` (`civilAddMonths`, `civilDueDate`); nunca `new Date(...)` local nem `toLocaleString` para derivar dia.
- Centavos por aritmética inteira (padrão de `src/lib/split/math.ts`), resíduo distribuído nas primeiras parcelas.
- Nenhum JSON de renderização: toda leitura de parcela vem da view canônica.
