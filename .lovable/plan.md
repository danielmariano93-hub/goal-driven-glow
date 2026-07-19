## Diagnóstico confirmado

A falha não está só na tela. O registro real mais recente da Divisão do Rolê existe, mas ficou incompleto:

- `shared_expenses`: a divisão foi criada com `source_account_id = null` e `source_credit_card_id = null`.
- `shared_expenses.linked_transaction_id = null`.
- `transactions`: não existe transação vinculada a essa divisão (`tx_count = 0`).
- Por isso ela não aparece em **Lançamentos/Movimentos** e não entra no cálculo de patrimônio/saldo.
- A edição chama `split_update`, mas a função exige uma origem financeira. Como a divisão antiga foi criada sem origem, a tela abre sem origem selecionada e o salvamento fica propenso a erro.
- A exclusão/cancelamento chama `split_cancel`; sem lançamento vinculado, ela até pode cancelar a divisão, mas não corrige o impacto financeiro porque não há transação para remover.
- A mensagem ao participante ficou apenas como `reminder_jobs.status = queued`, sem `outbound_message_id`; ou seja, foi agendada, mas não virou mensagem de saída ainda.

Também encontrei um risco de regressão: existe uma função antiga `split_send_reminders` que ainda insere jobs sem o novo campo `kind`, dependendo do default. Isso funciona parcialmente, mas não usa o helper novo `split_enqueue_message`, então fica menos idempotente e menos observável.

## Correção proposta

### 1. Migration cirúrgica de reparo e hardening

Criar uma migration única para:

- Permitir que divisões antigas sem origem continuem abrindo, mas impedir novas divisões incompletas no fluxo v2.
- Atualizar `split_create_v2` para respeitar `p_register_transaction` e sempre falhar de forma clara quando a origem é obrigatória.
- Atualizar `split_update` para:
  - aceitar edição de divisão legada sem origem somente se `p_register_transaction = false`;
  - exigir origem quando deve refletir em lançamento;
  - recriar ou atualizar o lançamento vinculado via `split_upsert_original_transaction`.
- Fortalecer `split_upsert_original_transaction` para:
  - procurar transação existente por `shared_expense_id` caso `linked_transaction_id` esteja nulo;
  - recriar a transação quando ela foi apagada indevidamente;
  - atualizar `linked_transaction_id` de volta na divisão.
- Atualizar `split_cancel` para:
  - localizar a transação tanto por `linked_transaction_id` quanto por `shared_expense_id`;
  - cancelar a divisão e remover o lançamento original quando permitido;
  - pular/remover jobs pendentes de mensagem.
- Atualizar `split_send_reminders` para usar `split_enqueue_message`, garantindo `kind`, dedupe e evento `message_queued`.

### 2. Reparar dados reais já quebrados

Na mesma migration, corrigir a divisão real incompleta:

- Preencher origem financeira com a conta ativa do próprio usuário, quando houver exatamente uma conta ativa.
- Recriar o lançamento original da divisão usando `shared_expenses.total_amount`, `occurred_at`, `title` e a origem preenchida.
- Atualizar `linked_transaction_id`.
- Registrar evento auditável sem expor telefone ou dado sensível.

Se houver mais de uma conta ativa em algum caso futuro, a migration não deve adivinhar: deixará a divisão sem origem e a UI exigirá seleção explícita na próxima edição.

### 3. Ajuste mínimo no frontend da Divisão

Editar apenas `src/pages/DivisaoDoRoleNova.tsx` e `src/pages/DivisaoDoRoleDetalhe.tsx` para:

- Mostrar aviso claro quando uma divisão legada está sem origem financeira.
- Garantir que a edição só habilite salvar quando a origem estiver selecionada.
- Após salvar/cancelar/marcar pagamento, invalidar queries de `transactions`, `dashboard`, `accounts` e `shared_expenses` para o patrimônio atualizar imediatamente.
- Melhorar a mensagem de erro mostrando o motivo vindo do backend.

### 4. Validação real

Depois de aprovado, executar:

- Migration via backend.
- Consulta de validação no banco confirmando, para a divisão afetada:
  - `source_account_id` ou `source_credit_card_id` preenchido;
  - `linked_transaction_id` preenchido;
  - linha correspondente em `transactions` com `shared_expense_id` e `split_transaction_role = 'original_expense'`.
- Testes automatizados existentes da Divisão do Rolê.
- Typecheck e build.

## Resultado esperado

- Editar a Divisão do Rolê passa a salvar.
- Cancelar/excluir a divisão passa a remover o lançamento original quando não há reembolso recebido.
- O lançamento passa a aparecer em Lançamentos/Movimentos.
- O patrimônio e os valores do dashboard passam a contemplar esse gasto.
- A mensagem deixa de ficar invisível: jobs serão criados pelo caminho idempotente e rastreável.