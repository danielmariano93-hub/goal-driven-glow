# Relatório de período livre que respeita as datas + Home honesta sobre o período

## O que está acontecendo (verificado)

1. **O filtro de maio a agosto virou um relatório de julho.** O relatório gravado no banco ficou com tipo `custom`, mas com período `01/07 a 31/07`. A causa: a cópia do motor de períodos usada pela função de geração (o espelho em `supabase/functions/_shared/reports-core/`) ainda não conhece o tipo `custom` — ela ignora as datas enviadas e cai no caminho "último mês fechado". A lógica correta existe só no código do app, que não é o que gera o relatório.

2. **O gráfico "Gasto no recorte comparado" fica em branco.** Ele desenha duas séries separadas ("anterior" e "atual"), cada uma com um único ponto válido: uma linha com um só ponto não desenha nada. Além disso essa seção não usa o período do relatório aberto — ela sempre calcula "mês até hoje", então mesmo com o relatório de outro período o bloco mostra outra coisa.

3. **Na Home, escolher um mês anterior "não muda os números".** Está correto para a maior parte dos cartões: "Disponível hoje", "Previsão de fechamento" e "Próximos compromissos" são, por definição, a sua posição de hoje — eles não mudam com o período e hoje não dizem isso na tela. O único bloco que realmente responde ao filtro é "Seu ritmo de gastos". Ou seja: o filtro funciona, mas a tela não deixa claro o que ele afeta e não mostra nenhum fechamento do período escolhido.

## O que vai mudar

**Relatórios**
- O período que você escolher passa a ser exatamente o período do relatório (maio a agosto gera maio a agosto), com comparação contra os mesmos dias imediatamente anteriores.
- O relatório de julho gerado por engano fica no histórico e pode ser excluído normalmente.
- O bloco "O que mudou e o que fazer" passa a usar os números do próprio relatório aberto (período x período anterior), com um gráfico de comparação que sempre desenha — duas colunas: período anterior e período atual.

**Home**
- Cada bloco passa a declarar seu recorte: "Disponível hoje" e "Previsão de fechamento" ganham a marca de *posição de hoje* (não seguem o filtro); "Seu ritmo de gastos" mostra o período escolhido no próprio título.
- Entra um bloco novo **"Resumo do período"** com entradas, saídas e resultado do intervalo selecionado — assim mudar para maio muda número visível na hora.
- Quando o intervalo escolhido não tem lançamentos, o bloco diz isso em vez de mostrar zeros silenciosos.

## Detalhes técnicos

1. `scripts/sync-finance-core.mjs` executado para reespelhar `periods.ts`, `types.ts`, `engine.ts`, `narrative.ts` e `highlights.ts` em `supabase/functions/_shared/reports-core/`, incluindo `customPeriodOf`, `resolvePeriods(type, ref, customPeriod)` e `previousOf` para `custom`; função `financial-reports-generate` republicada.
2. Guarda de contrato na função: se `report_type === "custom"` e o período resolvido não bater com `period_start`/`period_end` recebidos, falhar com erro explícito em vez de gravar outro período (evita regressão silenciosa do espelho).
3. Teste em `src/test/` cobrindo `resolvePeriods("custom", ...)` — período preservado e anterior de mesma duração.
4. `ReportPerformanceSection.tsx`: passa a receber o `ReportDetail` (período, métricas e highlights já persistidos) em vez de `usePerformanceDetail()` (MTD); gráfico trocado por `BarChart` de série única com duas categorias, rótulo do período vindo do relatório.
5. `src/pages/Index.tsx` + `src/components/home/`: novo `ResumoPeriodoCard` alimentado por `snapshot.periodPerformance` (já calculado para o período), e legendas de recorte nos cartões de hoje. Sem mudança de motor financeiro.
