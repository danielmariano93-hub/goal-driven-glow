# Conclusão da arquitetura do Nino — 10 gaps da auditoria

Escopo cirúrgico: fechar apenas os gaps abaixo, sem refatoração ampla e sem tocar em regras financeiras já validadas.

## Estado atual verificado

- `CapabilityRouter.ts` já tem as capabilities `merchant_distribution` (deterministic, `required_tool: merchant_distribution`) e `financial_evolution` (deterministic, textual), e já removeu evolução/tendência de `visualization`.
- `DeterministicAnswers.ts` só possui formatters para `financial_snapshot`, `goals_overview`, `before_spending`, `recent_transactions`, `spending_for_date` e `forecast_month_close` — **não há formatter para `merchant_distribution` nem para `financial_evolution`**, então `executeDeterministicCapability` cai no caminho genérico/LLM.
- `intelligence/chartIntent.ts` já exige palavra visual explícita (`grafico|chart|visual|linha|barras|pizza|donut`).
- `AgentCore.ts` linha ~610 ainda define `chartRequested` com regex que inclui `evolu[çc][aã]o|tend[eê]ncia|dia a dia|por dia`, alimentando `artifactExpected` do ResponseValidator e o fallback `ensureRequestedArtifact` — é aqui que "evolução" ainda vira gráfico.
- `ConversationOrchestrator.buildTurnPlan` gera `tasks[]`, e o `AgentCore` hoje só une escopo de tools e injeta instrução no prompt: a execução das subtarefas continua dependendo da LLM.
- Estado conversacional existe apenas como jsonb genérico em `agent_sessions.state` (`StateManager.ts`), sem tópico/categoria/merchant/período ativos.
- `TruthValidator.ts` valida valores e percentuais contra a evidência, mas sem proveniência (claim → tool → campo) nem validação de ranking/direção de variação/coverage.
- Pipeline de importação já é único em `_shared/import/` (`parseBatch` → `schema` → `dedupe` → `stage` → `commit`); falta confirmar que imagem/PDF/CSV/OFX convergem para o mesmo draft e cobrir isso com testes de paridade.

## Implementação

### 1. Formatter determinístico de merchant distribution
- `DeterministicAnswers.ts`: novo `formatMerchantDistribution(result)` que lê exclusivamente o contrato `merchant_distribution.v1` (category_total, merchants[], share, coverage/resolved/unresolved, período). Ordena por valor decrescente usando os campos do motor, imprime `N. Merchant — R$ X · Y,Z%`, cita não identificados só quando `unresolved > 0` e material, e reconcilia soma vs total (se divergir além de R$ 1, informa cobertura parcial em vez de esconder).
- Registrar no dispatch de `executeDeterministicCapability` (`merchant_distribution` e também `financial_evolution`, hoje sem formatter) para nunca retornar à LLM.

### 2. "Evolução" nunca é gráfico
- `AgentCore.ts`: substituir o regex local de `chartRequested` por uma função única compartilhada `hasExplicitChartIntent(text)` (exportada de `intelligence/chartIntent.ts`), baseada só em intenção visual explícita (gráfico, chart, visualizar, plotar, em linha/barras/pizza).
- Usar essa função em todos os pontos: `artifactExpected` do ResponseValidator, `ensureRequestedArtifact` e qualquer fallback de artefato.
- Remover `evolução|tendência|dia a dia|por dia` de qualquer detecção de intenção visual.

### 3. Composite Query Executor real
- Novo `agent/core/CompositeExecutor.ts`: recebe `turnPlan.tasks`, mapeia cada subtarefa para capability/tool via `classifyCapability`, executa via `runTool` com período compartilhado do `turnPlan`, deduplica chamadas idênticas (tool + args), mantém a ordem da pergunta e registra `status` por task (`ok | empty | failed | skipped_duplicate`).
- Agregação determinística: cada task ok formata seu bloco com o formatter determinístico correspondente; tasks falhas entram como limitação pontual ("essa parte eu não consegui agora"), sem inventar dados.
- `AgentCore.ts`: quando `turnPlan.composed` e ≥2 capabilities distintas, executar o Composite Executor antes do planner; se todas as tasks tiverem resultado determinístico, responder sem LLM; caso contrário passar os resultados como evidência para a camada de conversa (com Truth Validator ativo).

### 4. Memória conversacional persistente
- Novo `agent/core/ConversationMemory.ts` gravando em `agent_sessions.state.conversation` (sem migration, sem misturar com verdade financeira): `current_topic, previous_intent, active_category, active_merchant, active_period, comparison_period, pending_action, pending_slots, last_tool_context, conversation_summary, updated_at`.
- Escrita no fim do turno a partir das tools executadas (só slots derivados de ferramentas canônicas, nunca interpretações). Leitura no início, integrada ao `buildTurnPlan` para herdar categoria/merchant/período em follow-ups ("E julho?", "voltando para alimentação...").
- Expiração: memória com `updated_at` acima de 6h (ou troca explícita de tópico) é descartada para evitar contaminação.

### 5. Truth Validator V2 — proveniência
- `TruthValidator.ts`: construir um índice de claims a partir das tool calls (`{ value, source_tool, source_field, period }`) percorrendo os resultados; validar valores, percentuais, totais/subtotais, coverage, ranking (ordem dos merchants/categorias citados deve bater com a ordem do motor), comparação entre períodos e direção da variação (aumentou/caiu).
- Ferramenta vence sempre: contradição corrigível → headline canônica; não corrigível → remover a afirmação e responder sem ela. Proveniência fica na telemetria (`metrics`), não é exposta ao usuário.

### 6. Refund matcher com estado de revisão
- Migration: coluna `refund_match_status` em `transactions` (`not_evaluated | matched | no_candidate | ambiguous | needs_review`) + `refund_match_evaluated_at`, e atualização de `match_refund_candidate` para gravar o estado (alta confiança vincula; ambíguo marca `ambiguous`/`needs_review`; sem candidato marca `no_candidate`). Idempotente: reprocessar não muda estado nem cria vínculo duplicado.
- Backfill dos estornos existentes classificando os já analisados (inclusive os 9 ambíguos conhecidos).

### 7. Paridade do pipeline de importação
- Auditar os pontos de entrada (texto/JSON no agente, imagem/PDF via ingestão documental, CSV/OFX) e garantir que todos convergem para o mesmo `DraftTransaction[]` de `_shared/import/schema.ts` antes de normalização, merchant resolution, categoria, movement_kind, dedupe, validação, batch, confirmação e persistência. Ajustar apenas os adaptadores que ainda divergirem — extração permanece específica.

### 8. Acknowledgement contextual por latência real
- No webhook/WhatsApp e no assessor do app: agendar ack por timer (nada até ~1,5s; mensagem curta contextual acima de ~3s; segundo aviso em operações realmente longas), com texto por capability (forecast, comparação, merchant, importação). Cancelar o ack se a resposta chegar antes. Frases proibidas: "Processando...", "Aguarde...", "Analisando sua solicitação...".
- Garantir que resposta final bem-sucedida nunca acompanha erro genérico.

### 9 e 10. Testes E2E e regressão
- Novo `src/test/nino-brain-v2-e2e.test.ts` (fluxo mensagem → routing → planning → tools → validator → resposta, com Supabase e tools mockados): merchant distribution (ranking, share, denominador, total), "como está minha evolução financeira?" (sem gráfico), follow-up transporte agosto → "e julho?", pergunta composta com 3 partes respondidas, JSON com 4 lançamentos → 4 drafts, refund ambíguo → abstenção + needs_review, "faça um gráfico" gera artefato.
- Novo `src/test/nino-brain-v2-regression.test.ts`: merchant "99" numérico, 99 Food ≠ corrida 99, 99 Food em Alimentação, Seguro do cartão em Seguros, PagSeguro sem regra universal de Educação, Autopass consolidado, `analyze_merchants` respeitando from/to, percentual sobre total da categoria, períodos relativos, weekday de baixa confiança sem recusa, JSON com múltiplos drafts.
- Testes unitários novos para `formatMerchantDistribution`, `CompositeExecutor`, `ConversationMemory` e proveniência do Truth Validator; suíte completa (`vitest run`) deve continuar verde.

## Entrega

Ao final, matriz por requisito: arquivo alterado, lógica, teste, resultado, migration (quando houver) e comportamento esperado vs observado — incluindo verificação em runtime das funções publicadas (assessor e WhatsApp).
