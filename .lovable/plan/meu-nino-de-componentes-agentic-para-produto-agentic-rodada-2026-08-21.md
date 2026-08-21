# Meu Nino: de componentes agentic para produto agentic (rodada única de conclusão)

Auditoria feita agora no código e no banco de produção. Abaixo o que está realmente funcionando, o que está criado mas desligado, e o plano único para fechar tudo E2E.

## Estado real (verificado nesta rodada)

Funcionando de verdade (reutilizar, não reescrever):
- `AutonomyPolicy.ts`, `CapabilityRegistry.ts`, `PersistenceProof.ts`, `GoalPlanner.ts`, `ReceiptBuilder.buildActionReceipt`, `ShortLinks.buildShortLink` — lógica correta e testável.
- RPCs existem em produção: `create_short_link`, `resolve_short_link`, `admin_v2_agent_autonomy`, `agent_learn_merchant_category`, `advisor_register_topic_signal`.
- Verdade financeira canônica (`finance-core`), motor de relatórios e Truth Gate v2 no `AgentCore`.

Criado mas NÃO entregue (evidência de produção):
- **GoalPlanner só audita**: em `AgentCore.ts:894` o plano é montado DEPOIS da execução, só para gravar `agent_decisions.planned_steps` (172 linhas gravadas). Não decide nada, não sequencia nada, não trata pedido multi-step.
- **Action Receipt não usado**: `buildActionReceipt` não é chamado por nenhum caminho de produção. Os quatro caminhos reais (`tools.ts:861`, `AppAdapter.ts:110`, `PolicyEngine.ts:50`, `AgentCore.ts:351`) usam `buildReceipt`, que no default devolve "Pronto, registrei. ✅".
- **Persistence Proof parcial**: `verifyPersisted` só é chamado em `PendingConfirmations.ts`. Os outros três caminhos de confirmação não provam nada.
- **Short links não universais**: usados só em `financial-reports-generate`. `short_links` = 0 linhas, `short_link_clicks` = 0.
- **Relatório do mês atual não existe na prática**: `financial_reports` tem `weekly` (17) e `monthly` (2); `monthly_partial` = **0**. A projeção é linear ingênua (`engine.ts:393`: `expense * pace`).
- **Backlog de categorização**: 606 transações confirmadas, **26 sem categoria e sem `category_source`**, nenhuma marcada como needs_review.
- **Advisor learning inerte**: `user_advisor_topic_affinity` = 1 linha; nenhuma decisão consome afinidade de forma comprovável.
- **Capability Registry cobre 32 de ~59 tools** existentes em `tools.ts`; faltam investimentos, patrimônio, resgates, recorrências/assinaturas, contas, categorias, parcelas, compromissos, desafios, preferências, relatórios, insights.

## Plano de execução (ordem obrigatória)

### Etapa 1 — Núcleo agentic: planner antes da execução
- `GoalPlanner.ts`: aceitar múltiplos objetivos por turno (decomposição de pedidos compostos), dependências entre passos, e passos de recálculo pós-escrita.
- `AgentCore.ts`: mover a construção do plano para ANTES do loop de execução; o plano passa a ser o contrato do turno (quais tools rodam, em que ordem, o que exige confirmação). O bloco de auditoria pós-execução some.
- Novo `PlanExecutor.ts` em `agent/core`: executa passos em ordem via `ToolRuntime`, para no primeiro passo bloqueado pela política, mantém resultados intermediários (fatura → valor → impacto → meta) e devolve recibo consolidado.
- Persistência do plano: colunas novas em `agent_runs` (`goal`, `plan`, `plan_status`) e em `agent_steps` (`capability_key`, `risk`, `depends_on`, `autonomy_mode`, `proof`, `receipt`) — migration com GRANTs.

### Etapa 2 — Política, prova e recibo universais
- `ToolRuntime.ts`: toda tool de escrita passa obrigatoriamente por `decideAutonomy`; negação vira pedido de confirmação explicado, nunca sucesso simulado.
- `PersistenceProof.ts`: ampliar o mapa kind→tabela para todos os kinds de escrita (investimentos, movimentos, recorrências, parcelas, split, desafios). Ponto único de execução de confirmação (`PendingConfirmations.executeConfirmation`) usado por `tools.ts`, `AppAdapter.ts`, `PolicyEngine.ts` e `AgentCore.ts:351` — os quatro caminhos deixam de ter lógica própria.
- `ReceiptBuilder.ts`: `buildActionReceipt` passa a ser o único emissor de recibo, com contexto resolvido (conta, cartão, categoria, competência, vencimento, parcelas) e regra dura: sem proof, mensagem honesta de falha + registro na observabilidade. O default "Pronto, registrei. ✅" é removido.

### Etapa 3 — Capability Registry cobrindo o produto
- Auditar `tools.ts` e as telas do app; registrar em `CapabilityRegistry.ts` cada capacidade realmente implementada com `reads/writes`, tool, dados obrigatórios, fonte de verdade, risco, política de confirmação, tipo de proof e tipo de recibo.
- Onde o app faz e o agente não: criar a tool faltante sobre RPC/serviço já existente (investimentos e resgates, patrimônio, recorrências/assinaturas, contas, categorias, parcelas futuras, compromissos, desafios, preferências, relatórios, insights). Nenhuma capability sem implementação real.

### Etapa 4 — Relatório inteligente completo
- **Projeção multi-financeira** (novo `src/lib/reports/intelligent/projection.ts`, espelhado para `reports-core` pelo gerador `scripts/sync-finance-core.mjs`): `projected_closing = { realized, installments_known, recurring_known, commitments_known, variable_projection, expected_total }`, cada componente com provenance e dedupe contra double counting (parcela já realizada não entra duas vezes; fatura só quando aplicável). Substitui `expense * pace` como fonte principal.
- **Mês em andamento como experiência natural**: `RelatoriosInteligentes.tsx` e `RelatorioInteligenteDetalhe.tsx` mostram o mês corrente no topo, sempre disponível, rotulado "Mês em andamento" com dias decorridos, dias restantes, data de referência e aviso de projeção. Nunca "período fechado".
- **Comparação correta**: `periods.ts` compara 01→hoje contra 01→mesmo dia do mês anterior (já parcialmente feito; validar e cobrir por teste).
- **Storytelling**: `narrative.ts` responde na ordem definida (como estou → melhor/pior → para onde foi → o que explica → o que ainda vem → como fecho → o que merece atenção → o que fazer agora), a partir só de fatos determinísticos; a IA verbaliza e o `numericGuard` continua bloqueando número inventado.
- **Visualizações** com o design system atual: acumulado do mês vs. período comparável, composição por categoria, entradas × saídas, waterfall da projeção de fechamento, e mudanças relevantes (subiu/caiu).
- Geração real de `monthly_partial` em `financial-reports-generate`, com regeneração forçada (mês aberto muda) e evidência SQL ao final.

### Etapa 5 — Categorização: zerar backlog e fechar o loop
- Backfill idempotente via `category-engine` para TODOS os usuários elegíveis: regra determinística → merchant intelligence → afinidade do usuário → classificador, gravando `category_id`, `category_source`, confiança e provenance. O que não atingir confiança termina como `needs_review`, nunca silenciosamente vazio.
- Autoaprendizado: correção do usuário grava preferência por merchant normalizado e essa preferência é lida no próximo evento (escopada ao usuário, sem vazar entre contas).
- Evidência final: SQL com total, uncategorized (meta zero), needs_review e distribuição de `category_source`.

### Etapa 6 — Learning, proatividade e highlights
- Registro de sinais de afinidade nos dois canais (app e WhatsApp) no caminho real de resposta, não só em rota isolada.
- A afinidade entra no ranking de insights e na seleção proativa com peso limitado e auditável (`proactive_decisions` guarda o score antes/depois), com dedupe e cooldown já existentes.
- Highlights determinísticos alimentam home, relatório, agente e proatividade a partir da mesma fonte.

### Etapa 7 — Short links universais
- `ShortLinks.ts` vira o único serviço: allowlist de targets, TTL, autorização, auditoria de clique e fallback para URL longa. Todos os envios externos (divisão do rolê, metas compartilhadas, relatórios, insights, notificações, proatividade) passam por ele. Nenhuma function monta URL própria.
- Evidência: criação e resolução de um link de teste controlado.

### Etapa 8 — Verdade financeira e conciliação
- Revalidar as fontes canônicas nos domínios sensíveis (conta, cartão, fatura, parcelas, dívidas, patrimônio, investimentos, transferências, resgates, pagamentos, metas, recorrências).
- Resgate de investimento → conta é transferência patrimonial: não aumenta renda, não duplica patrimônio, não desaparece dos indicadores. Teste dedicado.

### Etapa 9 — Observabilidade agentic
- `admin_v2_agent_autonomy` estendida para o funil completo pedido → goal → plan → step → capability → tool → policy → write → proof → receipt, com taxa de proof, confirmações pedidas/aceitas, ações bloqueadas, falhas de tool/planner/recibo e latência.
- `AgenticObservabilityBoard.tsx` com filtros por período, usuário, capability, canal e status, sem expor PII fora do contexto admin autorizado.

### Etapa 10 — Testes e evidências
- Testes E2E (app e agente) cobrindo os 24 casos A–X do pedido, incluindo multi-step via planner, falha de proof e falha de tool.
- Bateria conversacional das 18 perguntas listadas, cada uma com capability, fonte de verdade, tool, resposta esperada, observada e PASS/FAIL.
- Varredura anti-mock: remover fallback que inventa número, sucesso sem persistência e dado hardcoded usado como verdade.
- Entrega final como matriz REQUISITO / STATUS (PASS·FAIL·BLOCKED) / ARQUIVOS / MIGRATIONS / TOOLS·RPCS / TESTES / EVIDÊNCIA / RESULTADO EM PRODUÇÃO, mais as 18 evidências pedidas. Sem "parcial" como DONE.

## Riscos e mitigação
- **Regressão no `AgentCore`** ao mover o planner para antes da execução: manter o roteador atual como caminho do plano de passo único, então o comportamento de hoje continua sendo o caso trivial; suíte completa antes de deploy.
- **Double counting na projeção**: cada componente carrega provenance e a soma é conferida contra o realizado por teste com dados sintéticos.
- **Backfill de categoria em todos os usuários**: idempotente, em lotes, só preenche o que está vazio, nunca sobrescreve escolha do usuário.
- **Recibo mais rígido**: se o proof falhar, o usuário passa a ver uma mensagem honesta em vez de "registrei" — é o comportamento desejado, e as falhas ficam visíveis no painel.
- Migrations e backfills são as únicas alterações em produção; nada é publicado sem sua autorização.
