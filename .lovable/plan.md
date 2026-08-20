# Consultor Financeiro Pessoal — auditoria e conclusão (advisor_core.v1)

## Auditoria: o que realmente existe hoje

Rastreei o fluxo real das perguntas e o uso dos módulos criados na rodada anterior.

| Peça | Status real | Evidência |
| --- | --- | --- |
| `brazilian_business_calendar.v1` | Existe e funciona (Páscoa, feriados móveis, N-ésimo dia útil, `getEquivalentBusinessPeriod`) | `src/lib/engine/brazilianCalendar.ts` |
| `nino_clock.v1` | **Declarado, não adotado.** Só é importado por `financialComparison`, `financialPerformance` e `AdvisorReviewServiceV2`. Dezenas de arquivos ainda derivam data local de UTC | `rg` mostra 17+ arquivos com `new Date().toISOString().slice(0,10)` |
| `financial_comparison.v1` | **Motor completo, zero consumidores.** Nenhum tool, capability, Home, relatório ou proatividade importa | Referenciado apenas por si mesmo, pelo sync e pelo mirror `_shared/finance-core` |
| `financial_performance.v1` | Idem: engine sem consumidor | mesmo `rg` |
| Perguntas de evolução | Continuam em `analyze_financial_evolution` → `financial_evolution.v1` | `engineTools.ts:438`, `CapabilityRouter.ts:355` (`required_tool`) |
| Métricas declaradas | 15 declaradas, 7 calculadas. `category_spend`, `merchant_spend`, `debt_payment`, `investment_flow`, `net_worth`, `commitment_load`, `goal_progress` caem no `default => expense` | `financialComparison.ts` switch da função `aggregate` |
| Dias úteis | Só existe janela cronológica indexada; não existe filtro "somente dias úteis" | `aggregate()` filtra apenas `from`/`to` |
| Calendário | Carnaval, Sexta-feira Santa e Corpus Christi marcados como `national` sem policy | `getHolidays()` |
| Timing vs comportamento | Heurística fraca (categoria recorrente + atual 0) e sem `timing_effect`/`normalized_change` no contrato de saída | `financialPerformance.ts` |
| Drivers | Apenas por categoria, top 8, sem residual nem reconciliação | `computeFinancialComparison` |
| ContinuationContract | Funciona, mas guarda `restated_request` (reparse textual) e a precedência dá vitória à escrita financeira antiga | `ContinuationContract.ts`, `AgentCore.ts:142` |
| FinancialAdvisorEngine / topic affinity | **Não existe** | nenhum arquivo |
| Persistência de highlights | Não existe | nenhuma tabela |
| Home / WhatsApp / Relatórios / Admin consumindo highlights | Não existe | `src/components/home`, admin |

Conclusão: a rodada anterior entregou **motores corretos e desconectados**. Esta rodada é integração, correção conceitual e complemento — não nova arquitetura.

## Fases da implementação

### Fase 1 — Fundação temporal e de calendário
- `brazilianCalendar.ts`: introduzir `calendar_profile` (`BR_CIVIL` | `BR_FINANCIAL` | `BR_LOCAL`) em `Jurisdiction` (com `country`/`state_code`/`city_code`), classificar Carnaval/Sexta Santa/Corpus Christi como `bank_closed`/ponto facultativo e definir `BR_FINANCIAL` como padrão do Nino (dia útil = dia em que há liquidação bancária). Documentar a política.
- `ninoClock.ts`: expor `resolveUserClock(user)` lendo timezone do perfil (default `America/Sao_Paulo`, IANA).
- Migrar as ocorrências classificadas como **data local** ou **data financeira** para o clock: `finance-backfill-runner`, `participantPipeline`, `emotions/summary`, `mcp/tools/*`, páginas que geram `hoje` (`Dividas`, `Recorrencias`, `Cartoes`, `DivisaoDoRole*`, `NinoContexto*`, `MetaConjuntaDetalhe`, `Perfil`, admin). Instantes UTC legítimos ficam como estão.

### Fase 2 — Completar `financial_comparison.v1`
- Trocar o `default => expense` por resolução explícita por métrica: cada métrica é `IMPLEMENTED` ou lança `metric_not_implemented` (nunca cai em expense).
- Implementar as faltantes reusando motores canônicos: `category_spend`/`merchant_spend` (escopo canônico + `MerchantScope`), `card_spend` via `cardExposure`, `debt_payment` via `debtStatus`, `investment_flow` via movimentos de investimento, `commitment_load` via `commitmentAgenda`, `goal_progress` via metas, `net_worth` via patrimônio canônico (`valueResolver`).
- Novo eixo `day_selection`: `CHRONOLOGICAL` (indexed period) vs `BUSINESS_DAYS_ONLY` (soma só transações cuja data comportamental é dia útil). Aparece no `methodology` e no output; nunca implícito.
- Drivers multi-eixo (`category`, `merchant`, `fixed/flexible`, `recurrence`, `card`, `debt`, `income`, `investment`, `commitment`) com `driver_type`, `nature`, `confidence`, `share_of_change` e **residual** que reconcilia a variação total.

### Fase 3 — Completar `financial_performance.v1`
- Consumir os motores já existentes: `spendingRhythm`, `behaviorChange`, `costStructure`, `recurringDiscovery`, `savingsOpportunities`, `merchantIntelligence`, `cardExposure`, `commitmentAgenda`, `debtStatus`, `incomeProjection`, metas, patrimônio e `emotionFinance` (quando houver evidência).
- Decomposição explícita no contrato: `observed_change`, `timing_effect`, `structural_change`, `behavioral_change`, `normalized_change` — timing derivado de recorrências esperadas, agenda de compromissos e ciclo de fatura (não de "atual = 0").
- Gerar candidatos em todas as dimensões possíveis; a decisão de exibir é do Advisor.

### Fase 4 — `advisor_relevance.v1` (novo, não calcula finanças)
- `src/lib/advisor/advisorEngine.ts`: recebe highlights + situações + contexto 360 + affinity e devolve ranking, agrupamento, profundidade, principal melhora, principal atenção, próxima ação e canal (App / WhatsApp / silêncio).
- Regra dura: importância financeira > preferência. Situação crítica nunca é suprimida por baixa afinidade.
- Aprendizado: tabelas `user_advisor_topic_affinity` e `advisor_interaction_events` (sinais positivos/negativos, score com decay). Aprende também `preferred_comparison_mode`, sempre declarando a metodologia usada.

### Fase 5 — Integração no fluxo real do agente
- Novas tools: `compare_financial_metric` (comparison) e `assess_financial_performance` (performance + advisor).
- `CapabilityRouter`: "como estou / estou melhorando / evolução / compare / mesmos dias úteis / fatura maior" passam a exigir os novos tools. `financial_evolution.v1` deixa de ser fonte de comparação (fica apenas como série histórica interna) — sem dois motores concorrentes.
- Resposta executiva de "Como estou?": HEADLINE, 2–4 highlights, principal melhora, principal atenção, próxima ação, CTA. Números 100% dos motores; LLM só humaniza; `TruthValidator` valida contra o payload.
- `ContinuationContract`: persistir operação estruturada completa (metric, scope, subject, períodos, mode, filtros, `result_reference`) e executar direto no "ok", sem reparse. Precedência resolvida por recência/`originating_message_id`/turno — a pendência criada pela última pergunta do Nino ganha, sem nunca confirmar escrita financeira antiga.

### Fase 6 — Superfícies
- Persistência: `financial_performance_snapshots` (highlight, `logical_topic_key`, payload, confiança, comparabilidade, `valid_until`, `source_data_version`) com invalidação por evento (transação, importação, estorno, fatura, pagamento, meta, dívida, recorrência, investimento) via dirty flag — sem recálculo repetido.
- Home: seção discreta de acompanhamento com no máximo 2–4 cards (headline, número, explicação curta, período comparado, CTA "Entender"). UI não calcula.
- WhatsApp: highlights entram no pipeline proativo existente (Advisor → Situation Composer → materialidade → attention budget → quiet hours → dedupe). Highlight não é mensagem automática.
- Relatórios: estrutura acionável (resumo executivo, o que mudou, drivers, o que ainda vem, projeção, oportunidades, comportamento) sobre os mesmos motores, com gráficos suaves premium (curvas, período anterior atenuado, gradiente discreto, tooltip útil, mobile-first).
- Admin: observabilidade por usuário (contexto temporal, comparação/metodologia/cobertura, performance com timing vs comportamento, ranking do advisor e afinidade, proatividade com motivo de supressão) e **Dry Run** "como o Nino avaliaria este usuário hoje" sem enviar mensagem.

### Fase 7 — Testes (produto corrige, teste não afrouxa)
Timezone (23:00 SP = 02:00 UTC do dia seguinte, virada de mês/ano); calendário (fim de semana, feriado, móvel, ponto facultativo por policy, N-ésimo dia útil); business-day modes (indexed vs business-days-only, 8 dias úteis ago/jul, feriado no meio); comparison (rolling 30, MTD, business MTD, card cycle, category, merchant, goal, net worth, debt, baixa cobertura, métrica não implementada falha); performance (aluguel não ocorreu, fatura não fechou, queda comportamental real, receita cai mais, melhora em 3 períodos, resgate financiando o mês, reconciliação de drivers); continuação (ok/sim/pode/manda/claro, nova pergunta não confirma, colisão de pendências); learning (follow-up sobe, not-useful desce, decay, crítico não suprimido); E2E do "ok" no App e no WhatsApp.

## Migrations
1. `user_advisor_topic_affinity`, `advisor_interaction_events` (RLS por `auth.uid()` + GRANTs).
2. `financial_performance_snapshots` (RLS + GRANTs, índice por `user_id`/`reference_date`).
3. Campos de invalidação/dirty flag para performance.

## Entrega final
Relatório em tabela (requisito, status antes, implementação, arquivo, engine, consumer, teste, resultado, evidência), separando IMPLEMENTADO / PARCIAL / NÃO IMPLEMENTADO, mais o ANTES vs DEPOIS dos casos A–G.
