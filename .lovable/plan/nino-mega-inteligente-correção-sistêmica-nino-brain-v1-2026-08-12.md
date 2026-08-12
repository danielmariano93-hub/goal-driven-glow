# Nino Mega Inteligente — correção sistêmica (nino_brain.v1)

## Causa raiz provada (produção, leitura)

1. **A previsão do print falhou por coluna inexistente no banco.**
   `agent_tool_calls` (12/08 21:17) registra:
   `forecast_month_close → ok=false → snapshot_source_transactions: column transactions.merchant_name does not exist`.
   `information_schema` confirma: `transactions` tem `raw_description`, `friendly_description`, `posted_at`, `behavioral_day`, `refund_of_transaction_id` — **não tem `merchant_name`**. Nenhuma migration criou essa coluna.
   O select canônico (`src/lib/engine/canonicalFacts.ts`, `_shared/finance-core/canonicalFacts.ts`, `_shared/engine/metrics.ts`, `functions/mcp`, `src/lib/mcp/tools/monthly-summary.ts`) pede `merchant_name`. Ou seja: **todo caminho que passa pelo snapshot canônico morre** — previsão, comparações, motores de estabelecimento/vazamento, resumo mensal, MCP. Não é "problema temporário": é falha determinística 100% das vezes.

2. **Microserviços não chegam ao WhatsApp.**
   `communication_deliveries`: 24 supressões `channel_not_ready` no canal whatsapp, 1 `whatsapp_opt_out`; zero entregas whatsapp proativas.
   `pending_proactive_suggestions`: praticamente tudo nasce com `channel_ready='app'` (duplicate_expense 31, advisor_review 12, dívida/metas/anomalias 1 cada). `communicationPolicy.ts:151` bloqueia quando `channel_ready` ≠ alvo.
   Além disso só **1 de 6 usuários** tem linha em `notification_preferences`, e o loader assume `whatsapp_proactive = false` quando não há linha → o resto do produto está mudo por ausência de default.

3. **Falha vira desculpa, não diagnóstico.** Quando uma tool retorna erro, o modelo improvisa "problema técnico temporário". Não há fallback determinístico, nem telemetria visível, nem teste de contrato entre o select do código e o schema real.

## O que será entregue

### Fase 1 — Verdade de esquema (destrava tudo)
- Migration: `transactions.merchant_name text`, com backfill determinístico a partir de `friendly_description`/`raw_description`/`description` usando a normalização já existente (`merchant.ts`), e índice para consultas por estabelecimento.
- Trigger leve de manutenção: ao inserir/atualizar, preencher `merchant_name` quando vazio (mantendo edição manual do usuário como prioridade).
- **Teste de contrato de schema**: novo teste que compara cada select canônico (app, edge, MCP) com as colunas reais do `transactions`. Divergência = falha de build, nunca mais erro em runtime.
- Guard de resiliência no leitor canônico: se um select falhar por coluna, degrada para o subconjunto essencial e registra `schema_drift` em telemetria, em vez de derrubar a resposta.

### Fase 2 — Nino que responde qualquer pergunta do usuário
- **Roteamento por cobertura**: o `CapabilityRouter` passa a garantir que toda pergunta financeira caia em pelo menos um motor determinístico; nada de "não consigo" quando existe tool.
- **Fallback de erro honesto e útil**: quando uma tool falha, o Nino responde com o que ele *tem* (snapshot parcial) + o que faltou, e o erro técnico vai para `agent_runs.error_sanitized` + alerta no cockpit — nunca "tente mais tarde" sem substância.
- **Retry cirúrgico**: 1 nova tentativa da mesma tool com escopo reduzido antes de qualquer desculpa.
- **Autodiagnóstico**: nova tool interna de saúde de dados (contas ancoradas, lançamentos, dívidas, metas, período coberto) que o Nino usa para explicar por que uma resposta é limitada.
- Prompt consultivo reforçado: fato → delta explicado → evidência/confiança, proibição de cálculo próprio (já existente) + regra nova de nunca alegar falha técnica sem tool com erro real.

### Fase 3 — Microserviços falando pelo WhatsApp (100% dos usuários)
- Todo detector/microserviço passa a declarar `channel_ready='both'` por padrão, com a decisão de canal centralizada na política (severidade, catálogo, quiet hours, cooldown, cap semanal) — o detector deixa de vetar canal.
- `notification_preferences` ganha **default aplicado a todos**: linha criada para todo usuário (backfill + trigger no cadastro), com `whatsapp_proactive = true` para alertas de severidade `attention`/`critical` (dívida vencida, pressão de caixa, anomalia, duplicidade), respeitando horário silencioso 22h–8h, limite diário/semanal e opt-out individual na tela de notificações.
- `communication_catalog`: revisão dos `kind` para permitir whatsapp nos alertas que importam, mantendo `app` para conteúdo editorial leve.
- Dedup lógico mantido (mesma pendência não vira duas mensagens em canais diferentes no mesmo dia).
- Rollout: sem flags parciais — `proactive_rollout_user_ids` vazio e política ativa para todos, como pedido.

### Fase 4 — Insights e highlights realmente vivos
- Os 9 motores determinísticos (vazamentos, assinaturas, mudança de comportamento, custo fixo x flexível, anomalias, estabilidade, economia personalizada, evolução, previsão) passam a alimentar também o ciclo de diagnóstico/Home, não só respostas sob demanda.
- Ciclo de diagnóstico ganha sinais de futuro: fechamento projetado com faixa, compromissos e dívidas dos próximos 15 dias, meta em risco.
- Previsão com faixa confiável: `forecast_month_close` volta a preencher `low`/`high`/backtest/sazonalidade (hoje impossível porque o snapshot quebra antes).

### Fase 5 — Validação com evidência
- Testes: contrato de schema, cobertura de roteamento por pergunta-tipo, política de canal (whatsapp permitido para alerta crítico), agenda de dívida, previsão com faixa.
- Deploy das Edge Functions afetadas (`agent-chat`, `agent-run`, `whatsapp-webhook`, `agent-proactive-tick`, `nino-intelligence-tick`, `insights-generate`, `pulse-compute`, `financial-reports-generate`, `mcp`).
- Prova em produção: repetir "qual a previsão de eu fechar o mês?" no WhatsApp e no app e mostrar a resposta com número, faixa e confiança; mostrar `agent_tool_calls` sem erro; mostrar uma entrega whatsapp proativa com status `delivered`.

## Detalhes técnicos
- Arquivos principais: `src/lib/engine/canonicalFacts.ts` + espelho `_shared/finance-core/canonicalFacts.ts` (via `scripts/sync-finance-core.mjs`), `_shared/engine/metrics.ts`, `_shared/agent/tools.ts`, `_shared/agent/prompt.ts`, `_shared/agent/core/{CapabilityRouter,ErrorRecovery,DeterministicAnswers,ProactiveEngineV2,CommunicationDispatcherV3}.ts`, `_shared/intelligence/communicationPolicy.ts`, `functions/mcp/index.ts`, `src/lib/mcp/tools/monthly-summary.ts`.
- Migrations: `merchant_name` + backfill + índice; default de `notification_preferences` para todos + trigger; ajuste de `communication_catalog`.
- Nenhuma alteração de marca, paleta ou landing page. Nada publicado em produção sem sua autorização.

## Riscos e mitigação
- Backfill de `merchant_name` em toda a base: executado em lotes idempotentes, sem apagar dado, sem alterar valores financeiros.
- Ligar WhatsApp proativo para todos pode incomodar: mitigado por severidade mínima, quiet hours, cap diário/semanal, dedup e opt-out visível.
