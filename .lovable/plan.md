# Motores Determinísticos do Nino — `nino_engines.v1`

Objetivo: a LLM deixa de calcular. Cada pergunta cai num motor que devolve **fatos + evidência + confiança**, e a LLM apenas explica, conecta e propõe ação.

## O que foi confirmado no código antes deste plano

- Existe base forte: `src/lib/engine/` (facts, metrics, spendingRhythm, bridges, cardExposure, commitmentAgenda, incomeProjection, spendingSimulation) espelhada em `supabase/functions/_shared/finance-core/` pelo `scripts/sync-finance-core.mjs`.
- **Estornos**: `facts.ts` tem `buildRefundAttribution` e `effectiveCategoryId`, mas os relatórios inteligentes (`src/lib/reports/intelligent/*`, `_shared/reports-core/*`) **não importam nenhum dos dois** — logo, nos relatórios o estorno é atribuído à categoria gravada nele, não à da compra original.
- **Merchant**: nenhum motor financeiro nem os relatórios usam merchant. Normalização de estabelecimento só existe no subsistema comportamental (`_shared/anticipation/facts.ts`, campos `merchant_normalized`/`merchant_canonical` e tabela `merchant_aliases`). Não há motor de estabelecimentos.
- **Previsão**: `_shared/analytics/forecast.ts` já calcula banda de confiança e backtest reais, mas a tool `forecast_month_close` (`_shared/agent/tools.ts`) devolve `low: null`, `high: null`, `backtest_summary: null` enquanto a descrição da tool promete sazonalidade e backtest.
- **Dia da semana**: há `analytics/weekdayTruth.ts` + `intelligence/weekdayTool.ts` (motor novo) convivendo com heurísticas mais simples em `_shared/insights/fallbacks.ts`.
- Atribuição de variação existe só a nível de grupo (`analytics/attribute.ts`), sem decompor frequência x ticket x novo merchant.

## Princípio arquitetural

Todo motor novo nasce **puro** em `src/lib/engine/**` (testável, sem Deno/browser) e é espelhado para as Edge Functions pelo `sync-finance-core.mjs`. Cada motor devolve o mesmo envelope:

```text
{ facts, breakdown[], drivers[], evidence{period, sample_size, exclusions, formula_version}, confidence }
```

Nenhum motor cria lançamento; todos respeitam: `superseded` fora, `movement_kind` excluídos fora, estorno abate a **categoria/merchant da compra original**.

## Fase 0 — Verdade única (pré-requisito)

1. **Estorno universal**: relatórios (`reports/intelligent/engine.ts` + `reports-core`) passam a usar `buildRefundAttribution` + `effectiveCategoryId`. Regra: qualquer "quanto gastei em X" = líquido de estorno.
2. **Merchant canônico compartilhado**: extrair `src/lib/engine/merchant.ts` com normalização determinística (lowercase, remoção de ruído de extrato/POS, aliases de `merchant_aliases`, canônico por consenso) reutilizando as regras já existentes na camada de antecipação — uma só normalização para todo o produto.
3. **Um motor semanal só**: remover as heurísticas simples de dia-da-semana de `_shared/insights/fallbacks.ts` e redirecionar Home, Nino, WhatsApp, relatórios e alertas para `weekdayTruth`.
4. **Metas**: eliminar cálculos paralelos de "ritmo da meta" nos insights; usar somente `evaluateCategoryGoal`/`resolveGoalPeriod`.

## Fase 1 — Merchant Intelligence (`merchant_intelligence.v1`)

`src/lib/engine/merchantIntelligence.ts`. Para um período e comparação:

- por merchant canônico: total líquido, contagem, ticket médio, maior compra, primeira/última ocorrência, estornos, dias/faixas de concentração, delta absoluto e % vs. período anterior;
- ranking "quem mais consome meu dinheiro" e "quais merchants explicam a variação da categoria X";
- consulta pontual: `merchantProfile("uber")` com resolução por alias e sinônimos.

Superfícies: nova tool `get_merchant_profile` e `rank_merchants`; bloco de merchants no relatório inteligente e no diagnóstico do Nino.

## Fase 2 — Behavior Change (`behavior_change.v1`)

`src/lib/engine/behaviorChange.ts`. Decompõe o delta de cada categoria em componentes que somam o total:

```text
delta = efeito_frequência + efeito_ticket + entrada_de_novos_merchants
        - saída_de_merchants + efeito_mix_dia_semana + resíduo
```

Saída: drivers ordenados por impacto em R$, com merchant e dia da semana responsáveis, e resíduo explícito. Substitui o uso solto de `attribute.ts` nas narrativas.

## Fase 3 — Recurring & Subscriptions (`recurring_discovery.v1`)

`src/lib/engine/recurringDiscovery.ts`: descobre compromissos recorrentes a partir do histórico (mesmo merchant canônico, intervalo estável ~mensal/anual, valor estável dentro de tolerância), classifica confiança e devolve:

- catálogo de assinaturas detectadas com valor atual, valor anterior e variação;
- total mensal comprometido em assinaturas;
- **ausências**: cobrança esperada que não apareceu no ciclo;
- **saltos de preço** (ex.: 300 → 480).

Persistência leve para memória/feedback (confirmar/ignorar assinatura), sem duplicar `recurring_rules` cadastradas manualmente — as detectadas são reconciliadas contra elas.

## Fase 4 — Fixed vs Variable / Custo de vida (`cost_structure.v1`)

`src/lib/engine/costStructure.ts`: custo estrutural mensal (moradia, seguros, dívidas, parcelas, assinaturas detectadas, recorrências) x custo flexível médio, com custo mínimo mensal e quanto sobra antes de qualquer decisão de consumo. Alimenta Home, simulação e relatórios.

## Fase 5 — Savings Opportunities (`savings_opportunities.v1`)

`src/lib/engine/savingsOpportunities.ts`: cruza merchants, frequência, ticket, flexibilidade (categoria discricionária vs. estrutural — academia/seguro/dívida nunca entram) e histórico para gerar 3 oportunidades realistas com economia mensal e anual estimadas, ação concreta ("3 pedidos a menos") e, quando há meta ativa, antecipação em meses.

## Fase 6 — Financial Evolution (`financial_evolution.v1`)

`src/lib/engine/financialEvolution.ts`: leitura longitudinal 30/90/180 dias combinando saldo, patrimônio, dívida, fatura, taxa de sobra, compromissos, volatilidade de gastos, capacidade de poupança e metas. Devolve direção (melhor/pior/estável), score comparável e os fatores que mais pesaram para cada lado.

## Fase 7 — Anomalias personalizadas (`anomaly_engine.v1`)

`src/lib/engine/anomalies.ts`: banda pessoal esperada (mediana + MAD) por merchant, categoria, semana e ticket, com amostra mínima. Devolve "não é normal para você" com faixa habitual, valor observado, severidade e recordes históricos (ex.: maior compra de supermercado em 6 meses).

## Fase 8 — Forecast v2 e honestidade da promessa

`forecast_month_close` passa a usar `analytics/forecast.ts` de verdade (banda + backtest + sazonalidade quando houver ≥6 meses) em vez de devolver `null`. Sem histórico suficiente, a resposta declara confiança baixa e omite a banda — a descrição da tool passa a refletir exatamente o que é entregue.

## Fase 9 — Roteamento e prompt

- Registrar todos os motores no `metricRegistry` e no `semanticQuery` para que a intenção do usuário caia no motor certo.
- Novas tools no `_shared/agent/tools.ts`, com envelope de evidência: merchant profile, ranking, behavior change, assinaturas, custo de vida, oportunidades, evolução, anomalias.
- Prompt do agente: proibição explícita de cálculo próprio; obrigação de citar período, amostra e confiança do motor; se o motor devolver amostra insuficiente, o Nino diz isso em vez de estimar.
- `claimValidator` estendido: número presente na resposta que não exista no envelope do motor é bloqueado.

## Detalhes técnicos

- Sem mudança destrutiva de schema; novas tabelas apenas para assinaturas detectadas e feedback do usuário sobre oportunidades (com RLS por `auth.uid()` e GRANTs).
- Testes unitários por motor com casos de estorno, `superseded`, amostra insuficiente e decomposição que precisa fechar no total.
- Espelhamento obrigatório via `scripts/sync-finance-core.mjs` (App e Edge nunca divergem).
- Entrega em blocos: Fase 0 + 1 primeiro (destrava merchants e verdade de estorno), depois 2/3, depois 4–6, por fim 7–9.
