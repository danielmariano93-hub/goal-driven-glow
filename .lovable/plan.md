# Auditoria somente leitura — estado após `914947a9`

Nenhum arquivo, migration, função, dado ou deploy foi alterado. Foram executadas apenas leituras (git, ripgrep, `SELECT` via psql, logs de edge) e a suíte de testes existente.

## Resumo por classe de evidência

| Item | Comprovado em código | Comprovado em produção/runtime | Não comprovável |
| --- | --- | --- | --- |
| 1. Edge deployadas com o código novo | sim (código presente no commit) | parcial (só `agent-chat` e `nino-intelligence-tick` têm log de boot pós-deploy) | versão exata do bundle de `agent-run`, `whatsapp-webhook`, `agent-proactive-tick` |
| 2. Migration debt alerts | sim | sim | — |
| 3. 9 tools no registry + router | sim | não (nenhuma execução real registrada) | — |
| 4. App e WhatsApp no mesmo `handleTurn` | sim | não observado no período | — |
| 5. Motores em proatividade/Home/Relatórios | não — não são consumidos | n/a | — |
| 6. `forecast_month_close` com low/high/backtest/seasonal | sim | não (sem run recente) | — |
| 7. Testes específicos | parcial | resultado atual: 33 testes passando nos arquivos relevantes | — |

## 1. Deploy das Edge Functions

- Commit atual do checkout: `914947a` ("Implementou engenharia de agentes"). `engineTools.ts`, `answerFormat.ts`, `CapabilityRouter.ts` atualizado e as tools novas estão presentes no repositório.
- Logs de edge (única evidência de runtime disponível): `agent-chat` → `2026-08-12T09:26:32Z shutdown`; `nino-intelligence-tick` → `2026-08-12T09:27:10Z shutdown`. Esses reinícios são compatíveis com redeploy recente.
- `agent-run`, `whatsapp-webhook` e `agent-proactive-tick`: **"No logs found"**. Sem invocação recente, não há evidência de runtime de que o bundle em produção contenha o código novo. Não é possível ler o hash/bundle deployado com as ferramentas disponíveis — classificado como **não comprovável** sem uma invocação de teste.

## 2. Migration de dívida — aplicada em produção

- `pg_proc` confirma `public.nino_diag_detect_debt_alerts` (definição com 5.897 caracteres) e `public.nino_refresh_diagnosis`.
- `nino_refresh_diagnosis` **chama** `nino_diag_detect_debt_alerts` (verificado em `prosrc`).
- Migrations no repo: `20260812092047` (função + detectores `debt_overdue` / `debt_due_soon`) e `20260812092339` (grants a `service_role`).
- Efeito real ainda **não observado**: `financial_situations` não tem nenhuma linha `debt_due_soon` ou `debt_overdue`; `nino_intelligence_items` não tem nenhum item com `dedup_key` de dívida. O item mais recente é de `2026-08-12 01:00`, ou seja **anterior** à aplicação da migration (~09:20). Existem 3 dívidas ativas com parcela e saldo > 0, portanto o detector tem substrato — falta apenas um ciclo de diagnóstico rodar após a migration.

## 3. Tools novas no registry e no roteamento

- Implementadas em `supabase/functions/_shared/agent/engineTools.ts`: `analyze_merchants`, `merchant_profile`, `explain_behavior_change`, `discover_recurring`, `analyze_cost_structure`, `detect_spending_anomalies`, `find_savings_opportunities`, `analyze_financial_evolution`, `get_debt_status`.
- Registradas em `tools.ts` (import, re-export e entradas com `execute:` nas linhas ~2038–2121). O teste de catálogo confirma 51 definições OpenAI expostas.
- Roteamento em `CapabilityRouter.ts`: grupo `leaks` (capability `money_leaks`) cobre 7 tools; grupo `debts` com `required_tool: "get_debt_status"` (capability `debt_status`, execução determinística); `analysis` e `general` também incluem parte das tools novas.
- Cobertura de gatilhos por regex: dívida (`divida|parcela|atrasad|vencid|...`) e vazamentos (`escapando|assinatura|recorrente|economizar|fixo|anomalia|estabelecimento|...`). `discover_recurring`, `analyze_cost_structure` e `find_savings_opportunities` só são alcançáveis via `money_leaks`/LLM escopada — não têm rota determinística própria.
- **Runtime não comprovado**: `agent_runs` só tem execuções `path = fast_log` (últimas: 12/08 02:08, 11/08 …), todas sem `capability`, `tool_scope` ou `tools_used`. Não há nenhum turno de LLM registrado após o deploy, logo nenhuma prova de que as tools foram efetivamente chamadas em produção.

## 4. Paridade App / WhatsApp

Comprovado em código: `AppAdapter.ts` (linha 168) e `WhatsAppAdapter.ts` (linha 17) chamam o mesmo `handleTurn` de `AgentCore.ts`, e o escopo de tools vem de `capability.allowed_tools` dentro do próprio Core (linhas 157/290/303/604/665). Portanto ambos os canais usam o mesmo registry e o mesmo router. Não há evidência de runtime no período (sem runs de LLM registrados em nenhum dos canais).

## 5. Motores novos em proatividade / Home / Relatórios — **gap real**

Busca por consumidores dos módulos (`merchantIntelligence`, `behaviorChange`, `recurringDiscovery`, `costStructure`, `savingsOpportunities`, `financialEvolution`, `anomalies`, `debtStatus`):

- Consumidores encontrados: apenas `agent/engineTools.ts`, `agent/tools.ts`, `agent/prompt.ts`, `agent/core/CapabilityRouter.ts` e os próprios arquivos espelhados em `_shared/finance-core/`.
- `nino-intelligence-tick/index.ts` não importa nenhum deles (só `supabase-js` e cors — o trabalho é todo em SQL).
- `agent-proactive-tick/index.ts` importa `ProactiveEngineV2`, `UserProfile`, `NotificationDispatcher`, `BehaviorService`, `AdvisorReviewServiceV2` — nenhum motor novo.
- Nenhum arquivo de `src/pages` ou `src/components` importa os motores; no frontend eles existem apenas como arquivos espelhados em `src/lib/engine/`.

Conclusão objetiva: os 9 motores estão **somente sob demanda no assessor**. Home, Relatórios Inteligentes, insights e proatividade continuam usando os caminhos antigos (SQL do diagnóstico, catálogo de highlights, detectores em `InsightsEngine`/`ProactiveEngineV2`).

## 6. `forecast_month_close`

Comprovado em código (`tools.ts`, linhas 1169–1213):

- Ponto central continua vindo de `computeAgentSnapshot` (mesmo snapshot canônico da Home/WhatsApp) — preservado.
- `computeForecast` roda em paralelo; a largura da banda estatística é transposta para o ponto canônico (`low`/`high`), com `Math.max(0, …)` no piso.
- `backtest_summary` e `seasonal_adjust` vêm do estimador (`statistical.backtest_summary`, `drivers.seasonal_adjust`).
- Sem amostra: `low`/`high` ficam `null` e são adicionadas notas explícitas ("mínimo 30 dias com movimento", "mínimo 2 meses fechados"), sem zero disfarçado. `seasonal_adjust` cai para `0` quando não há estimador — é o único campo que não distingue "sem amostra" de "sem sazonalidade".
- Não comprovado em runtime: nenhuma chamada real registrada após o deploy.

## 7. Testes automatizados — estado atual

Executados agora (leitura):

- `src/test/agent-capability-reliability.test.ts` — 11 testes, **passou** (inclui roteamento de capacidades e contagem de 51 tools).
- `src/test/analytics-forecast.test.ts` — 3 testes, **passou** (cobre o estimador `analytics/forecast`, não a tool `forecast_month_close` com banda transposta).
- `src/test/finance-core-parity.test.ts` — 19 testes, **passou** (paridade App ↔ Edge dos módulos espelhados, incluindo os novos; `debtStatus` está na lista do `scripts/sync-finance-core.mjs`).

Lacunas de teste confirmadas por busca em `src/test`: **nenhum** arquivo referencia `engineTools`, `answerFormat` ou `debtStatus`. Ou seja, não existem testes para:

- execução das 9 engine tools (caso vazio / caso com dados);
- formato canônico de resposta (`answerFormat.ts`);
- `forecast_month_close` v2 com e sem amostra para banda/backtest;
- motor `debtStatus` (em dia, vence em 3 dias, 1 ciclo atrasado, 2 ciclos, dívida sem parcela);
- roteamento `money_leaks` / `debt_status` no `CapabilityRouter` (o teste atual cobre outras capacidades);
- paridade funcional App/WhatsApp de resposta (só há paridade de módulos de cálculo).

## 8. Gaps de integração identificados

1. **Motor existe mas não é consumido fora do assessor** (confirmado): proatividade, Home, insights e Relatórios Inteligentes não chamam nenhum dos 9 motores novos.
2. **Detector de dívida aplicado mas nunca executado** (confirmado): função e wiring em `nino_refresh_diagnosis` existem, 3 dívidas elegíveis existem, e ainda assim há 0 situações/itens `debt_due_soon`/`debt_overdue` — o último ciclo de diagnóstico é anterior à migration.
3. **Deploy não comprovável para 3 funções** (`agent-run`, `whatsapp-webhook`, `agent-proactive-tick`): sem logs, sem invocação recente.
4. **Runtime das tools não comprovado**: `agent_runs` só registra `fast_log` desde 10/08 — nenhuma execução de LLM com `tool_scope`/`tools_used` após o deploy. Não é possível afirmar que o Nino já respondeu usando um motor novo em produção.
5. **Cobertura de testes ausente** nos pontos listados no item 7 — o risco de regressão silenciosa nas engine tools e no `answerFormat` é real.
6. **Rota determinística parcial**: `discover_recurring`, `analyze_cost_structure` e `find_savings_opportunities` dependem da escolha da LLM dentro de `money_leaks`; não há `required_tool` garantindo a fonte canônica como em `debt_status`.
7. **`seasonal_adjust = 0` sem estimador** não é distinguível de sazonalidade neutra (inconsistente com o tratamento `null` de `low`/`high`).

## Como fechar os gaps (não executado)

Se quiser, o próximo passo seria um bloco de verificação/execução separado, com autorização explícita, contendo: um ciclo de diagnóstico para validar os alertas de dívida em dados reais, uma invocação controlada de `agent-chat`/`agent-run` para provar o runtime das tools, redeploy explícito das 3 funções sem log, os testes faltantes e o consumo dos motores por proatividade/Home.
