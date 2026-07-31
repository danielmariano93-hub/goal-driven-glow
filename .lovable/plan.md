# Correção definitiva: fatura e régua do rolê

## Diagnóstico confirmado

- A fatura afetada existe em `credit_card_statements` com status `needs_review`, total de R$ 4.636,08 e diferença de conciliação de R$ 1.080,63.
- A importação de origem está `canceled`: seus 40 itens foram marcados como `ignored`, enquanto a fatura já possui lançamentos contabilizados. Por isso ela não pode mais ser reaberta pelo fluxo normal do Assessor sem risco de duplicação.
- A tela de Cartões permite alterar somente descrição e categoria dos itens já confirmados. Ela não permite corrigir valor, data ou tipo, não oferece ação para aprovar a fatura e não oferece exclusão segura da fatura.
- O Assessor recupera automaticamente apenas documentos ativos das últimas 24 horas; a tela de Importações também não oferece “Revisar” para este estado. Assim, a fatura ficou sem um caminho funcional de conclusão.
- A régua atual está configurada para 1 dia antes, no vencimento e 3 cobranças posteriores a cada 3 dias. Há ainda jobs legados do tipo `reminder`, além dos jobs `due_soon`, `due_today` e `overdue`; dois lembretes antecipados já foram enviados para o rolê Festival.

## 1. Transformar o detalhe da fatura no fluxo canônico de correção

- Ampliar a edição de itens da fatura para valor, data, descrição, categoria e tipo contábil.
- Recalcular os totais e a diferença de conciliação no backend, na mesma transação de cada edição.
- Exibir no detalhe:
  - total oficial;
  - soma dos itens;
  - pagamentos/créditos;
  - diferença restante;
  - motivo objetivo que ainda bloqueia a aprovação.
- Manter edição acessível em mobile e desktop, com salvamento explícito por item e feedback de erro real.

## 2. Aprovação e exclusão seguras

Criar duas operações transacionais e restritas ao proprietário:

- `approve_credit_card_statement(statement_id)`:
  - exige conciliação fechada;
  - valida todos os vínculos financeiros;
  - muda `needs_review` para `open`, `partially_paid` ou `paid`, conforme o saldo;
  - registra auditoria e é idempotente.
- `discard_credit_card_statement(statement_id)`:
  - permitido somente enquanto estiver em rascunho/revisão e sem pagamento ativo;
  - remove/reverte apenas lançamentos e parcelas criados por essa importação, sem tocar em edições financeiras alheias;
  - marca a importação de origem como cancelada/descartada de forma consistente;
  - preserva trilha de auditoria e impede exclusão quando houver pagamento, exigindo antes “Desfazer pagamento”.

Na interface, adicionar ações claras e permanentes no rodapé do detalhe:

- `Aprovar fatura`, habilitado apenas quando conciliada;
- `Excluir fatura`, com confirmação destrutiva e explicação do impacto;
- `Registrar pagamento`, apenas depois da aprovação.

A fatura afetada será tratada por esse fluxo, sem reabrir os 40 itens cancelados e sem duplicar transações.

## 3. Régua fixa e simples da Divisão do Rolê

Substituir a configuração técnica por uma jornada de duas etapas:

```text
Vencimento, às 09h  →  lembrete
Dia seguinte, às 09h  →  último lembrete
Depois disso  →  nenhum novo envio
```

- Remover da interface campos de “dias antes”, repetição e quantidade máxima.
- Manter somente:
  - jornada ativa/inativa;
  - horário de envio;
  - pausa após resposta.
- Fixar no backend:
  - `due_soon_days_before = 0`;
  - lembrete no vencimento ativo;
  - primeiro atraso = 1 dia;
  - máximo de lembretes após vencimento = 1;
  - sem repetição adicional.
- Ao salvar ou implantar a nova política:
  - marcar como ignorados todos os jobs ainda pendentes dos tipos `reminder`, `due_soon`, `due_today` e `overdue`;
  - reagendar somente vencimento e vencimento + 1 dia;
  - preservar convites, confirmações de pagamento e mensagens de encerramento.
- Garantir que mudanças de vencimento, pagamento, opt-out ou encerramento invalidem os dois jobs restantes.

## 4. Validação verificável

- Testes das operações de editar, aprovar e excluir fatura, incluindo proprietário incorreto, pagamento existente, conciliação aberta e idempotência.
- Teste de regressão para o estado real: importação cancelada + statement `needs_review` + itens já contabilizados.
- Testes da régua garantindo exatamente dois jobs por participante elegível e nenhum job antecipado ou repetição posterior.
- Verificação no banco de que os jobs legados pendentes foram encerrados e apenas os horários permitidos permaneceram.
- Smoke test autenticado no preview em mobile e desktop:
  1. abrir a fatura;
  2. editar item;
  3. fechar a diferença;
  4. aprovar;
  5. validar exclusão segura em uma fatura de teste;
  6. salvar a régua e conferir a agenda resultante.
- Executar suíte completa de testes e build; não publicar o frontend sem autorização explícita.