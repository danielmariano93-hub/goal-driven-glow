# Relatórios v2 — rastreio dos 23 indicadores

Versão do cálculo: `report_v2.1` (módulo puro `src/lib/engine/reportV2.ts`, espelho em `supabase/functions/_shared/finance-core/reportV2.ts`, carregadores em `supabase/functions/_shared/reportsDashboard/runtimeV2.ts`, ação `report_v2` do `nino-insights`).

## Decisão de fonte (não há motor paralelo)

| Necessidade | Fonte usada | Por quê |
|---|---|---|
| Consumo, categorias, estabelecimentos, dia da semana, histórico | Livro canônico `transactions` via `loadExecutiveInput`/`toLedger` (competência, estornos, sem transferência/fatura/investimento) | É a mesma regra do CSV, do painel antigo e do Nino; as tabelas de fatos por dia/categoria (`financial_daily_facts`, `financial_daily_category_facts`) estão desatualizadas (jobs parados) e `behavioral_transaction_facts` classifica por dica de nome e trata pagamento de dívida como consumo |
| Principal x juros da dívida | `debt_payments` (`amount_applied`, `interest_amount`, `fee_amount`, `transaction_id`) | Única fonte que separa os dois |
| Saldo, compromissos, projeção de caixa, patrimônio, metas | `financial_current_snapshots.payload.snapshot` (só se for de hoje) | É a conta da Home; o relatório não recalcula caixa |
| Poupança sustentável, recuperável | `financial_profile_snapshots` (mais recente) | Cálculo canônico do perfil |
| A receber | `split_receivables_v1` (`state`: pending/overdue/paid) | Separa a vencer, vencido e recebido |
| Padrões | `behavioral_patterns` (validated; candidate com confiança ≥ 60%) | Evidência já calculada |
| Compromissos 6 meses | `credit_card_installments` + `debts` + `recurring_rules` | Só o que já está contratado |

## Definições (todas em reais, centavos preservados no cálculo)

- **Consumo** = despesas do período por competência (cartão pelo mês da fatura) − estornos. Fora: transferências, pagamento de fatura, aplicações e o **principal** de dívida. Dentro: juros e encargos **conhecidos** (`debt_payments`). Pagamento de dívida sem separação fica inteiro fora e é declarado em Qualidade; juros desconhecidos não são inventados. Lançamento em categoria de dívida/empréstimo/financiamento sem registro de pagamento de dívida (ex.: Pix para financeira) é tratado como pagamento de dívida sem separação.
- **Classes** (partição exclusiva, somam o consumo): estrutural (categoria de moradia, saúde, contas, educação, parcelas etc.), ajustável, extraordinário (compra ≥ max(R$ 500, Q3 + 3·IQR do histórico), só com 12+ compras de referência) e sem categoria (inclui estorno sem categoria, que é negativo). Fixo ≠ essencial; ajustável ≠ supérfluo.
- **Habitual** = mediana do consumo dos até 6 meses anteriores na mesma janela de dias (mínimo 2 meses; aviso com menos de 3).
- **Resultado** = receitas realizadas − consumo. Com a renda do mês ainda não recebida (< 50% da típica) é **parcial**, mostrado com o valor e a renda prevista.
- **Dia da semana** = consumo ajustável naquele dia ÷ nº de dias daquele tipo no período (incluindo dias sem gasto). Mostra amostra, histórico equivalente e se o padrão se repete nos meses de referência.
- **Pequenos gastos** = compras líquidas ≤ R$ 50 fora do estrutural (limiar único, igual ao das tabelas de fatos).
- **Projeção de consumo** = realizado + obrigações de consumo por vencer (recorrência/planejado; parcela de dívida não entra) + ajustável esperado (mediana dos meses de referência × ritmo do mês, 0,6–1,4). Faixa = percentis 25–75.
- **Saldo esperado** = saldo hoje + receitas previstas − obrigações até o fim do mês − fatura do mês − consumo variável previsto (a mesma conta da Home, em centavos). Cenário conservador tira a receita não configurada. A receber de terceiros nunca entra.
- **Compromissos** = agenda do snapshot até o horizonte; fatura do mês sem item na agenda entra como estimativa. **Renda comprometida** = compromissos ÷ renda mensal informada no perfil (ou mediana dos meses anteriores, rotulado).
- **Recomendações**: cada ação tem baseline, premissa, impacto estimado e confiança; ordenadas por urgência de caixa e impacto × confiança; **sem total agregado** (as ações se sobrepõem).

## Matriz

| # | Indicador | Fonte | Período | Cobertura/limite |
|---|---|---|---|---|
| 01 | Consumo | livro + `debt_payments` | mês até hoje | ponte despesas − estornos = consumo |
| 02 | Habitual/desvio | livro | 6 meses, mesma janela | mediana; ≥ 2 meses |
| 03 | Receitas | livro (income) | mês | recorrente = categoria presente em 3+ meses |
| 04 | Resultado | derivado de 01 e 03 | mês | parcial se renda pendente |
| 05 | Saldo | snapshot do dia | hoje | indisponível sem snapshot fresco |
| 06 | Curva acumulada | livro | mês | habitual + projeção com faixa |
| 07 | Categorias/estabelecimentos | livro | mês vs mês anterior/ano anterior (mesmos dias) | estabelecimento reconhecível apenas |
| 08 | Estrutural x ajustável | livro | mês | partição exclusiva |
| 09 | Fatores de mudança | livro | mês vs habitual | resíduo declarado (medianas não somam) |
| 10 | Dia da semana | livro | mês + histórico | mínimo 14 dias |
| 11 | Pequenos gastos | livro | mês | ≥ 5 compras |
| 12 | Padrões | `behavioral_patterns` + sinais do livro | histórico | amostra mínima; sem inferir motivo |
| 13 | Projeção de consumo | livro + agenda | mês | só mês corrente, ≥ 2 meses de base |
| 14 | Projeção de caixa | snapshot | até fim do mês | conservador sem receita incerta |
| 15 | Compromissos | snapshot + parcelas/dívidas/recorrências | 30 dias e 6 meses | só contratado |
| 16 | Renda comprometida | 15 ÷ renda informada | 30 dias | base rotulada |
| 17 | A receber | `split_receivables_v1` | hoje | a vencer/vencido/recebido no mês |
| 18 | Poupança sustentável | perfil | meses fechados | zero real ≠ histórico curto ≠ cálculo velho |
| 19 | Recuperável | perfil | mensal | partes proporcionais somam o total |
| 20 | Resultado histórico | livro | 6 meses | mês aberto tracejado |
| 21 | Patrimônio | snapshot + perfil | hoje + série mensal | ativos − passivos, data de referência |
| 22 | Metas | snapshot | período da meta | utilização + projeção + veredito |
| 23 | Recomendações | 07, 11, 10, 19 e situações | mês | sem agregado |
