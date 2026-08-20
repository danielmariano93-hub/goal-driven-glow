# Nino Consultor Financeiro Pessoal — advisor_core.v1

Evolução determinística e reutilizável: comparações avançadas, avaliação de evolução, highlights, continuidade conversacional, aprendizado de relevância e calendário brasileiro real.

## Auditoria do que já existe (verificado)

- `src/lib/engine/` + espelho `supabase/functions/_shared/finance-core/` já concentram a verdade financeira (`facts`, `metrics`, `canonicalFacts`, `costStructure`, `recurringDiscovery`, `commitmentAgenda`, `cardExposure`, `financialEvolution`, `emotionFinance`).
- `financialEvolution.ts` (`financial_evolution.v1`) calcula `expense_trend_pct` comparando 30d com a **média mensal de 90d** e rotula `trend` como "melhorando/piorando" — daí a frase semanticamente incompleta do caso real. Falta metodologia explícita no envelope de saída e falta decomposição de drivers.
- Comparação temporal hoje é `supabase/functions/_shared/analytics/compare.ts` (`compare.v1`): só `expense|income`, agrupamento por categoria, apenas dois períodos crus. Nenhum conceito de dia útil, ciclo de cartão, MTD equivalente ou comparability.
- Tempo: `analytics/periods.ts#todaySP` já resolve hoje em America/Sao_Paulo, mas há dezenas de pontos que derivam data por UTC (`toISOString().slice(0,10)` em `facts.ts`, `bridges.ts`, `engineEnvelope.ts`, `spendingSimulation.ts`, runners e ticks). Não existe calendário de feriados nem índice de dia útil em nenhum lugar.
- Continuidade: `ConversationExpectation.ts` cobre só `emotional_checkin`, `entry_slot`, `category_scope`. `parser.ts` classifica "ok/sim/pode" como `kind: "confirm"`, e `PolicyEngine.evaluate` procura apenas em `pending_confirmations` (escrita financeira) — sem nada lá, responde "Não encontrei nada pendente para confirmar". **Essa é a causa raiz do bug do "Ok"**: a pergunta analítica feita pelo próprio Nino não é persistida como ação pendente.
- Proatividade já tem pipeline canônico (`_shared/proactive/`: signals → situations → ranking → attention budget) e feedback (`communication_feedback`, `communication_deliveries`, `nino_item_exposures`) — base pronta para o aprendizado de relevância; não existe perfil de afinidade por tema.

## O que será construído

### 1. Fundação temporal — `nino_clock.v1` + `brazilian_business_calendar.v1`
- `finance-core/time/NinoClock.ts`: `UserTemporalContext` (timezone IANA, `local_datetime`, `local_date`, weekday, mês, ano) e helpers `todayLocal`, `startOfLocalDay`, `currentMonth`, `previousMonth`.
- `finance-core/time/BrazilianCalendar.ts`: provider versionado de feriados nacionais com móveis calculados (Páscoa/Carnaval/Corpus Christi via algoritmo, não hardcode ano a ano) e jurisdição preparada (`state_code`, `city_code`). API: `getHolidays`, `isBusinessDay`, `businessDayIndex`, `getNthBusinessDay`, `businessDaysBetween`, `getEquivalentBusinessPeriod`.
- Engines e ticks passam a receber `as_of` do clock; nenhum motor deriva "hoje" por UTC.

### 2. `financial_comparison.v1`
`finance-core/comparison/financialComparison.ts` — única fonte de comparação temporal. Request com `metric` (expense, income, net, savings_rate, category_spend, merchant_spend, transaction_count, average_ticket, card_spend, cash_flow, debt_payment, investment_flow, net_worth, commitment_load, goal_progress), `scope`, `subject_id`, `current_period`, `comparison_mode`, `filters`, `as_of`. Modos: PREVIOUS_EQUIVALENT_PERIOD, SAME_CALENDAR_DAYS_PREVIOUS_MONTH, SAME_NUMBER_OF_ELAPSED_DAYS, SAME_BUSINESS_DAY_INDEX_PREVIOUS_MONTH, SAME_BUSINESS_DAYS_RANGE, WEEK_OVER_WEEK, MONTH_OVER_MONTH, MTD, MTD_EQUIVALENT, ROLLING_WINDOW, SAME_CARD_CYCLE_POINT, YEAR_OVER_YEAR, CUSTOM_PERIOD.
Result com `current/previous` (valor, dias, dias úteis, amostra), `delta_abs/pct`, `direction`, `comparability` (high/medium/low/invalid), `confidence`, `drivers[]`, `exclusions[]`, `methodology` (frase pt-BR pronta para explicar), `evidence`, `formula_version`.
`DataCoverage` (expected/observed/active days, coverage_ratio, first_reliable_date) separa confiança estatística de cobertura de dados. `compare.v1` passa a ser adaptador fino sobre o novo motor.

### 3. `financial_performance.v1` + highlights
`finance-core/performance/financialPerformance.ts` avalia as dimensões pedidas (resultado, receitas, despesas, savings rate, ritmo, frequência, ticket, categorias, merchants, fixo/flexível, assinaturas, recorrências, cartão, dívidas, metas, patrimônio, investimentos, comportamento, emoções com evidência, oportunidades, comprometimento futuro, liquidez).
- Decomposição de drivers por categoria/merchant/natureza.
- Classificação `structural | behavioral | timing | mixed | unknown` usando `costStructure`, `recurringDiscovery` e `commitmentAgenda` — queda por recorrente que ainda não ocorreu nunca vira "melhora estrutural"; separa `observed_change` de `normalized_change`.
- Saída `FinancialPerformanceHighlight` com todos os campos do contrato (materiality, comparability, confidence, positivo/negativo/neutro, `logical_topic_key`, `valid_until`), incluindo tipos positivos.

### 4. `FinancialAdvisorEngine` (`advisor_relevance.v1`)
Camada de decisão (não calcula finanças): recebe highlights + `FinancialSituation` + metas + comportamento + perfil aprendido e decide ordem, agrupamento, profundidade, canal e o que vira proatividade. Regra dura: **importância financeira > preferência do usuário** — crítico nunca é suprimido por desinteresse.
Resposta a "como estou?" passa a ser executiva: headline, 2–4 highlights, principal melhora, principal atenção, CTA de aprofundar.

### 5. Continuation Contract (bug do "Ok")
- Novo tipo `PendingConversationAction` persistido na memória conversacional (`awaiting` expandido: `action_type`, `requested_operation`, `confirmation_expected`, `accepted_answers`, `expires_at`).
- `ConversationExpectation` ganha detecção de ofertas do Nino ("quer que eu…", "posso comparar…", "me dá o ok", "posso simular", "quer ver…") e persiste a operação estruturada com a metodologia já resolvida.
- Precedência de roteamento: **ação conversacional pendente > escrita financeira pendente > ack genérico**. `PolicyEngine` só cai no texto "não encontrei nada pendente" depois de as duas primeiras falharem.
- `ConversationMemory` passa a guardar `active_metric`, `comparison_mode`, `last_result_reference`, `advisor_topic`, `last_highlight_ids`; resolução de referências ("e mês passado?", "e nos dias úteis?", "detalha isso", "por quê?").
- Guarda de persona: usuário nunca é chamado de "Nino".

### 6. Aprendizado de relevância
`user_advisor_topic_affinity` (score por tema, pesos explícito/conversa/abertura/ação/feedback, decay temporal) e `advisor_interaction_events` (`highlight_shown/opened/followup/acted/dismissed/not_useful`), alimentados por conversa, CTA e `communication_feedback`. Aprende também `preferred_comparison_mode` e `preferred_depth` — e a resposta sempre declara a metodologia usada. Aprendizado altera prioridade/ordem/profundidade/canal/copy; nunca fatos.

### 7. Superfícies
- App: área de highlights do Nino (2–4 cards: headline, explicação curta, período comparado, número principal, confiança quando necessário, CTA "Entender"), reutilizada na Home e nos Relatórios.
- Relatórios repensados como acionáveis: além do passado, projeção do fechamento, compromissos que ainda vencem, o que mudou e por quê, com gráficos suaves e premium (paleta oficial, área/linha com gradiente, sem poluição).
- WhatsApp: highlight curto de alta relevância via pipeline proativo existente (nunca relatório gigante).
- Admin: leitura por usuário de performance (highlights, comparação usada, drivers, confidence, comparability), advisor learning (afinidades e sinais) e proatividade (o que virou situação, enviado, suprimido e por quê) + **Dry run** "como o Nino avaliaria este usuário hoje" sem enviar nada.

### 8. Custo e invalidação
Reuso de `FinancialContext360` / snapshot canônico / `MultiFinanceProactiveContext` quando `reference_date` é compatível; cache curto por usuário+as_of, invalidado por evento financeiro (transação, edição, exclusão, importação, fatura, pagamento, meta, dívida, recorrência, patrimônio, check-in relevante).

## Migrations
`user_advisor_topic_affinity`, `advisor_interaction_events`, `financial_performance_snapshots` (highlights materializados para App/WhatsApp/admin), cada uma com GRANTs e RLS por `auth.uid()`. Estruturas existentes (`nino_item_exposures`, `communication_feedback`) são estendidas em vez de duplicadas.

## Testes
Calendário (sábado, domingo, feriado fixo e móvel, virada de mês/ano, fevereiro, 23:00 SP = 02:00 UTC do dia seguinte), dias úteis (10º dia útil ago vs jul, feriado no intervalo, distribuição diferente de fins de semana), comparação (os 10 casos listados, incluindo ciclo de cartão e cobertura baixa), performance (aluguel ainda não ocorrido = timing; queda persistente de flexível = behavioral; 3 períodos de melhora = highlight positivo; gasto cai mas receita cai mais), aprendizado (afinidade sobe/desce, crítico não suprimido) e E2E do caso real ("Ok" executa a comparação por dias úteis).

## Riscos de regressão
Troca de base temporal pode deslocar recortes já exibidos (mitigação: `compare.v1` como adaptador + testes de paridade App/Edge via `scripts/sync-finance-core.mjs`); alargar a precedência de confirmação pode capturar "ok" que era de lançamento (mitigação: ação de escrita tem prioridade sobre oferta analítica quando ambas estão frescas); novos highlights podem aumentar volume proativo (mitigação: attention budget e materialidade existentes).

## Entrega final
Tabela requisito → implementação → arquivo → engine → teste → resultado → evidência, com antes/depois do caso conversacional real.
