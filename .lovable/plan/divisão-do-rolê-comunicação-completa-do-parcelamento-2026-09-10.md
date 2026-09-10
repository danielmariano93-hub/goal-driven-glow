# Divisão do Rolê — comunicação completa do parcelamento

## O que está errado hoje (confirmado no caso real)

A divisão "Teste" (R$ 560,00, participante Teste com parte de R$ 280,00) está corretamente parcelada no banco:

| Parcela | Valor | Vencimento |
| --- | --- | --- |
| 1/3 | R$ 93,34 | 30/09/2026 |
| 2/3 | R$ 93,33 | 30/10/2026 |
| 3/3 | R$ 93,33 | 30/11/2026 |

Mas o convite enviado falou apenas "Sua parte é R$ 280,00. A primeira parcela vence em 30/09/2026".

Causa raiz confirmada: o convite dessa divisão foi criado sem vínculo com nenhuma parcela (verificado no banco: o job de convite está sem `installment_id`, enquanto os lembretes de vencimento têm). Como o disparador só busca a parcela quando existe esse vínculo, ele trata o convite como se fosse pagamento único, cai no valor cheio e usa a data da divisão, não a agenda. O texto do convite também não tem espaço para uma agenda — só para "em 3x" e uma primeira data.

## O que vai mudar

1. **Convite passa a ler a agenda inteira.** Para o convite, o disparador vai buscar todas as parcelas daquela pessoa na fonte canônica (`split_receivables_v1`), ordenadas por número, sem depender do vínculo de parcela do job.
2. **Nova agenda no texto.** Um campo novo `{{installment_schedule}}` montado linha por linha a partir das parcelas canônicas — nada é calculado no texto:
   ```text
   • *1/3 — R$ 93,34* · vence em *30/09/2026*
   • *2/3 — R$ 93,33* · vence em *30/10/2026*
   • *3/3 — R$ 93,33* · vence em *30/11/2026*
   ```
   Convite parcelado informa: valor total da pessoa, quantidade de parcelas, valor de cada uma e vencimento de cada uma. Valores diferentes entre parcelas aparecem exatamente como estão no banco.
3. **À vista continua natural.** Com uma única parcela: "Sua parte é R$ 280,00, com vencimento em 30/09/2026" — sem linguagem de parcelamento.
4. **Lembretes individuais preservados.** `reminder`, `due_soon`, `due_today`, `overdue` e confirmação de pagamento continuam falando só da parcela relevante, sem repetir a agenda.
5. **Participante consegue consultar pelo WhatsApp.** As respostas ao participante passam a ler as parcelas canônicas dele, respeitando pago/parcial/pendente:
   - "quais parcelas?" → agenda completa com estado de cada uma (paga, parcial com saldo, pendente);
   - "qual a próxima?" → só a próxima em aberto;
   - "quanto falta?" → soma dos saldos em aberto (nunca o valor cheio quando já houve pagamento);
   - "quanto pago esse mês?" → só as parcelas do mês corrente;
   - "quando vence?" → vencimento da próxima parcela em aberto.
6. **Nino de quem criou a divisão.** A capacidade de ler recebíveis parcela por parcela já existe e já está registrada; vou validar por conversa real que perguntas como "como ficou a divisão Teste?", "quais parcelas do Teste?", "quanto tenho para receber em outubro?" e "quem está atrasado?" chegam nela, e corrigir o roteamento se não chegarem.
7. **Criar divisão parcelada falando com o Nino.** Hoje a criação por conversa só aceita título, total, uma data e as pessoas — sem parcelamento. Vou estender para número de parcelas, primeira data com recorrência mensal e parcelas com valores/datas personalizadas, sempre com rascunho + confirmação como já é hoje.
8. **Rastreabilidade.** Cada mensagem de divisão passa a registrar divisão, participante, tipo, parcela (quando individual), total de parcelas, quantas linhas de agenda foram carregadas, a fonte canônica usada, o texto final e o status de entrega — para provar que um convite parcelado carregou N parcelas.

Nada da verdade financeira muda: as tabelas de divisão, participantes, parcelas e pagamentos continuam como estão; a fonte de leitura continua a mesma view canônica. A correção é de consumo e comunicação.

## Detalhes técnicos

- `supabase/functions/split-reminders-dispatch-v2/index.ts`: em `kind === "invite"`, carregar `split_receivables_v1` por `participant_id` (todas as linhas, `order by installment_number`); manter a busca por `installment_id` para os demais kinds; `installment_schedule` e `installments_sentence` derivados dessa lista; `first_due_sentence` passa a usar a primeira parcela canônica, não `shared_expenses.due_date`; datas via `formatCivilBR` (sem timezone).
- `supabase/functions/_shared/agent/messageTemplates.ts`: template `invite` reescrito com `{{installment_schedule}}` e ramo à vista; defaults dos outros kinds inalterados; contexto administrável (`split_invite`) continua tendo precedência.
- Novo helper puro (ex. `supabase/functions/_shared/split/installmentSchedule.ts`) para montar agenda e resumo a partir das linhas canônicas — reutilizado pelo dispatcher e pelo pipeline do participante, garantindo formatação única.
- `supabase/functions/_shared/split/participantPipeline.ts`: `detectParticipantIntent` ganha intenções `asking_schedule`, `asking_next`, `asking_month`; respostas passam a consultar `split_receivables_v1` do participante em vez de `participant.amount_due` + `shared_expenses.due_date`.
- `supabase/functions/_shared/agent/tools.ts`: `create_split_expense_draft` ganha `installments` (2–24), `first_due_date`, `installment_schedule` opcional (valor + data por parcela) com validação de soma; `list_split_receivables` ganha filtros de mês/atraso para as perguntas do dono. Registro em `CapabilityRouter`/`CapabilityRegistry` revisado.
- Bump de `AGENT_RUNTIME_VERSION` e redeploy atômico das funções listadas em `DEPENDENTS.md` (pendente de autorização).

## Testes

Atualizar `src/test/split-message-context.test.ts` (o teste atual de convite parcelado exige só "em 3x" e a primeira data) e `src/test/split-delivery-tracking.test.ts`, mais um arquivo novo para o pipeline do participante:

- A: convite 3x de R$ 280 contendo as três linhas com valores e datas exatos;
- B: parcelas personalizadas (100/10-10, 70/20-11, 110/05-01) preservadas literalmente;
- C: à vista sem linguagem de parcelamento;
- D: "quais parcelas?" retorna todas;
- E: "qual a próxima?" retorna só a próxima aberta;
- F: parcela paga não entra no saldo;
- G: pagamento parcial responde só o saldo restante;
- H: lembrete individual não repete a agenda;
- I: datas civis sem deslocamento de dia.

## Validação E2E

1. Leitura da divisão real `457c02e5-ff15-4569-8462-ee1ee81f1dbc` — só leitura, sem reenviar convite ao participante — confirmando parte de R$ 280,00 e as três parcelas.
2. E2E em fixture/usuário de teste (transação com rollback) gerando o convite novo e provando as três linhas na mensagem final, mais uma consulta "quais são minhas parcelas?".
3. Suíte completa, typecheck, guardas e build.

## Entrega

Relatório final com causa raiz, arquivos alterados, exemplo antes/depois, dados canônicos usados, testes adicionados e total aprovado, prova do convite parcelado, prova da consulta do participante e confirmação de que os lembretes individuais seguem por parcela.
