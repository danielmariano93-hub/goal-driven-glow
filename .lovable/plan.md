## Plano — Relatórios inteligentes + correção mobile de datas

### Objetivo
Corrigir os vazamentos de campos de data no mobile e transformar a seção de categorias dos Relatórios em uma análise útil para decisão: percentual por categoria, oportunidades concretas de economia e highlights conectados aos dados reais do período.

### Estado atual verificado
- `src/pages/Relatorios.tsx` usa dois `input[type=date]` dentro de um `flex` simples; no mobile isso ainda pode apertar/estourar dependendo do navegador e do texto renderizado pelo Safari.
- `src/pages/Relatorios.tsx` calcula categorias com `byCategory`, exibindo apenas total e quantidade; não existe percentual nem bloco de highlights.
- `src/lib/reports/aggregations.ts` hoje agrupa por mês/categoria sem usar todos os campos necessários para distinguir melhor movimentos financeiros e gerar análises mais ricas.
- A Home persiste o período em `src/lib/ui/periodStore.ts`; Relatórios já inicializa por esse período, mas a UI de datas precisa ficar responsiva e mais clara.

### Implementação proposta

#### 1. Corrigir definitivamente os campos de data no mobile
- Trocar o bloco de datas em Relatórios de `flex` para `grid` responsivo:
  - 1 coluna em telas muito estreitas;
  - 2 colunas quando couber;
  - `min-w-0`, `w-full`, altura estável e labels claros “De” / “Até”.
- Aplicar o mesmo padrão visual seguro para datas usadas em filtros sensíveis, incluindo Lançamentos quando necessário, sem refatorar a página inteira.
- Reforçar CSS global para `input[type="date"]` no Safari/iPhone:
  - `font-size: 16px` no mobile;
  - `min-width: 0`;
  - largura 100%;
  - tratamento do valor interno WebKit para não empurrar o input para fora.

#### 2. Percentual por categoria em Relatórios
- Evoluir `byCategory` para retornar também:
  - `percentOfExpenses`;
  - ranking da categoria;
  - ticket médio (`total / count`).
- Exibir em cada categoria:
  - nome;
  - valor total;
  - quantidade;
  - percentual sobre o total de despesas do período;
  - barra proporcional mantendo o layout mobile-first.
- Garantir que percentuais sejam calculados sobre as despesas filtradas do período, sem inventar dados.

#### 3. Highlights inteligentes no fim da página
Adicionar um módulo “Principais leituras do período” com exatamente até 3 insights derivados dos dados reais. A lógica será determinística, sem IA e sem frases genéricas.

Os highlights serão escolhidos por relevância, por exemplo:
- **Concentração de gastos:** quando a maior categoria representar uma fatia relevante do total. Ex.: “Lazer concentrou 18% das despesas do período.”
- **Economia acionável:** simular redução realista da maior categoria variável. Ex.: “Reduzir 15% em Lazer economizaria R$ X neste período.”
- **Recorrência/frequência:** detectar categorias com muitos lançamentos pequenos. Ex.: “Transporte apareceu 41 vezes; revisar pequenos gastos recorrentes pode ter mais impacto que cortar uma compra isolada.”
- **Alerta de essencial vs. ajustável:** priorizar categorias mais ajustáveis como Lazer, Assinaturas, Delivery/Alimentação fora, Mercado/Outros quando existirem; evitar recomendar cortes cegos em Moradia, Saúde, Dívidas e obrigações.
- **Dependência de uma categoria:** quando top 3 categorias concentram grande parte do gasto, indicar foco de revisão.

#### 4. Regras para não ser genérico
- Só mostrar highlight se houver base mínima de dados no período.
- Não sugerir cortar categorias sensíveis/obrigatórias como dívida, moradia ou saúde; nesses casos, a dica será de revisão/renegociação/organização, não “reduzir X%”.
- Usar valores reais do período e percentuais reais.
- Quando não houver dados suficientes, mostrar estado vazio amigável e factual.

#### 5. Testes e aceite
- Adicionar testes em `src/test/reports-aggregations.test.ts` para:
  - percentual por categoria;
  - geração dos 3 highlights;
  - não sugerir corte genérico em categorias essenciais;
  - cálculo de economia simulada em categoria ajustável.
- Validar visualmente em viewport mobile semelhante ao print para confirmar:
  - sem overflow horizontal;
  - datas cabendo na tela;
  - categorias com percentuais legíveis;
  - módulo final com 3 highlights úteis.

### Arquivos previstos
- `src/pages/Relatorios.tsx`
- `src/lib/reports/aggregations.ts`
- `src/test/reports-aggregations.test.ts`
- `src/index.css`