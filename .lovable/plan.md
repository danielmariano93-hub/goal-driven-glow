# Fatura de cartão: fechamento e vencimento deixam de ser a mesma coisa

## O que eu confirmei nos dados

- Seu cartão está configurado com **fechamento dia 25** e **vencimento dia 30**.
- A fatura registrada está como **competência ago/2026 com vencimento 03/08** (status pago, R$ 4.636,08). O documento de origem trazia `fechamento 25/07` e uma data `03/08` gravada como vencimento.
- O finalizador de fatura **ignora completamente a data de fechamento**: ele deriva a competência do *mês do vencimento*. Como o PDF trouxe 03/08, a fatura do ciclo de julho virou "agosto".
- A tela de conferência reforça o erro: ao salvar um vencimento, ela grava `competência = mês do vencimento`.
- Já existe no banco a função de ciclo `card_cycle_for(fechamento, data, vencimento)`, que devolve fechamento, vencimento e competência corretos — e não está sendo usada nesse fluxo.

Resumo: o sistema tratou fechamento, vencimento e competência como um único conceito. Fatura que fecha 25/07 e vence 30/07 é fatura de **julho**, mesmo que apareça uma data de agosto no documento.

## Como vai passar a funcionar

### 1. O ciclo do cartão é a verdade
A competência passa a ser derivada da **data de fechamento** (do documento, ou do fim do período quando o documento não informa), via ciclo real do cartão. O vencimento sai do `due_day` do cartão dentro daquele ciclo. Fechamento 25/07 + vencimento dia 30 → vence 30/07, competência jul/2026.

### 2. Divergência de vencimento é perguntada, não adivinhada
Quando o documento traz uma data de vencimento diferente da que o ciclo do cartão calcula, nada é gravado por palpite. Na conferência aparecem os dois campos separados — **Fechamento** e **Vencimento** — com as duas opções lado a lado ("do documento: 03/08" · "do cartão: 30/07") e o aviso de qual competência cada escolha gera. Só depois da sua escolha a fatura é finalizada.

### 3. Extração aprende a diferença
A leitura do PDF passa a distinguir explicitamente fechamento/emissão de vencimento e nunca usa um no lugar do outro. Sem vencimento legível, ele fica vazio e o ciclo do cartão resolve — em vez de herdar a data de fechamento.

### 4. Correção auditada da fatura já registrada
A fatura de ago/2026 vira **competência jul/2026 com vencimento 30/07**, mantendo itens, pagamentos e status. Nada é apagado: a mudança fica registrada na auditoria de conciliação, com valor antes e depois.

### 5. Efeito nas projeções
Com a competência certa, "fatura a vencer no mês" e a previsão de fechamento deixam de contar essa fatura em agosto. O app e o WhatsApp continuam lendo o mesmo snapshot canônico, então os dois passam a mostrar o mesmo número.

## Detalhes técnicos

- Migration `invoice_cycle_truth.v2` sobre `finalize_invoice_statement`:
  - cascata de âncora de fechamento: `invoice_closing_date` → `period_end` → hoje;
  - competência e vencimento derivados por `card_cycle_for(closing_day, âncora, due_day)`, substituindo o cálculo atual baseado no mês do vencimento;
  - vencimento explícito confirmado pelo usuário (`invoice_due_date` + `invoice_competence_month`) continua prevalecendo, com a guarda atual de "fatura já registrada/paga" intacta;
  - novo retorno `due_date_conflict` quando o documento traz vencimento incompatível com o ciclo e o usuário ainda não escolheu: o finalizador não grava e devolve as duas datas com as competências correspondentes.
- `assistant-review-actions`: mapeia `due_date_conflict` para uma mensagem clara e passa a aceitar `invoice_closing_date` como patch validado (já está na allowlist).
- `ReviewSheet.tsx`: campo de **Fechamento** ao lado do de **Vencimento**; chips de escolha quando há divergência; salvar deixa de derivar competência do mês do vencimento e grava a competência que o ciclo devolve.
- `assistant-ingest-document`: instrução de extração separando `closing_date` de `due_date`, com descarte do vencimento quando ele é igual à data de fechamento/emissão.
- Correção de dados (via operação de dados, com auditoria em `financial_reconciliation_audit`): `credit_card_statements` da competência 2026-08-01 do cartão Itaú → `competence_month = 2026-07-01`, `due_date = 2026-07-30`.
- Testes: ciclo 25/30 com fechamento 25/07 gerando jul/2026 e 30/07; documento com vencimento 03/08 gerando conflito em vez de gravar agosto; vencimento escolhido pelo usuário prevalecendo; fatura paga de outro documento continuando protegida.
- Sem mudança em autenticação, ledger de lançamentos ou motores financeiros além da competência da fatura.
