# Nino: inteligência proporcional + continuidade de assuntos

Duas frentes, uma arquitetura: o Nino passa a gastar computação proporcional à dificuldade do turno, e passa a manter vários assuntos abertos com o usuário, retomáveis horas ou dias depois.

## O que está confirmado hoje (leituras feitas)

- `ConversationTopicState.ts:13` — `MAX_TOPIC_STATE = 5`: o sexto assunto descarta o primeiro.
- `ConversationMemory.ts:47` — memória de conversa expira em 6h.
- `ContextPipeline.ts:44` — histórico padrão de 12 turnos.
- `AgentCore.ts:147-152` — `reply_context.quoted_message_id` chega ao núcleo (o webhook já o envia, `whatsapp-webhook/index.ts:739`), mas não decide assunto.
- `outbound_messages` já tem `provider_message_id`, `context_type`, `context_id`, `metadata` — dá para ligar mensagem citada ao assunto sem inventar coluna nova.
- `agent_runs` já registra `llm_calls`, `model_tier`, `route_reason`, `stage_ms`, `tool_ms`, `llm_ms`, `context_ms`; não registra tier de execução, escores de complexidade nem resolução de assunto.
- `ContextBudget.ts` só comprime depois de montar o contexto; não existe seleção de blocos antes de carregar.

## Fase A — medir antes de mexer

Baseline por classe de turno (confirmação, lançamento simples, leitura simples, follow-up, análise composta) a partir de `agent_runs` reais: p50/p95 de backend, chamadas de modelo, tokens, tempo de ferramenta e de contexto. Esse baseline é a linha de comparação do relatório final; nada é otimizado antes dele existir.

Novos campos de turno em `agent_runs` (migração idempotente, aditiva): `execution_tier`, `complexity_score`, `ambiguity_score`, `risk_score`, `context_dependency_score`, `context_blocks_loaded/skipped`, `escalation_count`, `escalation_reason`, `early_exit_stage`, `parallel_groups`, `critical_path_ms`, `topic_id`, `topic_match_score`, `topic_resolution_source`, `quoted_message_used`, e marcos de tempo separados (`inbound_received_at`, `agent_started_at`, `first_useful_work_at`, `agent_completed_at`, `outbound_queued_at`, `provider_sent_at`, `provider_ack_at`). `latency_ms` deixa de ser tratado como ponta a ponta.

## Fase B — escada adaptativa de execução

Módulos novos e pequenos, sem engordar `AgentCore.ts`:

- `TurnComplexityClassifier.ts` — sinais baratos e determinísticos (sem modelo) por turno.
- `AdaptiveExecutionRouter.ts` — escolhe tier, orçamento de contexto, tier de modelo, teto de chamadas e de tokens, timeout.
- `ExecutionTrace.ts` — grava decisão, escalações e caminho crítico.

Tiers (uma pipeline progressiva, não cinco pipelines):

- T0 transição de estado: confirmar, cancelar, escolher opção. Zero modelo. Usa o fast path de confirmação já existente.
- T1 estruturado: comprovante bancário reconhecido, escrita simples de alta confiança. Zero modelo quando o parser resolve.
- T2 leitura factual simples: um motor canônico, resposta formatada deterministicamente, sem diagnóstico global.
- T3 análise contextual: retoma assunto/período, Semantic IR quando necessário.
- T4 raciocínio composto: multi-query, vários motores, completude e reconciliação — o caminho atual, preservado integralmente.

Regras: começa no tier mais baixo plausível e escala só quando um gate exigir (`route_confidence`, `topic_confidence`, `evidence_confidence`, `write_safety`, `response_grounding`). Early exit quando intenção, entidades, período, motor e evidência já estão determinados. Nenhuma chamada de modelo apenas para confirmar o que o software já sabe: elimina dupla classificação, planner depois de IR que já mapeou motor, geração de texto quando o formatador determinístico basta e rescue que repete raciocínio já feito.

Roteamento de modelo por complexidade, ambiguidade, risco e necessidade de síntese, registrando `selected_model`, `model_tier` e motivo.

## Fase C — contexto sob demanda e paralelismo

`ContextSelector.ts` decide quais camadas carregar **antes** de carregar (verdade financeira, tópicos, memória episódica/semântica, advisor, diagnóstico, comportamento, snapshot, proatividade, documentos). "Salvar" não carrega diagnóstico nem snapshot; leitura simples não carrega diagnóstico completo. `ContextBudget` continua como rede de segurança, não como estratégia.

Consultas independentes de abertura de turno (sessão, flags, prompt ativo, preferências, memória, histórico, contas, tópicos, pendência) passam a rodar em paralelo. Cache curto apenas de configuração e estrutura (flags, prompt ativo, rotas de modelo, política de comunicação, registry). Saldo, fatura, dívida, metas, pagamentos e lançamentos nunca são cacheados — a fonte canônica continua soberana.

Grafo de dependência de ferramentas: em perguntas multi-domínio, ferramentas independentes executam em paralelo; `TurnEvidenceCache` continua garantindo uma execução por ferramenta por turno.

Orçamentos de latência de backend por tier: T0 500ms/1,5s · T1 1,5s/3s · T2 2,5s/5s · T3 4s/7s · T4 6s/10s (p50/p95). SLO não atingido é reportado com caminho crítico, nunca compensado com resposta incompleta. No app, estado de progresso honesto enquanto o backend trabalha; no WhatsApp, nenhuma mensagem de enchimento.

## Fase D — assuntos duráveis (topic threads)

Nova tabela `nino_topic_threads` (migração idempotente, RLS por usuário, índices por usuário/atualização/estado, retenção): assunto, intenção, entidades, período, mensagens de origem, origem (usuário, Nino, proativo, relatório, insight), `parent_topic_id`, resumo incremental, `last_run_id`, referências de evidência, `status` (`open`, `waiting_user`, `answered`, `paused`, `resolved`, `archived`). `semantic_topic_state` continua como cache operacional de sessão; o limite de 5 deixa de descartar assunto relevante.

Regra absoluta: o tópico guarda **significado e referência**, nunca o número. Ao retomar, o valor é reconsultado nas fontes canônicas.

`MessageTopicLinker.ts` liga toda mensagem relevante enviada pelo Nino ao seu assunto, usando `outbound_messages.context_type/context_id/metadata` — inclusive as proativas, que passam a abrir conversa em vez de sair como texto solto.

## Fase E/F — resolução de assunto

`ConversationResolver.ts`, com escada própria e barata:

1. mensagem citada (`quoted_message_id` → `provider_message_id` → outbound → topic): evidência mais forte, vence recência e similaridade. Sem modelo.
2. confirmação/expectativa pendente. Sem modelo.
3. referência explícita ("voltando à fatura", "sobre transporte"). Busca por metadados.
4. alta similaridade com assunto aberto (`topic_match_score` por recência, relação de resposta, sobreposição de entidades/intenção/período, ato de diálogo, pergunta aberta, referência lexical).
5. assunto ativo · 6. histórico recente · 7. assunto novo.

Ambiguidade real (dois assuntos plausíveis) gera pergunta curta de um só CTA, nunca escolha silenciosa nem explicação longa. Assunto novo não herda contexto anterior. Follow-ups curtos ("e em agosto?", "por quê?", "quais foram?") são resolvidos contra o assunto certo antes de virarem consulta nova. Recuperação é seletiva (1 a 3 assuntos), não histórico inteiro no prompt.

Embeddings só entram se metadados + retrieval lexical não atingirem qualidade suficiente; a decisão vem com benchmark antes/depois e, se adotados, embedam resumo/pergunta, não dados financeiros crus.

Resposta do usuário a um insight pode criar contexto estruturado (ex.: "viajei", com período, origem usuário e TTL) — usado para interpretar comportamento, nunca como verdade financeira. Estado financeiro atual e histórico de conversa ficam separados: responder "já paguei" a um alerta antigo consulta o estado atual e responde coerentemente, sem reviver o alerta.

Backfill seguro e idempotente de âncoras para mensagens proativas e conversas recentes, só com evidência já existente (kind, feature, situação, run, relatório, metadata, texto).

## Fase G — testes

- Benchmark realista das 13 classes de turno pedidas, com antes/depois de p50, p95, tokens, chamadas de modelo e acurácia.
- Testes de continuidade A–J (citação, retomada sem citação, ambiguidade, assunto novo, retomada em dois dias, contexto de viagem, valor revalidado, sexto tópico, mais de 12 mensagens de distância, quote do WhatsApp).
- 20 conversas golden de múltiplos turnos, incluindo mensagem proativa no meio e retomada de assunto antigo, avaliando contexto, correção financeira, naturalidade e latência.
- Regressão de verdade financeira, escritas, proatividade, Semantic IR, WhatsApp e app.

## Fase H — rollout

Flags separadas e fail-closed: `adaptive_execution_v1`, `conversation_threads_v1`, `semantic_topic_retrieval_v1`. Avaliação sombra (decisão nova comparada à atual sem afetar resposta), depois rollout progressivo. Ao fim, a autoridade antiga é desligada — não ficam dois caminhos concorrentes.

Semantic IR, TurnEvidenceCache, CapabilityRegistry, TruthValidator, PendingConfirmations, PersistenceProof e os motores financeiros são integrados e simplificados, nunca substituídos.

## Admin

No painel de IA/latência: por rota — volume, p50, p95, modelo por turno, tokens, tempo de ferramenta, tempo de contexto, taxa de erro, com detalhe por run e resposta a "por que este turno demorou 12s". Visão de resolução de assunto por fonte (citação, metadados, semântica, fallback ativo, clarificação) e as métricas de produto pedidas (escalação desnecessária, retomada bem-sucedida, assunto errado, negação falsa de capacidade, duplicidade de ferramenta).

## Relatório final

Seções A a H: arquitetura antes, arquitetura depois, performance por classe de turno, tabela de continuidade (cenário, tópico esperado, escolhido, confiança, fonte, resultado), testes, regressões, rollout e pendências — com qualquer SLO não atingido declarado explicitamente.

## Publicação

Nada é publicado em produção sem sua autorização explícita; o redeploy atômico das funções que dependem de `_shared/agent` fica pendente até você liberar.
