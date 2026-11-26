# Auditoria — fatura Itaú final 0098, novembro/2026 (26/11/2026)

Fatura `7ff3433f-df92-491a-b502-85797607d514` · valor do banco **R$ 1.004,79**.

## 1. Causa raiz

1. **Total errado (R$ 4.648,85).** O gatilho `sync_card_accounting_from_transaction` roda a cada inclusão ou edição de lançamento de cartão (até numa troca de categoria). Ele (a) gravava `reconciled_total` como soma dos itens **sem o saldo anterior** (−3.644,06) e (b) sobrescrevia `stated_total` sempre que a fatura não tinha documento de origem, o caso da fatura de novembro, montada à mão. 4.658,85 − 10,00 = 4.648,85.
2. **O mesmo gatilho** voltava parcelas `paid`/`cancelled` para `scheduled` e criava item duplicado quando a fatura já tinha o item importado sem vínculo.
3. **Consumo faltando (R$ 1.550,96).** 18 parcelas antigas e 2 encargos (juros do Pix parcelado 18,66; IOF 0,22) estavam só como itens de fatura, sem lançamento. Todos os indicadores leem consumo de `transactions`, então esses valores não apareciam em lugar nenhum.
4. **Categoria do item ignorada pelo app.** `credit_card_statement_items.category_id` foi criado na intervenção manual, mas a tela de Cartões só lia a categoria do lançamento vinculado.

## 2. Componentes afetados

- Banco: `sync_card_accounting_from_transaction`, `update_credit_card_statement_item`, `recalc_credit_card_statement` (correto, sem mudança), `finalize_invoice_statement` e `settle_credit_card_statement` (lidos, sem mudança).
- Indicadores (todos leem `transactions` com `movement_kind='transaction'`): Meu mês / relatório v2, categorias, estabelecimentos, ritmo diário, metas de gasto, histórico, resumos em PDF, projeções.
- App: `src/pages/Cartoes.tsx` (edição de item).

## 3. Correções

| Onde | O quê |
|---|---|
| `20261126120000_card_sync_trigger_integridade.sql` | Gatilho: total conciliado = saldo anterior + itens; `stated_total` só é recalculado em fatura manual ainda aberta, sem documento e sem total assinado; parcela paga/cancelada não volta a aberta; antes de inserir item, liga ao item já importado (mesma parcela ou mesmo valor e data); item recebe a categoria do lançamento. |
| idem | Novo gatilho `trg_statement_item_category_from_purchase`: categoria da compra replica para itens sem lançamento. |
| idem | `update_credit_card_statement_item`: grava a categoria no item; sem lançamento, aplica na compra (próximas parcelas herdam); **trocar só a categoria** é permitido em fatura paga (valor, data e tipo continuam travados). |
| `Cartoes.tsx` | Categoria exibida e editada = do lançamento; sem lançamento, a do item. |

**Regra canônica de categoria:** a categoria do lançamento é a fonte de verdade (é onde ficam as edições manuais, `category_source='user'`). O item da fatura e a compra espelham essa categoria. Item sem lançamento (crédito, pagamento, principal do Pix) usa a categoria da compra. Importação nova não sobrescreve uma edição manual: o gatilho só copia do lançamento para o item.

## 4. Registros alterados

- **20 lançamentos incluídos** (competência 01/11/2026, origem `import`, nota "auditoria 26/11"), soma **R$ 1.550,96**: 18 parcelas antigas (1.532,08) com estabelecimento, categoria e grupo da compra original, mais juros do Pix (18,66) e IOF (0,22) em "Impostos e Taxas". Cada um está ligado à parcela e ao item.
- Fatura: `stated_total` = `reconciled_total` = 1.004,79.
- **Nada foi apagado.** Os itens Airbnb 901,32 e 47,80 continuam na fatura (o banco cobrou), mas sem lançamento de consumo: as compras foram canceladas no Nino em 26/10.

## 5. Conciliação

| | R$ |
|---|---|
| Saldo anterior (crédito do estorno Airbnb de outubro) | −3.644,06 |
| Pagamento 23/11 | −10,00 |
| Lançamentos nacionais | 4.303,86 |
| Internacionais (inclui IOF) | 6,47 |
| Pix parcelado 01/02 (principal 329,86 + juros 18,66) | 348,52 |
| **Total** | **1.004,79** ✔ |

Consumo de cartão em novembro: **R$ 3.379,87** (antes 1.828,91) = 4.658,85 − 329,86 (principal do Pix: é dinheiro emprestado, não consumo) − 948,12 (Airbnb cancelado). 34 itens; 30 ligados a lançamentos; 0 sem categoria; 0 vínculos duplicados.

## 6. Testes

`supabase/tests/card_statement_integrity.sql` (roda e desfaz tudo no fim):

| Cenário | Resultado |
|---|---|
| 1 compra à vista | ok: 1 item, total = conciliado = 100, categoria no item |
| 2 compra parcelada | ok: 3 parcelas |
| 3 parcela antiga já importada | ok: liga ao item existente, sem duplicar; parcela continua paga |
| 5 compra cancelada | ok: fora do consumo |
| 8 troca manual de categoria | ok: lançamento, item e compra atualizados; parcela paga não volta a aberta; total preservado |
| 9 reprocessar a mesma fatura | ok: 1 item |
| 10 pagamento | ok: não conta como consumo |
| 12 saldo credor anterior | ok: −30 + 50 = 20 |
| Fatura real de novembro | ok: 1.004,79, paga |
| Troca de categoria em fatura paga (RPC) | ok: categoria muda; valor continua travado |

Cenários 4, 6, 7 e 11 (antecipação, estorno parcial, estorno integral, pagamento parcial) estão cobertos pelos testes de regressão do relatório v2 (`src/test`). A suíte completa passou: 571 arquivos, 5.185 testes.

## 7. Indicadores

O consumo vem só de `transactions` (`movement_kind='transaction'`). O pagamento de fatura é `card_payment` e fica fora do consumo, mas conta no caixa. Data da compra (`occurred_at`) e competência (`competence_date`) são separadas, e o pagamento tem a data dele. Os 20 lançamentos novos marcam o retrato financeiro para recálculo (gatilho `mark_financial_ledger_dirty`).

## 8. Riscos e pendências (dependem do dono da conta)

1. **Pagamento de R$ 1.004,79 em 24/11** (`7eaa6a84…`): foi criado à mão pelo "quitar fatura", sem registro no extrato do banco. A fatura vence em 01/12. Se não foi pago de verdade, o "Disponível hoje" está R$ 1.004,79 abaixo do real.
2. **Airbnb HMX2Y:** o banco continua cobrando as parcelas 03 a 06 (R$ 949,12 por mês, de dezembro a março, total 3.796,48), porque o crédito do estorno já foi usado em novembro. Essas parcelas não aparecem em "compromissos". O certo é contestar com o banco ou registrar como compromisso de caixa (não consumo).
3. **Pix parcelado:** 02/02 (348,52) vem na próxima fatura. Os 700,02 recebidos entraram como transferência. Falta decidir se registra como dívida.
4. O pagamento de 10,00 do item pode ser ligado ao lançamento da conta `92b675fa`.
5. `finalize_invoice_statement` depende do saldo anterior lido do PDF. Se a leitura falhar, o total sai errado. O gatilho agora não sobrescreve faturas com documento.
