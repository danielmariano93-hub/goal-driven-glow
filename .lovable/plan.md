## Plano de correção definitiva — Divisão do Rolê

### Evidências confirmadas antes do plano
| Ponto | Evidência objetiva |
|---|---|
| Fakku está cancelado, não excluído | `status=cancelled`, `deleted_at=false`, `linked_transaction_id=true` |
| Fakku ainda impacta patrimônio | existe `1` transação confirmada vinculada, soma `39.90`, origem financeira preservada |
| Não há pagamentos recebidos | `received_external=0.00`, portanto `split_delete` pode concluir a exclusão |
| Bebidas está excluído e sem lançamento | `status=cancelled`, `deleted_at=true`, `tx_count=0` |
| Mensagem de Bebidas está presa na fila | `reminder_jobs.status=enqueued`, `outbound_messages.status=queued`, `outbound_attempts=0`, sem erro |
| Causa no código do dispatcher | `whatsapp-send` só é chamado quando `enqueued > 0`; mensagens já existentes em `queued` não disparam novo envio |
| Causa no frontend de exclusão | `DivisaoDoRoleDetalhe.tsx` condiciona Cancelar e Excluir por `split.status !== "cancelled"`, escondendo a exclusão pós-cancelamento |

## Objetivo
Corrigir em um único bloco o fluxo real de exclusão financeira e o processamento contínuo da mensageria da Divisão do Rolê, sem mexer em WAHA, QR, sessão, documentos ou frontend fora das telas da própria Divisão do Rolê.

## 1. Exclusão de rolê já cancelado sem pagamentos

### Backend
- Manter a RPC existente `split_delete(p_id)` como operação canônica de exclusão lógica + remoção financeira.
- Validar se a RPC já remove também o lançamento indicado por `linked_transaction_id` quando `shared_expense_id` não estiver preenchido; se necessário, ajustar cirurgicamente para apagar por ambos os vínculos:
  - `transactions.shared_expense_id = p_id`; ou
  - `transactions.id = shared_expenses.linked_transaction_id`.
- Garantir que a exclusão:
  - preenche `deleted_at`;
  - limpa `linked_transaction_id`;
  - remove a despesa original confirmada;
  - marca jobs pendentes como interrompidos;
  - registra evento `deleted` no histórico.

### Frontend
- Alterar `DivisaoDoRoleDetalhe.tsx` para exibir `Excluir rolê e remover lançamento` quando:
  - `deleted_at` está vazio;
  - não há pagamentos recebidos;
  - existe lançamento financeiro vinculado ou o rolê está cancelado sem exclusão.
- Não depender de `split.status !== "cancelled"` para mostrar o botão de exclusão.
- Ao confirmar:
  - chamar `split_delete`;
  - invalidar queries de divisões, movimentações, contas, cartões e dashboard;
  - redirecionar para `/app/divisao-do-role`;
  - exibir confirmação clara: “Rolê excluído e lançamento removido”.

### Listagem
- Manter a aba “Todas” filtrando `deleted_at IS NULL`.
- Ajustar a aba “Canceladas” para incluir canceladas excluídas e mostrar rótulo “Excluído · mantido apenas no histórico”.
- Assim, Fakku deve sair de “Todas” após exclusão e permanecer rastreável em “Canceladas”.

## 2. Atualização imediata de movimentações, conta e patrimônio
- Após `split_delete`, invalidar explicitamente:
  - `shared_expenses`;
  - `transactions`;
  - `accounts`;
  - `credit_cards`;
  - `dashboard`;
  - qualquer chave usada pelos cards de patrimônio/saldo se houver chave específica.
- Como a despesa confirmada será removida do banco, o patrimônio deixará de considerar os R$ 39,90 por consequência do ledger real, não por ajuste visual.

## 3. Processamento contínuo da fila `outbound_messages`

### Dispatcher `split-reminders-dispatch`
- Alterar o final do dispatcher para acionar `whatsapp-send` em todo ciclo autorizado, mesmo quando `enqueued = 0`.
- Preservar segurança atual: chamada interna com service role, sem expor segredo no frontend.
- Retornar no JSON do dispatcher:
  - `claimed`;
  - `enqueued`;
  - `skipped`;
  - `failed`;
  - `outbound_processed`;
  - `outbound_kicked: true/false`.
- Registrar log sanitizado se o kick falhar.

### Worker `whatsapp-send`
- Confirmar que o worker já faz:
  - recuperação de leases expirados via `recover_expired_outbound_leases`;
  - claim de mensagens `queued`;
  - tentativas/backoff;
  - status `dead` após limite;
  - gravação de `last_error`.
- Só alterar se algum desses pontos estiver ausente.

## 4. Botão “Retomar envio” realmente efetivo
- Em `DivisaoDoRoleDetalhe.tsx`, manter o botão chamando `split-reminders-dispatch`, mas agora ele também processará `outbound_messages.queued` por causa da mudança do dispatcher.
- Exibir feedback mais preciso:
  - “Preparando” para job em `queued/processing` sem outbound;
  - “Na fila do WhatsApp” para outbound `queued`;
  - “Enviando” para outbound `processing`;
  - “Enviada ao WhatsApp”, “Entregue”, “Lida”, “Falhou” ou “Não entregue” conforme status.
- Mostrar tentativas e última tentativa quando disponíveis.
- Se uma mensagem ficar muito tempo em fila/processamento, mostrar explicação e ação “Retomar envio”.

## 5. Cancelamento, exclusão e comunicação com participantes

### Sem expandir escopo além do necessário
- Ao excluir rolê:
  - interromper definitivamente `reminder_jobs` pendentes;
  - impedir criação de novos lembretes;
  - registrar evento `deleted`.
- Ao cancelar rolê:
  - manter comportamento financeiro atual de cancelamento sem remover lançamento;
  - registrar no histórico que cobranças pendentes foram interrompidas.
- Mensagem de cancelamento para participantes só deve ser adicionada se já existir base segura no modelo atual; caso contrário, deixar como gap explícito para uma próxima migration/feature, para não criar envio isolado incorreto ou duplicado.

## 6. Correção do caso real Fakku
- Depois do patch, executar a RPC `split_delete` para o rolê Fakku real, pois ele atende aos critérios confirmados:
  - cancelado;
  - sem `deleted_at`;
  - sem pagamento recebido;
  - com lançamento confirmado ainda existente.
- Validar no banco que:
  - `deleted_at IS NOT NULL`;
  - `linked_transaction_id IS NULL`;
  - não existe mais transação original confirmada vinculada;
  - o evento `deleted` foi registrado.

## 7. Validações obrigatórias
- Testes unitários/contratuais cobrindo:
  - botão de exclusão aparece para cancelado sem pagamentos;
  - botão não aparece quando há pagamento recebido;
  - listagem “Todas” exclui `deleted_at`; “Canceladas” mostra “Excluído”;
  - dispatcher chama `whatsapp-send` mesmo com `enqueued = 0`;
  - status de mensagem diferencia fila, envio, falha e tentativas.
- Rodar:
  - testes focados da Divisão do Rolê;
  - typecheck;
  - build.
- Validação real no banco para Fakku e Bebidas, sem expor telefone ou conteúdo de mensagem.

## Entrega esperada após aprovação
Uma correção única contendo:
- patch mínimo nas telas da Divisão do Rolê;
- patch mínimo no dispatcher de lembretes;
- se necessário, migration/RPC pequena para endurecer `split_delete`;
- reparo controlado do registro Fakku real;
- evidências finais em tabela com item, status e prova objetiva.