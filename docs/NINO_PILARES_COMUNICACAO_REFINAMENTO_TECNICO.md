# Pilares de comunicação — refinamento técnico (05/11/2026)

Objetivo: o Nino deixa de ordenar TODA comunicação por uma única pontuação e passa a ter **pilares** com vagas
reservadas. Mensagem preventiva (o dia em que você costuma gastar mais) deixa de perder sempre para vencimento.
Convenções: **[verificado]** = lido no código ou consultado no banco da conta dona (somente leitura);
**[hipótese]** = ainda não confirmado; **[decisão]** = tomada pelo dono do produto.

## 1. Decisões já tomadas

- 4 pilares: **Proteger**, **Antecipar**, **Metas e progresso**, **Organização**.
- Teto padrão do produto: **5 mensagens por dia no WhatsApp** (crítico pode passar).
- O "plano de sexta" é só um exemplo: vale para o **dia crítico do usuário** (o dia da semana em que ele mais passa da referência), com sugestão de experimento.
- A variável "a categoria tem meta?" decide a mensagem (ver §5).
- Sem alternar semanas com/sem aviso; a medição é descritiva (gasto contra o próprio padrão).

## 2. Diagnóstico verificado (por que o "Sextou" não chegava)

Em 30/10 (sexta) o "Sextou" foi gerado (pontuação 78) e barrado `attention_budget_exhausted` em **todas** as rodadas da
manhã (07:17 a 13:17), duas vezes por rodada (app e WhatsApp).

Causas, em camadas **[verificado]**:

1. **Alocador** (`proactive/ranking.ts` → `allocateAttention`): uma única fila por pontuação; 1 vaga de WhatsApp e
   3 de app **por rodada horária** (`DEFAULT_ATTENTION_BUDGET`). Vencimento/caixa pontuam 113–235; o aviso preventivo
   pontua 75–78 → perde sempre.
2. **Vaga fantasma**: o alocador marca "entregar" para os mesmos itens a cada hora (00:17 a 10:17 em 30/10, pontuações
   181, 162, 125 repetidas) mas o despachante só os envia depois (adiamento por silêncio 21h–8h, cota, janelas). O item
   segura a vaga sem ser enviado e quem está atrás nunca entra. O alocador **não conhece** as regras do despachante.
3. **Despachante** (`agent/core/CommunicationDispatcherV3.ts` + `intelligence/communicationPolicy.ts#decideCommunication`):
   decide de novo, por conta própria: opt-outs, silêncio, `dedup_key` 14 dias, `kind_cooldown_24h`, cota diária/semanal e
   override de alta prioridade.

### Achados do replay (conta dona, 30/10 e 05/11) **[verificado]**

- **Vaga fantasma, comprovada.** Em 30/10 só houve **uma** entrega real (19:17), embora o alocador tenha marcado "entregar"
  a cada hora, de 00:17 a 18:17, para os mesmos itens. Em 05/11 o mesmo: `debt_progress` (só-app, WhatsApp mínimo "crítico")
  e outro item alternando "entregar" de hora em hora, sem nunca sair.
- **Causa**: o alocador não conhece 4 regras do que sai de fato: (a) **catálogo** (`communication_catalog`: tipo só-app ou
  severidade mínima para WhatsApp); (b) **cooldown de 24h** do mesmo tipo (`decideCommunication`; o alocador isenta críticos
  da janela de repetição, mas o despachante não isenta); (c) **silêncio** 21h–8h; (d) **cadência** do tick
  (`proactiveWhatsappCadence`: mínimo de 2h entre proativas no WhatsApp, salvo crítico pendente).
- **Severidade inflada.** Em 30/10 quase todos os rivais do "Sextou" eram `critical`: `goal_feasibility` com impacto de
  R$ 26 e `spending_goal_pressure` com impacto de R$ 26. Se "crítico" furasse a fila em qualquer pilar, os pilares não
  resolveriam nada. Decisão: **só o Proteger fura teto e cota**. Revisar a severidade desses tipos é pendência separada.

### Correções ao que eu disse antes **[verificado]**

- O limite pessoal **não é uma contagem de mensagens**: é um orçamento em **pontos**. Cada mensagem pesa por tipo
  (`attention_weights`: cuidado 1, informativo 2, financeiro 4). Orçamento do dia = `cap × 4 × multiplicador`.
- A política global está em **`pilot_mode = true`** (multiplicador 3) e **`allow_high_priority_override = true`**
  (limiar 75, crítico 90). Logo, mensagem com pontuação ≥ 75 **ignora o cap** e as de pontuação alta passam sempre.
- O teto **diário** é limitado a 5 e o **semanal** a **14** no código (`Math.min(14, …)`), então o valor 25 que gravei
  para a semana vale 14.
- Efeito do ajuste que fiz hoje (diário 1→5, semanal 3→25): o orçamento diário foi de 12 para 60 pontos (≈15 mensagens
  financeiras). Isso **afrouxa justamente as de baixa pontuação** (descoberta de recurso, aceleração de gasto pequeno),
  o oposto do que queremos. Por isso o teto de 5 vira **contagem real no alocador** (§4) e o cap em pontos deixa de ser o
  controle principal.

## 3. Taxonomia: tipo de comunicação → pilar

Fonte: `communication_catalog` (48 tipos ativos) + tipos gerados pelo motor. Tipo desconhecido → **Organização**
(nunca Proteger: não pode furar a fila por engano).

| Pilar | Tipos |
|---|---|
| **Proteger** (prazo e caixa) | bill_due_reminder, card_bill_pressure, card_closing_soon, debt_due_soon, debt_installment_due, debt_overdue, forgotten_bill, cash_flow_imbalance, upcoming_cash_pressure, recurring_commitment_pressure, expected_recurring_payment |
| **Antecipar** (antes do gasto) | weekday_spending_risk, weekend_spending_risk, spending_goal_weekend, month_phase_spending_risk, card_cycle_acceleration, small_spend_acceleration, spending_pace_change, spending_spike, emotional_spending, impulsive_spending, relapse_risk, growing_category, benefit_projection |
| **Metas e progresso** | spending_goal_pressure, spending_goal_threshold, spending_goal_weekly, spending_goal_monthly, spending_goal_zero_charge, goal_at_risk, goal_feasibility, goal_progress, debt_progress, performance_improvement, performance_deterioration, financial_discipline, saving_opportunity, underused_subscription, wealth_building_action, investment_drawdown, change_progress, change_reframe, recommendation_changed |
| **Organização** | categorize_transaction, data_quality, duplicate_expense, feature_discovery, mid_month_checkin, advisor_review_weekly, advisor_review_monthly, behavioral_reassessment_due, emotional_checkin_due, engagement_drop, recurring_pattern, split_payment_pending, concentration_risk, financial_procrastination |

## 4. Arquitetura-alvo

### 4.1 Alocador por pilares (`proactive/pillars.ts`, função pura)

- `pillarOf(kind)`; `PILLAR_QUOTAS`: Proteger sem cota; Antecipar até 1/dia e reserva semanal mínima de 1; Metas até 2/semana;
  Organização 0 no WhatsApp (só app), exceto `data_quality` que bloqueia leitura.
- Teto único de **5/dia no WhatsApp** (`WHATSAPP_DAILY_CAP`). Passam do teto apenas: severidade crítica, atraso, vence em ≤ 3 dias.
- Ordem de escolha por rodada: (1) Proteger que fura (crítico, atraso, vence em ≤ 3 dias); (2) pilar com cota não cumprida e item
  elegível; (3) o resto por pontuação. **Crítico fora do Proteger não fura** (severidade inflada, ver acima).
- **Vaga reservada é liberável**: só se reserva quando há item elegível E material; sem isso a vaga fica livre.
- Integração mínima: `allocateAttention` ganha `pillars?:` opcional. Sem ele, o comportamento atual é idêntico
  (todos os testes existentes continuam valendo). Com ele, as MESMAS regras de supressão rodam (repetição, materialidade,
  confiança, timing), e só a ordem e o gate final mudam.

### 4.2 Fim da vaga fantasma

- `allocateAttention` ganha `canDispatch?:(situation, channel) => string | null`. Se o despachante recusaria agora, o item é
  suprimido com `dispatcher_would_defer:<motivo>` **sem consumir a vaga**.
- `proactive/dispatchGate.ts#makeCanDispatch` reúne, na ordem: cadência de 2h do WhatsApp; catálogo
  (`intelligence/catalogGate.ts`, extraído do despachante e reexportado por ele: uma regra só); e `decideCommunication`
  (opt-outs, silêncio, cooldown de 24h do tipo, cotas, override).
- **Ainda fora do portão** (limite conhecido): `meetsMateriality` do despachante, `topic_already_selected`, `dedup_key` de
  14 dias (o histórico do alocador não traz a chave) e `no_active_whatsapp_link`. Entram numa segunda passada, com o replay.

### 4.3 Telemetria por pilar

- Colunas `pillar` em `proactive_situations` e `proactive_decisions` (migração aditiva, nulável).
- Resultado por mensagem (entregue, ação, descarte, silenciou) deriva do que já existe (`insight_kind_learning`,
  `communication_log`); o consolidado por pilar é uma visão SQL. Nada de tabela nova de eventos nesta etapa.

### 4.4 Plano do dia crítico

- `buildWeekendForecasts` hoje é fixo na sexta/fim de semana; `buildWeekdayProjection` já detecta qualquer dia.
- Novo: `dayPlan` escolhe o **dia crítico** (maior excesso recorrente) com os filtros anti-padrão-falso:
  mesma tendência nas duas metades da janela de 12 semanas, ≥ 6 ocorrências, razão ≥ 1,6, fora de categoria de data fixa.
  Um plano de dia ativo por vez.
- `weekend_commitments` ganha `plan_weekday smallint` e `outcome_band`/`vs_typical_pct`; o nome `friday` permanece
  por compatibilidade (passa a significar "data do plano").
- Resultado graduado (`met | partial | missed`) com `vs_typical_pct` (hoje só `missed/met`).
- Degrau: se a meta exige corte > 25% sobre o padrão, o teto proposto é o ponto médio entre o padrão e o que a meta permite.

## 5. Estado da meta decide a mensagem (dentro de Antecipar)

| Situação | Mensagem |
|---|---|
| Tem meta e ainda cabe | "Nas últimas N sextas você gastou X; para fechar na meta Y cabe Z." + plano com degrau |
| Tem meta e já estourou | Sem "planejar". Recuperação ("o que ainda dá para salvar") ou silêncio |
| Sem meta e padrão forte | Compara com a média e oferece criar o teto ("quer um teto de Lazer?") |

## 6. Serviços e arquivos afetados

| Área | Arquivo / objeto | Mudança |
|---|---|---|
| Alocador | `supabase/functions/_shared/proactive/ranking.ts` | parâmetros opcionais `pillars`, `canDispatch` |
| Novo | `supabase/functions/_shared/proactive/pillars.ts` | taxonomia, cotas, ordem |
| Pipeline | `proactive/pipeline.ts` | monta `pillars`/`canDispatch` atrás da flag; grava `pillar` |
| Política | `intelligence/communicationPolicy.ts` | só leitura (reuso de `decideCommunication`) |
| Despachante | `agent/core/CommunicationDispatcherV3.ts` | refatoração sem mudança de comportamento: `catalogAllowsChannel` e `CatalogEntry` movidos para `intelligence/catalogGate.ts` e reexportados |
| Novo | `intelligence/catalogGate.ts`, `proactive/dispatchGate.ts` | regra do catálogo compartilhada; portão `canDispatch` |
| Cadência | `intelligence/proactiveWhatsappCadence.ts`, `agent-proactive-tick/index.ts` | só leitura da constante (2h); a cadência real continua no tick |
| Flag | `agent/core/FeatureFlags.ts` + `agent_runtime_flags` | `comm_pillars_v1` (default desligada, por usuário) |
| Plano | `weekdayNudge.ts`, `weekendForecast.ts`, `weekendCommitments.ts`, `weekendRecap.ts` | Fase 4 |
| Entrada | `whatsapp-webhook/index.ts`, `nino-insights/index.ts` | aceite do plano (Fase 4) |
| App | `src/lib/behavioral/weekendCommitment.ts`, tela de hábitos | mostrar o plano e o resultado graduado (Fase 4) |
| Banco | `proactive_situations`, `proactive_decisions`, `weekend_commitments` | colunas aditivas |
| Testes | `src/test/proactive-multifinance.test.ts`, `nino-reminders-discovery-v1.test.ts`, `nino-weekend-commitments.test.ts` | devem continuar verdes sem alteração |
| CI | `.github/workflows/nino-conversation-ci.yml` (2 listas) | registrar os testes novos |

Não afetados: motores de cálculo financeiro (`finance-core`), Home, Relatórios, Metas, Ticket, agente conversacional.

## 7. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Mexer em mensagens reais de todos os usuários | Tudo atrás de `comm_pillars_v1`, **desligada por padrão**; sem a flag, o caminho é o atual (teste de equivalência) |
| Cota vira mensagem de enchimento | Vaga liberável; só reserva com item elegível e material |
| Segurança atrasada por cota | Crítico/atraso/≤3 dias passa por cima de pilar e teto |
| Volume | Teto único de 5/dia; Proteger não crítico consolidado (etapa posterior) |
| Padrão falso (7 dias × N categorias) | Persistência nas duas metades, ocorrências mínimas, razão mínima, 1 plano ativo |
| Divergência alocador × despachante | `canDispatch` usa a mesma função do despachante |
| Cap em pontos com multiplicador piloto | O teto de 5 passa a ser contagem; revisar `attention_weights` depois |

## 8. Rollout e rollback

1. Fases 1–2 no ar com a flag desligada (nenhum efeito em produção).
2. **Replay de 40 dias** (somente leitura) sobre as decisões reais da conta dona: volume por dia e por pilar, e o que teria chegado.
3. Ligar para a conta dona; observar 1 semana (volume, ação, silenciamentos).
4. Só então ampliar. Rollback = desligar a flag (sem migração reversa; colunas aditivas ficam).

## 9. Plano de testes

- Equivalência: sem `pillars`, a saída de `allocateAttention` é idêntica à atual (suítes existentes).
- Pilares: crítico passa o teto; vaga de Antecipar usada na manhã quando há item elegível; vaga liberada quando não há;
  teto de 5; `canDispatch` bloqueia sem consumir vaga; tipo desconhecido → Organização.
- Replay com fixtures extraídas das decisões reais (30/10).

## 10. Pendências e decisões abertas

- Consolidar vários Proteger não críticos numa só mensagem (digest).
- Ajustar `attention_weights`/`pilot_budget_multiplier` depois que o teto por contagem existir.
- Limpar o valor semanal que gravei para a conta dona (25 → vale 14) quando o teto por contagem entrar.

## 11. Plano do dia crítico e fim dos experimentos genéricos (decisões de 05/11/2026)

- **Cartão do plano fica em Metas** (não na Home): "Seu plano de {dia}" junto das metas de gasto. Sem plano algum, não aparece.
- **Experimentos genéricos aposentados** (check-ins, revisão, patrimônio): saiu o convite "Experimentos opcionais de 30 dias" da
  tela legada; quem já tinha um em andamento continua vendo o quadro, sem botão de começar outro. O usuário com hábitos v2
  (WhatsApp ativo, inclusive a conta dona) já não via experimentos. Os dados e as funções do banco ficam intactos.
- **Por que a tela antiga não servia** [verificado na conta dona]: 3 experimentos genéricos iniciados em 20/09, 2 expiraram
  (7/10 check-ins, 2/4 aportes), 1 concluído (revisão); recolhidos no fim da página e sem aviso; o que usava o padrão da pessoa
  (plano de sexta) vivia só no WhatsApp.
- **Resultado graduado** (`src/lib/behavioral/dayPlan.ts#gradeDayPlan`): `met` (dentro do plano), `partial` (acima do teto mas
  ≥ 10% abaixo do padrão) e `missed`. O plano de 09/10 (teto R$ 160, padrão R$ 271,62, gasto R$ 169,58) era "falhou"; passa a
  "abaixo do seu padrão (38%)". A média só aparece com 3 planos medidos e diz que não prova causa.
- A tabela `weekend_commitments` não muda (sem migração): o nome do dia vem da data (`friday` guarda a data do plano).

### Próximas entregas (atrás de flag, depois do replay)
1. Mensagem do plano para o **dia crítico** (não só sexta): escolha do dia com persistência nas duas metades da janela, três
   situações pelo estado da meta (cabe / já estourou / sem meta), degrau quando o corte pedido passa de 25%.
2. Fechamento no dia seguinte com a nota graduada e uma pergunta de barreira só quando foi mal (hoje o servidor ainda grava
   `kept/missed` binário em `recordCommitmentOutcomes`; o cartão já mostra a nota graduada calculada dos valores).
3. Telemetria por pilar.

### 11.1 Fase 4b: acordeão "Planos e experimentos" e criação pelo app (implementada)

- Em Metas, abaixo das metas: acordeão fechado com uma linha de resumo; abre sozinho quando há plano ativo.
- "Criar um plano": categoria, dia da semana (padrão = dia mais forte), teto sugerido. Sugestão: padrão do dia (média das
  últimas 8 ocorrências) cruzado com o que a meta permite por ocorrência; corte >25% vira degrau no meio; sem meta, 10% abaixo.
- Um plano ativo por vez. Usa as funções `habit_limit_accept/decline` existentes (sem migração); só para quem tem hábitos v2.
- Limite conhecido: plano de sexta cobre sex–dom; os demais dias são medidos pelo app (`client_measured`), pois o fechamento
  do servidor ainda é só da sexta (Fase 4c).
