# Reconciliação — consumo de novembro (1–25/11, conta de teste do dono)

Fonte: SQL sobre `transactions` com a regra de competência do app (cartão pelo mês da fatura; demais pela data) e `debt_payments`. Valores em reais.

## Do número anterior ao atual

| Passo | Valor |
|---|---|
| Versão anterior (pagamento de dívida inteiro, sem abater estornos) | 6.757,33 |
| − principal de dívida amortizado (3 lançamentos `debt_payment`) | − 1.739,09 |
| − estornos e reembolsos (4 lançamentos) | − 814,91 |
| = Relatórios v2 (primeira entrega, 25/11 07:44, mostrado como R$ 4.203) | 4.203,33 |
| − Pix para financeiras lançados em "Dívidas e empréstimos" (3 lançamentos, juros desconhecidos) | − 649,48 |
| = Relatórios v2 (esta entrega) | 3.553,85 |
| + gasto de R$ 30,00 lançado em 25/11 (depois do vídeo) | + 30,00 |
| = consumo com o dia 25 incluído | 3.583,85 |

## Lançamentos que mudaram de lado

| Data | Descrição | Valor | Tratamento |
|---|---|---|---|
| 06/11 | Pagamento de dívida: Réveillon- Cartão | 1.566,00 | principal → dívida paga |
| 24/11 | Pagamento de dívida: Banco Sim | 97,06 | principal → dívida paga |
| 24/11 | Pagamento de dívida: Banco Pan | 76,03 | principal → dívida paga |
| 24/11 | Pix QR Code CREDITSEC | 247,33 | categoria de dívida, sem registro de dívida → dívida paga (juros não informados) |
| 24/11 | Pix QR Code 99PAY | 341,62 | idem |
| 24/11 | Pix QR Code 99PAY | 60,53 | idem |
| 02/11 | Reembolso · Ingresso Anitta - Parcela 2 | − 291,33 | estorno abate consumo |
| 06/11 | Reembolso · Divisão Carro RJ | − 116,12 | idem |
| 08/11 | Reembolso · Ingresso Anitta - Parcela 2 | − 291,34 | idem (sem categoria) |
| 11/11 | Reembolso · Divisão Carro RJ | − 116,12 | idem (sem categoria) |

Juros e encargos conhecidos nesses pagamentos: R$ 0,00 (`debt_payments.interest_amount + fee_amount`). Nos últimos 24 meses, 15 pagamentos de dívida (R$ 7.997,43) têm juros e encargos zerados ou sem registro; os que têm registro com juros zero contam como separados, e os sem registro de dívida (como os Pix acima) aparecem como "juros não informados".

## Por que "110%" na composição

As classes eram fixos 1.752 + ajustáveis 1.805 + extraordinários 1.054 = 4.611, contra consumo 4.203. A diferença (−408) era o estorno sem categoria (−407,46), classe negativa que a tela não desenhava. Agora a classe aparece como "Estornos sem categoria" e as partes somam 100% (teste `report-v2-regression`).

## O que não dá para provar daqui

- O habitual passa a cair, porque a mesma regra agora tira o principal de dívida também dos meses anteriores. O novo valor só aparece com o cálculo rodando sobre o histórico completo no servidor.
- Os R$ 7.796 de transferências externas e o saldo de abertura não estão no relatório; o saldo vem do snapshot do dia, não de abertura + entradas − saídas.
