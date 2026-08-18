# Correção do Plano do Nino por categoria: merchant exclusivo, projeção por natureza e copy por estado

## Auditoria — o que alimenta cada número hoje

| Bloco na tela | Origem real hoje | Situação |
| --- | --- | --- |
| Gasto atual, teto, margem, ritmo, projeção, R$/dia, corte/dia | `evaluateCategoryGoal` em `src/lib/engine/metrics.ts` | Projeção é sempre linear (`actualSpend + ritmo × dias restantes`), `projectionMethod` fixo em `"linear"` para toda categoria |
| "Onde o dinheiro está indo" (hotspots) | `buildStrategyForCategoryGoal` em `src/lib/goals/strategyInputs.ts` | Agrupa por texto cru: `tx.merchant_name \|\| tx.description`. Não usa a camada canônica `normalizeMerchant`/`buildMerchantResolver` de `src/lib/engine/merchant.ts` |
| Percentuais dos hotspots | mesmo arquivo | Denominador é o total líquido de estornos, enquanto os valores exibidos são brutos → percentuais podem passar de 100% |
| Passos, Alternativas, Próximo passo, headline | `buildCategoryGoalStrategy` em `src/lib/engine/categoryGoalStrategy.ts` | Copy única para estados diferentes; "mantém o excesso em R$ 0,00" nasce de `Math.max(currentOverage, 0)` quando só existe excesso **projetado**; "Revisar o teto" é sugerida sempre que há qualquer excesso, inclusive em meta de redução |
| Superfícies | `src/pages/Metas.tsx`, `src/pages/MetaCategoriaDetalhe.tsx` | O motor **não** está espelhado em `supabase/functions/_shared/finance-core/`, então assessor/WhatsApp não compartilham este plano |

Confirmado nos dois casos reais do pedido:

1. **Transporte > 100%** — duas causas somadas: (a) variantes cruas (`ON UBER TRIP H01/08`, `PAY 99 TE 09/08`) viram merchant próprio ao lado do canônico; (b) denominador líquido de estorno com valores brutos no numerador.
2. **Assinaturas** — a projeção linear ignora `recurringDiscovery`/`commitmentAgenda`, que já existem no projeto e sabem quais cobranças ainda caem no período.

## O que será corrigido

### 1. Distribuição de merchant mutuamente exclusiva (camada canônica)

- A agregação de hotspots passa a usar a identidade canônica única já existente (`buildMerchantResolver` + `normalizeMerchant` + `merchantLabel`): uma transação pertence a exatamente um merchant. Variantes cruas deixam de existir como linha própria — em qualquer superfície.
- O share passa a ser sempre `valor do merchant / total real da categoria no período`, com numerador e denominador na mesma base (líquida de estorno), e linha **"Outros"** = total menos os merchants exibidos, nunca negativa.
- Invariantes validadas no próprio motor (não na UI): soma dos valores ≤ total da categoria e soma dos percentuais ≤ 100%, com tolerância de centavos.

### 2. Projeção por natureza da categoria

Nova política determinística de projeção, com método declarado:

- **flow** (consumo contínuo: transporte, alimentação, lazer): ritmo observado + compromissos conhecidos. R$/dia continua fazendo sentido.
- **commitment** (assinaturas, aluguel, academia, seguros): projeção = gasto confirmado + cobranças recorrentes ainda esperadas até o fim do período. Nada de extrapolação diária.
- **hybrid**: recorrentes conhecidos + projeção apenas da parcela variável.
- **insufficient_data**: sem projeção afirmativa.

A classificação sai de evidência do próprio ledger (frequência, regularidade de datas/valores, origem `recurring` e agenda de compromissos), não de lista fixa de nomes de categoria. Cada projeção carrega `projection_method`, os componentes (`confirmed_spend`, `remaining_known_commitments`, `variable_projection`, `projected_total`) e `confidence` (high/medium/low), com a reconciliação exata dos componentes com o total.

No caso Assinaturas: R$ 715,78 confirmados + recorrências esperadas → projeção próxima de R$ 805,78, e não R$ 1.232,79.

### 3. Estados da meta e copy correspondente

Estados explícitos: `under_budget`, `on_track`, `under_budget_but_at_risk`, `over_budget`, `low_confidence` (mais os já existentes: agendada, pausada, período encerrado).

- Excesso atual e excesso projetado ficam separados em toda a copy. Nunca "você está R$ 360,62 acima" quando o gasto atual está dentro.
- "Segurar o resto do período" ganha texto por estado: dentro do teto → "sem novas cobranças você fecha com R$ 156,39 de margem"; risco pela projeção → "seria necessário evitar/reduzir R$ X das cobranças previstas"; já estourado → "o teto foi ultrapassado em R$ X".
- A frase "mantém o excesso em R$ 0,00" deixa de ser possível.
- R$/dia e "corte R$ X/dia" aparecem só em categorias de fluxo. Em categorias de compromisso, entram margem restante, cobranças previstas e "quanto de nova cobrança ainda cabe".

### 4. Revisão de teto deixa de ser reflexo

Sugerir aumentar o teto passa a exigir evidência estrutural: 3+ ciclos consecutivos acima, excesso explicado por gasto essencial/compromisso fixo incompatível com o teto, ou baseline da meta comprovadamente incorreto. Em meta com intenção de redução (`percent_reduction`), a revisão só aparece como última alternativa e nunca ancorada no gasto projetado. A ordem passa a ser: explicar a diferença → mostrar os drivers → mostrar a ação possível → só então revisão da meta.

### 5. Alternativas como cenários calculados

Cada alternativa vira cenário com número e efeito: "sem novas cobranças", "mantendo só as recorrências conhecidas", "cancelando o maior recorrente acionável (economia R$ Z)", e — quando justificado — "ajustar a meta". "Comece por X" passa a usar contribuição marginal acionável (participação, frequência, variabilidade, recorrência/essencialidade), não apenas o maior valor.

### 6. Consistência de superfícies

O motor corrigido é espelhado para o backend, de modo que Metas, Plano do Nino, Nino no app, WhatsApp, Home, Insights e relatórios leiam o mesmo resultado. Nenhuma matemática nova na UI; a IA só humaniza texto sobre números já decididos.

## Detalhes técnicos

- `src/lib/goals/strategyInputs.ts`: hotspots passam a resolver merchant via `buildMerchantResolver`/`normalizeMerchant`, com aliases do usuário carregados junto às transações; numerador/denominador na mesma base líquida; linha "Outros" e asserção de invariantes.
- Novo módulo `src/lib/engine/categoryProjection.ts` (`category_projection.v1`): classifica a natureza da categoria e produz `{ method, components, projected_total, confidence }` consumindo `discoverRecurring` e `computeCommitmentAgenda`.
- `src/lib/engine/metrics.ts` (`evaluateCategoryGoal`): passa a consumir esse módulo, expõe `projectionMethod`/`projectionComponents`/`projectionConfidence`, mantém `currentOverage` e `projectedOverage` separados e zera `dailyAllowance`/`requiredDailyReduction` quando o método não é de fluxo.
- `src/lib/engine/categoryGoalStrategy.ts` → `category_goal_strategy.v2`: novo campo `state`, copy por estado, passos e alternativas condicionados a método/estado/intenção da meta, regra de revisão de teto com evidência estrutural.
- UI: `CategoryGoalStrategyCard.tsx`, `CategoryGoalCard.tsx` e `MetaCategoriaDetalhe.tsx` apenas renderizam os novos campos (inclui "Outros" e o rótulo de confiança), sem cálculo local.
- Paridade backend: `scripts/sync-finance-core.mjs` passa a espelhar `goalStrategy.ts`, `categoryGoalStrategy.ts` e `categoryProjection.ts` para `supabase/functions/_shared/finance-core/`; a tool `get_goal_strategy` (`supabase/functions/_shared/agent/tools.ts`) usa o mesmo envelope para metas por categoria.
- Testes (`src/test/category-goals-metrics.test.ts` + novos `src/test/merchant-distribution-exclusive.test.ts` e `src/test/category-projection-policy.test.ts`): os 12 casos do pedido, incluindo Uber/ON UBER TRIP → só Uber, 99/PAY 99 → só 99, soma nunca > 100%, Assinaturas 715 + 100 = 815, estados 715/872 sem "excesso", meta de redução sem sugestão automática de teto maior, e reconciliação exata dos breakdowns.

## Entrega do relatório final

Ao concluir, apresento a matriz Problema / Causa raiz / Arquivo-motor / Correção / Teste / Resultado e a validação E2E dos dois casos reais (Transporte: total, merchants canônicos, somas e percentuais; Assinaturas: gasto, teto, margem, compromissos esperados, método, projeção, excesso atual, excesso projetado e recomendação gerada) com os dados reais da sua conta.
