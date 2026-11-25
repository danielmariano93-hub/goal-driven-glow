# Meu mês — relatório de conformidade com o handoff one page (25/11/2026)

Rota preservada: `/app/relatorios` (links antigos `?aba=` e `?ato=` levam ao capítulo correspondente). Reversão: `?versao=abas` abre o layout anterior de quatro abas, sem mudança de dados.

## 1. Inventário: antes → depois

| Antes (4 abas) | Depois (Meu mês) |
|---|---|
| Cabeçalho "Relatórios" + menu | `MeuMesHeader`: título "Meu mês" 26/32, menu Exportar CSV / Imprimir |
| `PeriodSelector` | `MonthPicker`: anterior/próximo 44 px, calendário (seletor nativo), "Até dd/mm · faltam N dias" ou "Mês encerrado"; próximo desabilitado no mês atual |
| `ReportTabs` (abas que escondem conteúdo) | `AnchorNav`: índice fixo Hoje · Gastos · Hábitos · Futuro · Evolução · Ação; âncora ativa segue a seção visível; rolagem horizontal só no índice; URL com `#âncora` |
| Visão geral | 01 `MomentHero` (escuro 1/2) + 02 `SpendTrend`, `CategoryMix`, `ChangeDrivers` |
| Comportamento | 02 (categorias e fatores) + 03 `BehaviorHighlight`, pequenos gastos, `WeekdayChart`, classes e hipóteses em acordeão |
| Projeções | 04 `ForecastHero` (escuro 2/2) com ponte e simulador, `CommitmentTimeline`, recebíveis, poupança sustentável |
| Evolução | 05 `MonthlyResultChart`, `NetWorthTrend`, `GoalProgress` |
| Ação na aba Projeções | 06 `NextBestAction` + outras oportunidades + gasto recuperável + `DataQualityFooter` |

## 2. Os 23 indicadores por capítulo

| # | Indicador | Onde aparece |
|---|---|---|
| 01 | Consumo | 01 (secundário), 02 (KPI 32/36, líquido de estornos) |
| 02 | Habitual | 02 (chip + base: mediana de N meses, mesmos dias), curva |
| 03 | Receitas | 01 detalhe "Receitas, resultado e caixa"; 01 (mês encerrado) |
| 04 | Resultado | 01 detalhe; 01 (mês encerrado); 05 barras |
| 05 | Saldo | 01 KPI "Disponível hoje"; ponte do caixa no detalhe |
| 06 | Curva | 02 `SpendTrend` |
| 07 | Categorias | 02 `CategoryMix` (3 + demais) e gaveta completa |
| 08 | Classes | 03 acordeão "Fixos, ajustáveis e hipóteses" (lista assinada) |
| 09 | Fatores | 02 `ChangeDrivers` (top 3 + residual explícito) |
| 10 | Dias da semana | 03 `WeekdayChart` |
| 11 | Pequenos gastos | 03 destaque |
| 12 | Padrões | 03 lista com "confirmado / em observação" e evidências |
| 13 | Consumo final | 04 hero (consumo projetado) e premissas na ponte |
| 14 | Caixa final | 04 hero, cenário sem renda, ponte em centavos, simulador |
| 15 | Compromissos | 04 `CommitmentTimeline` (30 dias + 6 meses) e vencimentos |
| 16 | Renda comprometida | 04 "equivalente a N% da renda mensal informada" |
| 17 | Recebíveis | 04 bloco "A receber" |
| 18 | Poupança sustentável | 04 bloco com motivo quando indisponível |
| 19 | Recuperável | 06 "Outras oportunidades" (detalhe por categoria, sem somar) |
| 20 | Resultado mensal | 05 barras divergentes |
| 21 | Patrimônio | 05 `NetWorthTrend` + ativos e passivos |
| 22 | Metas | 05 `GoalProgress` + gaveta com todas |
| 23 | Recomendações | 06 `NextBestAction` |
| — | Qualidade | Avisos junto aos números (01, 02) + `DataQualityFooter` |

## 3. Conformidade item a item

| Regra do handoff | Status | Observação |
|---|---|---|
| Uma rota, seis capítulos em ordem fixa | ✅ | Teste `meu-mes.test.tsx` verifica a ordem |
| Índice sticky, âncora ativa, scroll horizontal só no índice | ✅ | Medido no navegador: clicar "Futuro" leva ao capítulo e ativa a âncora |
| Não recriar abas | ✅ | Sem `tablist` na página nova |
| Máximo de dois heroes escuros | ✅ | 01 e 04 (teste automatizado) |
| Tokens (#21164F, #6D3BFF, #8B5CF6, #F8F7FC, #EAE4F7/#DDD8E9, #666274) | ✅ | |
| Tipografia 26/32, 22/28, 16/22, 36/40, 32/36, 22/28, 14/21, 12/16 | ✅ | |
| Hero padding 20 raio 24; cartão padding 16 raio 16; sem sombra pesada | ✅ | Cartões só onde agrupam informação |
| Capítulos separados por 32 px e divisor discreto | ✅ | |
| 320–375 empilham KPIs; 390–430 lado a lado | ✅ | Recebíveis/poupança: 1 coluna abaixo de 390 px |
| Desktop até 1120 px, 12 colunas, gráficos 7/5 e 6/6 | ✅ | Exceção de largura só para esta rota em `AppLayout` |
| MomentHero: diagnóstico ≤ 2 frases, KPI dominante, dois secundários, próxima entrada, alerta junto ao KPI | ✅ | |
| SpendTrend: 200–240 px, realizado roxo, habitual lilás, futuro tracejado, faixa só se válida, valores de fim anotados, toque com dia/acumulado/referência/diferença/lançamentos | ✅ | Ver divergência D1 |
| CategoryMix: 3 + demais; barra segmentada só se todas ≥ 0 | ✅ | |
| ChangeDrivers: top 3 por impacto absoluto + residual explícito | ✅ | |
| Comparadores com rótulo próprio (habitual ≠ mês anterior) | ✅ | |
| WeekdayChart: zero na base, ordem fixa, marcador histórico com legenda, dias sem gasto no denominador | ✅ | Valores negativos (estornos) exibidos como 0 na barra, com explicação no toque |
| Padrões fracos "em observação"; sem inferir emoções | ✅ | |
| ForecastHero: saldo, sem renda, consumo projetado; ponte em centavos com datas e origem; simulador local com restaurar | ✅ | |
| Recebíveis separados; renda prevista nunca chamada de garantida | ✅ | |
| CommitmentTimeline: 30 dias com datas, relação com renda, 6 meses empilhados com legenda e valores, estimado × confirmado, toque abre composição | ✅ | Ver divergência D2 |
| Poupança: estimativa ou indisponível com motivo; diferença para o saldo projetado | ✅ | |
| Recuperável em Ação, sem duplicar | ✅ | |
| MonthlyResultChart: zero visível, valores diretos, parcial tracejado, detalhe com receitas, consumo e principal | ✅ | Ver divergência D3 |
| NetWorthTrend: variação em reais e período, escala, pontos reais, lacunas não ligadas | ✅ | Ver divergência D4 |
| GoalProgress: resumo, até duas em atenção, realizado × projeção, excedente sem truncar | ✅ | |
| NextBestAction: verbo, motivo, valor e unidade, CTA existente; caixa ≠ economia; outras em expansão; não somar | ✅ | Ver mudança M1 |
| DataQualityFooter: método, data, fontes, limitações, versão; expansão com correção | ✅ | |
| Motor editorial determinístico (prioridades 1–5, um dominante + até dois complementares) | ✅ | `src/lib/engine/reportEditorial.ts`, limiares em `EDITORIAL_THRESHOLDS` (a aprovar) |
| Mês encerrado: realizado no lugar da previsão; sem reconstruir previsão | ✅ | |
| Estados: skeleton estável, erro com tentar de novo, offline com horário, sem números de outro mês | ✅ | `placeholderData` antigo não é mais exibido quando o mês muda |
| 44×44, foco visível, teclado, texto alternativo, redução de movimento | ✅ | Medido: nenhum alvo interativo < 44 px |

## 4. Divergências e motivos

- **D1 Suavização da curva.** O handoff pede "sem suavização que altere valores". A curva passa por todos os pontos diários reais (interpolação monotônica entre eles, sem picos nem vales novos). A versão anterior reamostrava a cada 3 dias; isso foi removido.
- **D2 Faturas estimadas sem data.** A fatura do mês estimada pela Home não tem data na agenda; aparece como "sem data", sem inventar vencimento. Por isso o risco de caixa diário não a considera (regra 2 do motor editorial).
- **D3 Juros por mês.** O resultado mensal mostra receitas, consumo e principal de dívida separados. Os juros conhecidos estão dentro do consumo; não há série mensal separada de juros no contrato atual.
- **D4 Ponte do patrimônio.** Novas dívidas, amortizações, variação de ativos e ajustes não são registrados por mês; a gaveta mostra ativos e passivos e explica a ausência da ponte, sem desenhar valores fictícios.
- **D5 Limiares editoriais.** Os limiares (50% de compromissos, 15% de desvio, 3 meses de base, 30% para aviso de calendário) estão versionados em um único lugar e precisam de aprovação.

## 5. Mudanças no contrato (aditivas)

- **M1 Ordem das recomendações** (`reportV2.ts`): ação de caixa sem valor a proteger nem urgência demonstrada deixa de ser a primeira; urgência com valor continua primeiro. Título da oportunidade recuperável passa a começar com verbo ("Revise os gastos com …").
- **M2 Vencimentos** (`projections.commitments.items`): lista com data, origem, valor e se é estimado, para o toque abrir os vencimentos. Campo opcional; nenhum cálculo existente muda.

- **M3 Layout global** (`index.css`, `AppLayout.tsx`): `overflow-x: hidden` → `clip` no body e no layout (com `hidden` como reserva). Mesmo efeito visual, mas o índice fixo passa a funcionar; sem isso nenhum `position: sticky` do app ficava fixo.

- **M4 Metas** (`reportV2.ts`): o status de cada meta de gasto vem do motor canônico (o mesmo da aba Metas); o cálculo local (projeção ≥ 85%) só entra se o status faltar. Antes, metas "no ritmo" na aba Metas apareciam como "atenção" aqui.
- **M5 Ação de caixa** (`reportV2.ts`, `runtimeV2.ts`): a situação traz a causa concreta e a data ("A parcela de Tia é de R$ 1.566,00 e vence em 09/12"); o título vira "Reserve R$ 1.566 para 09/12" e só é urgente se o saldo previsto sem a próxima renda não cobrir o valor. Oportunidade de economia explica gasto médio × padrão mais baixo e abre os lançamentos da categoria.

## 5b. Ajustes da revisão visual (25/11)

Paleta do Nino nos dois destaques (o mesmo degradê do cartão da Home), destaques mais compactos, cada indicador em seu próprio cartão (consumo, para onde foi, o que mais mudou, pequenos gastos, dias da semana, compromissos, resultado, patrimônio, metas), rótulos do futuro em linguagem direta ("Se essa renda não entrar, você fecha o mês com…", "Gasto total previsto até 30/11 = já gasto + até o fim do mês"), barras de metas em degradê roxo. Divergência do handoff: o handoff pedia superfície #21164F e cards só quando agrupam informação; o dono do produto pediu a paleta da Home e separação visual entre indicadores.

## 6. Testes

- `src/test/meu-mes.test.tsx`: estrutura, âncoras, heroes, capítulos 01/04/06, gaveta de categorias com comparação, troca de mês sem números antigos, casos de reconciliação da seção 14 (ponte 11.783,34; sem renda 2.352,90; antes do variável 12.070,70; recebíveis 5.437; classes assinadas = 100; oportunidades 723) e o motor editorial.
- `src/test/relatorios-v2-page.test.tsx`: layout anterior pela reversão `?versao=abas`.
