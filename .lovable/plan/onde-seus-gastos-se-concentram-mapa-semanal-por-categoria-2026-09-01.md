# Onde seus gastos se concentram — mapa semanal por categoria

Novo card comportamental na Home: categorias (linhas) × dias da semana (colunas), com intensidade relativa por categoria. Cálculo determinístico no engine canônico, sem tocar em nenhuma verdade existente.

## Posição na Home

Entre "Seu ritmo de gastos" (`RitmoUnificadoCard`) e "O que vem pela frente" (`PrevisaoFechamentoCard`), em `src/pages/Index.tsx`. Mesmo container `max-w-[720px]`, mesmo padrão de card (`rounded-2xl border border-border bg-card p-4`), título `font-display text-[15px] font-bold`, subtítulo em `text-muted-foreground` — idêntico aos cards vizinhos, sem cor nova fora do design system.

## Motor (novo, puro e testável)

`src/lib/engine/categoryWeekdayHeatmap.ts`, `formulaVersion = "category_weekday_heatmap.v1"`.

```
computeCategoryWeekdayHeatmap({ transactions, categories, range, timezone, topCategories? })
```

Regras:
- Lente temporal: **comportamental**. Usa `behavioral_day` quando `behavior_date_confidence >= 0.65`, senão `occurred_at`. Datas de extrato (`bank_posting_date`) entram com o piso de confiança já adotado no runtime comportamental (0,7) e a origem viaja no resultado. Nunca `competence_date`, `due_date` nem `reportingCompetenceDate`.
- Consumo: reutiliza `isRealMonthlyMovement`, `behavioralMetricAmount(t, "expense")`, `buildRefundAttribution` e `effectiveCategoryId` de `src/lib/engine/facts.ts`. Assim transferência, aplicação/resgate, pagamento de fatura, planned/cancelled/superseded e informacionais já ficam fora, e o estorno abate a categoria original (líquido) sem criar "Estornos"/"Outros".
- Denominador: contagem real de ocorrências de cada dia da semana dentro da janela (segunda→domingo, cada coluna com seu próprio denominador). `average = total_líquido / ocorrências_do_weekday`.
- Intensidade: normalizada **por linha** — `intensity = average / max(averages da própria categoria)`, faixas em 5 níveis (0, ≤0,2, ≤0,4, ≤0,6, ≤0,8, ≤1).
- Participação (tooltip): `average do dia / soma dos 7 averages` da mesma categoria.
- Top categorias: 5 maiores por total líquido na janela, excluindo total ≤ 0; "Sem categoria" aparece se estiver entre as maiores.
- Insight determinístico (sem LLM): só quando o pico é ≥ 1,35× a média dos outros seis dias e o total da categoria supera o piso de materialidade já usado no produto. Texto curto tipo "Seu Lazer se concentra principalmente no fim de semana."
- `dataQuality`: `observedDays` e `sufficientHistory = observedDays >= 28`.
- Retorno exatamente no formato pedido (period, weekdayOccurrences, categories[].cells[], insight, dataQuality, formulaVersion).

Paridade: incluir o módulo em `FINANCE_CORE_MODULES` de `scripts/sync-finance-core.mjs` e rodar `npm run sync:finance-core`, para que o Nino/WhatsApp use o mesmo cálculo no futuro (uma implementação só).

## Dados

Janela móvel de 90 dias (hoje−89 → hoje) em `America/Sao_Paulo`, uma única leitura paginada:
- hook `src/lib/hooks/useCategoryWeekdayHeatmap.ts` usando `fetchAllPages` (`paged_select.v1`) com `TRANSACTION_FACT_SELECT` e as categorias já carregadas por `useAllCategories` (inclui globais).
- A janela de leitura cobre alguns dias extras para trás/frente, de modo que estorno e `behavioral_day` deslocado sejam atribuídos corretamente.
- Nenhuma query por célula; agregação em memória. Sem truncamento silencioso.

## UI

`src/components/home/HeatmapSemanalCard.tsx`:
- Título "Onde seus gastos se concentram", subtítulo "Veja em quais dias da semana cada categoria costuma pesar mais.", selo discreto "Últimos 90 dias". Sem termos técnicos.
- Grade mobile-first: coluna de categoria truncada + 7 células arredondadas, gap pequeno, sem borda pesada, sem número fixo dentro da célula; sem scroll horizontal.
- Cabeçalho compacto `S T Q Q S S D` com `aria-label`/`title` do dia completo; ordem segunda→domingo.
- Interação: hover no desktop e tap no mobile abrindo popover com categoria, dia completo, média do dia, participação semanal e período; célula é `button` acessível.
- Cor: token `primary` com opacidade escalonada nos 5 níveis (funciona em light/dark). Célula zero fica neutra (`muted`), nunca removida.
- Legenda discreta "Menor intensidade → Maior intensidade", sem números.
- Estados: carregando (skeleton no padrão da Home); histórico curto → nota "Ainda estamos aprendendo seu padrão semanal."; sem dados → estado vazio amigável, sem grade de zeros.

## Testes

`src/test/category-weekday-heatmap.test.ts` cobrindo os 12 casos pedidos: compra de sábado com competência do mês seguinte cai em sábado; média dividida pelas 13 ocorrências; estorno reduzindo para R$ 70; fatura, aplicação, transferência interna e superseded fora; normalização 0,25/0,50/1,00; normalização independente por linha; dias sem gasto no denominador; timezone São Paulo sem deslocar o dia; `sufficientHistory = false` com menos de 28 dias. Mais a suíte de paridade app × edge (já existente) após o sync.

## Fora de escopo (garantias)

Nenhuma alteração em `reportingCompetenceDate`, snapshot da Home, metas, faturas, saldo, cash bridge ou relatórios. Nenhuma migration nem mudança de dados.

## Validação final

`npm run sync:finance-core`, `npm test`, `npm run build` e conferência visual da Home autenticada (card entre os dois vizinhos, sem regressão), com relato de fórmula, fonte temporal, estornos, denominadores, normalização e período.
