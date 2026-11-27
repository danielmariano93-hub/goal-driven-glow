# Ticket Alimentação — entrega do handoff (27/11/2026)

Status: **prévia, aguardando aprovação**. Nada foi publicado e nenhum lançamento foi alterado por esta entrega.

## 1. Inventário antes → depois

| Antes | Depois |
|---|---|
| `src/pages/TicketAlimentacao.tsx` (abas Resumo / Padrões, ~290 linhas com cálculo na tela) | Só carrega dados e abre os formulários; a tela vive em `src/components/ticket/TicketView.tsx` (Resumo / Análises / Extrato) |
| Resumo: saldo, Ritmo / Ideal / Cobertura, "Como o mês fecha" com 3 chips, "De onde veio" | Saldo + próxima recarga; Ritmo, Limite diário, Margem diária, Autonomia (+ dias sem cobertura); "Como o ciclo fecha" com atalhos, barra e campo numérico; Desempenho 2×2; uma ação prioritária; "De onde veio" virou "Como chegamos a esse saldo" (recolhido) |
| Padrões: "Para onde foi" (só Ticket), "Quando eu gasto" (total por dia), "Ticket ou bolso", "Comida fora do Ticket", "Como reduzir" | Análises: "Quando você mais gasta" (média por ocorrência, filtro Ticket/Bolso/Total, traço do ciclo anterior), "Ticket ou bolso" (Participação/Valores), "Onde você mais gasta" (ranking Ticket + bolso), "Oportunidades" |
| Lista de lançamentos no fim das duas abas | Aba Extrato: lista única (Ticket + comida paga do bolso), busca, filtros, totais, carregar mais, editar/excluir com confirmação |
| — | Seletor de ciclo (Análises e Extrato) com datas e estado aberto / encerrado / incompleto |

Arquivos novos: `src/lib/engine/ticketAnalytics.ts`, `src/components/ticket/{TicketView,CycleSelector,PerformanceGrid,WeekdayAvgChart,MerchantRanking,TicketStatement,SourceFilterChips,sourceStyle}`. `ticketCycles` foi para `benefitWallet.ts` (espelhado no finance-core) e `foodSourceByCycle` passou a usá-lo. `useBenefitOwnFoodRows` passou a trazer id e estabelecimento.

## 2. Contrato de cada indicador

| Indicador | Fórmula | Origem |
|---|---|---|
| Saldo disponível | leitura de saldo mais recente ± lançamentos depois dela (recarga prevista entra se não foi lançada) | `computeBalance` (sem mudança) |
| Ritmo | gastos do Ticket nos últimos 14 dias fechados ÷ dias observados | `computeRate` (sem mudança) |
| Limite diário | saldo do início do dia ÷ dias até a recarga | `dailyKpis` |
| Margem diária | limite − ritmo | `dailyKpis` |
| Autonomia | saldo ÷ ritmo; dias sem cobertura = máx(0, dias restantes − autonomia) | `dailyKpis` |
| Projeção | saldo − ritmo × dias restantes; sobra = máx(0, ·), falta = máx(0, −·) | `project` (sem mudança) |
| Cobertura do Ticket | T ÷ (T + B) | `totalsIn` |
| Desembolso próprio | B = despesas reais confirmadas nas categorias de comida, pela data da compra | `useBenefitOwnFoodRows` |
| Comparação | ciclo aberto: mesmos dias decorridos do ciclo anterior; encerrado: ciclo anterior inteiro; ciclo incompleto: indisponível | `performance` |
| Média por dia da semana | soma do dia ÷ ocorrências do dia na janela conhecida (dias sem compra = 0; dias desconhecidos fora) | `weekdayAverages` |
| Ranking | agrupado por nome normalizado (`normalizeMerchant`); sem nome = "Não identificado" | `merchantRanking` |
| Totais do extrato | consumo = compras; recargas somadas à parte | `statementTotals` |

## 3. Testes

`src/test/ticket-analytics.test.ts` (14), `src/test/ticket-view.test.tsx` (4), `src/test/ticket-vs-own.test.tsx` e demais testes do Ticket. Casos do QA do handoff cobertos: média com zeros (37,50), dia desconhecido (n=3), seleção sem texto de outro dia, T/B/total/cobertura, projeção (263,52 / 115,68), base zero sem NaN, ciclo incompleto fora da comparação, recarga fora do consumo, ranking que reconcilia e muda ordenação, drill-down para o extrato, exclusão com confirmação. Suíte completa: 572 arquivos.

## 4. Divergências e decisões

- **Cores:** mantido o design system do Nino (tokens do app e o degradê roxo/lilás aprovado no "Ticket ou bolso"), não a paleta proposta no handoff.
- **Cobertura 63,02%:** o valor exato é 63,025% → 63,03% (o handoff truncou). Na tela aparece 63,0%.
- **Variações** em texto neutro, sem verde só porque a cobertura subiu (pedido do handoff).
- **"Comida fora do Ticket" e "Para onde foi"** saíram: o primeiro é o "bolso" do "Ticket ou bolso"; o segundo virou o ranking com as duas fontes.

## 5. Itens P2 (entregues em seguida)

| Item | Como ficou |
|---|---|
| O que mudou | No detalhe de cada estabelecimento: cascata Antes → efeito frequência → efeito valor médio → Agora (`decomposeChange`). Novo estabelecimento e gasto que parou são tratados à parte. |
| Quando seu bolso pesa mais | Etapas 1–7, 8–14, 15–21 e 22–fim, em média por dia; toque mostra datas, Ticket, bolso, parte do Ticket e dias; concentração do bolso no fim do ciclo; associação com saldo baixo só quando o saldo de todos os dias é reconstruível (`cycleStages`, `ownAfterDepletion`). |
| Previsão por dia da semana | `weekdayForecast` + teste retroativo (`backtestForecast`, versão `ticket_weekday_forecast.v1`, corte no dia 10). Só substituiria o ritmo constante com 2+ ciclos e erro menor em todos; hoje (2 ciclos) errou mais (R$ 272 × R$ 210), então aparece como "em teste". |
| Eventos | `ticket_tab_view`, `chart_select`, `simulation_change`, `drilldown_open`, `opportunity_action`, sem valores nem nomes (`src/lib/analytics/ticketEvents.ts`, mesmo padrão do bloco editorial: buffer + dataLayer). |
| Estado guardado | Aba e ciclo no endereço (`?aba=analises&ciclo=2026-10-27`); filtros na sessão; oportunidades dispensadas por ciclo no aparelho. |
| Oportunidades | Ganhou "Pagar com Ticket onde ele já é aceito" (bolso em lugares onde o Ticket já foi usado, limitado à sobra prevista; não é economia) e "Dispensar" em cada uma. |

## 6. Limites que ficam

- Saldo histórico só existe a partir da primeira leitura de saldo (03/11); antes disso a associação "bolso depois de o Ticket acabar" aparece como indisponível.
- Eventos não vão para um banco: o app não tem tabela genérica de eventos; ficam no dataLayer, como os do bloco editorial.
- Ciclo de setembro: continua com a lacuna de ≥ R$ 154 de gastos não lançados (ver `docs/auditoria-ticket-agosto-2026.md`).
