# Nino: respostas padronizadas com evidência + alertas reais de dívida

Cinco entregas em um único bloco: formato canônico de resposta, prompt consultivo, forecast v2 completo, registro das novas tools dos motores e o alerta de vencimento/atraso de dívida que hoje não existe.

## 1. Formato canônico de resposta (evidência + delta + confiança)

Toda resposta analítica do Nino passa a ter a mesma estrutura, montada a partir do envelope das tools — nunca escrita à mão:

```text
<frase de resultado com o número principal>
<delta explicado: o que explica a variação, com os drivers da tool>
<base: período, nº de lançamentos, confiança>
```

- Novo módulo `supabase/functions/_shared/agent/answerFormat.ts` com `describeEvidence(envelope)` e `describeDelta(drivers)`, que traduzem `EngineEvidence`/`Provenance` (período, `sample_size`, `formula_version`, `confidence`, exclusões) em uma linha curta em pt-BR.
- Cada tool analítica devolve o envelope completo; o formatador é chamado no prompt como contrato obrigatório: se a tool não trouxe evidência, o Nino diz que não tem base suficiente em vez de responder.
- `confidence: insufficient_data` vira frase honesta ("ainda estou aprendendo seu ritmo, tenho só N registros"), sem número projetado.

## 2. Prompt consultivo reescrito

Reescrita da seção analítica do `DEFAULT_SYSTEM_PROMPT` em `supabase/functions/_shared/agent/prompt.ts`:

- Tabela de roteamento explícita "pergunta → motor": onde o dinheiro escapa, estabelecimento, assinaturas/recorrências, fixo x variável, mudança de comportamento, anomalias, economia possível, evolução, previsão, dia da semana, metas.
- Proibição reforçada de qualquer cálculo próprio (nenhuma soma, subtração, percentual ou data derivada no texto) e obrigação de citar a base/confiança da tool.
- Padrão de narrativa em 3 partes (resultado → explicação do delta com drivers → base), no tom do exemplo desejado: "seus gastos aumentaram R$ 480; Alimentação explica R$ 290, sobretudo iFood (+R$ 170)".
- Regras já existentes de vocabulário, glossário patrimonial e rascunho/CONFIRMAR permanecem intactas.

## 3. Forecast Engine v2 real (`low`/`high`/`backtest`/`seasonal`)

Hoje `forecast_month_close` devolve `low: null`, `high: null`, `backtest_summary: null` e `seasonal_adjust: 0`, mesmo com o motor `analytics/forecast.ts` já calculando banda de confiança, backtest walk-forward e fator sazonal.

- A tool mantém o ponto central do snapshot canônico v8 (Home e WhatsApp continuam idênticos) e passa a compor com `computeForecast` para preencher: banda `low/high`, `backtest_summary` (wape, bias, meses de amostra) e `seasonal_adjust`.
- `model_used` reporta os dois níveis: contrato do snapshot + modelo estatístico usado na banda.
- Quando não houver amostra para banda/backtest (menos de 30 dias com movimento ou menos de 2 meses fechados), os campos vêm `null` acompanhados de nota explícita na provenance — nunca zero disfarçado de certeza.
- Regras contábeis intactas: transferência, aplicação/resgate e pagamento de fatura não entram.

## 4. Registro das novas tools dos motores

Os motores criados (`merchantIntelligence`, `behaviorChange`, `recurringDiscovery`, `costStructure`, `savingsOpportunities`, `financialEvolution`, `anomalies`) já existem espelhados em `_shared/finance-core/`, mas o Nino não consegue chamá-los. Registro em `supabase/functions/_shared/agent/tools.ts`:

| Tool | Motor | Responde |
| --- | --- | --- |
| `analyze_merchants` | merchantIntelligence | onde/em quem o dinheiro sai, ranking líquido de estorno |
| `merchant_profile` | merchantIntelligence | perfil de um estabelecimento (ticket, frequência, dia) |
| `explain_behavior_change` | behaviorChange | delta decomposto em frequência x ticket x novos estabelecimentos |
| `discover_recurring` | recurringDiscovery | assinaturas e cobranças repetidas detectadas |
| `analyze_cost_structure` | costStructure | fixo/estrutural x flexível |
| `find_savings_opportunities` | savingsOpportunities | onde há economia realista, com valor |
| `analyze_financial_evolution` | financialEvolution | 30/90/180 dias, melhora ou piora |
| `detect_spending_anomalies` | anomalies | gastos fora da banda pessoal |

Cada tool: schema estrito, execução determinística sobre os fatos do usuário, retorno com `facts` + `drivers` + `evidence` + `confidence` no envelope canônico, e descrição escrita para roteamento correto pelo modelo.

## 5. Alerta de vencimento e atraso de dívida

Hoje só existe o detector `debt_progress` (conquista). Não há sinal de parcela vencendo nem de dívida em atraso quando o pagamento não é registrado.

- Novo motor `src/lib/engine/debtStatus.ts` (espelhado em `finance-core/`): a partir de `debts` (due_day, installment_amount, installments_total/paid, outstanding_balance, status) e `debt_payments` (paid_at, installments_covered), calcula por dívida: próxima parcela, dias até vencer, parcelas esperadas até hoje x cobertas, valor e dias em atraso, e confiança (dívidas com `accounting_method='open_balance'` sem parcela definida ficam `insufficient_data` em vez de gerar alarme falso).
- Nova migration com dois detectores no core de situação (`nino_financial_situation_core`): `debt_due_soon` (parcela vence em até N dias, sem pagamento registrado no ciclo — severidade `attention`) e `debt_overdue` (ciclo vencido sem pagamento — severidade `critical`), ambos mapeados para `kind='risk'`, com `dedup_key` por dívida + mês de competência para não repetir e para fechar sozinho quando o pagamento é registrado.
- Ação real no card: CTA leva para a dívida em `/app/dividas` com o formulário de pagamento aberto, reaproveitando `diagnosisRouteForSituation`.
- Comunicação: os dois novos tipos entram nos kinds permitidos para app e WhatsApp, respeitando a política de dedupe e janela de envio existente.
- Nova tool `get_debt_status` para o Nino responder "estou atrasado em alguma dívida?" com fatos e evidência.

## Notas técnicas

- Espelhamento App → Edge por `scripts/sync-finance-core.mjs` (novos módulos incluídos); teste de paridade obrigatório.
- Testes: formatação de evidência, forecast com/sem amostra para banda e backtest, cada tool nova com caso vazio e caso com dados, e o motor de dívida (em dia, vence em 3 dias, 1 ciclo atrasado, 2 ciclos atrasados, dívida sem parcela).
- Redeploy das Edge Functions afetadas (`agent-chat`, `agent-run`, `whatsapp-webhook`, `nino-intelligence-tick`, `agent-proactive-tick`) + aplicação da migration.
- Sem alterações de identidade visual, autenticação ou publicação em produção.
