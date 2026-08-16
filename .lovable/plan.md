# Conclusão do Nino Brain V2 — fechamento dos itens P0/P1 pendentes

Esta rodada é correção/conclusão do escopo anterior. Nada de arquitetura nova: as camadas já existem (`ConversationOrchestrator`, `TruthValidator`, `periodResolver`, `merchant.ts`, `merchantIntelligence.ts`, `CapabilityRouter`, `AgentCore`) e serão completadas no lugar onde já estão.

## O que a auditoria confirmou em produção (verificado por consulta)

- `PIX WHATS QRCODE 99 FOOD02/08` — R$ 70,35 (03/08) está em **Transporte**, com `description` já colapsada para `"99"`. Causa confirmada: as regras de marca em `src/lib/engine/merchant.ts` exigem `99 food` com fronteira de palavra, e `FOOD02/08` (dígitos colados) cai na regra de mobilidade `99`. Mesmo caso em `PIX QRS 99 FOOD` (06/07, Transporte) e `PAY 99Foo` de 23/06 (Transporte).
- Alias `seguro do cartao → Assinaturas` existe e está confirmado por usuário; o lançamento `Seguro do cartão` R$ 12,94 está em Assinaturas. Existe categoria **Seguros** do próprio usuário — destino correto.
- Alias `pagseguro internet i p s a → Educação` existe e está sendo usado como verdade; há 4 lançamentos de R$ 201,60 em Educação sem evidência de merchant econômico.
- Autopass fragmentado: aliases `autopass`, `autopass s a`, `autopass s a atm tmob` (duplicado) e um alias-lixo (frase inteira de conversa) apontando Autopass para **Alimentação**.
- `Estorno Uber` R$ 12,95 (10/08) com `refund_of_transaction_id = null`; existe **exatamente um** candidato compatível: despesa Uber R$ 12,95 de 10/08, mesma conta, sem cartão → vínculo determinístico seguro.
- `CapabilityRouter` linha 228 ainda tem `evolucao|tendencia|dia a dia|por dia` dentro do regex de `visualization`.
- `AgentCore` já injeta `turnPlanPrompt` e chama `validateAgainstEvidence`, mas as `tasks[]` não são executadas como plano e o validador só confere valores em R$.
- Não existe `formatMerchantDistribution` nem estado conversacional persistido (o `StateManager` existe e está sem uso na conversa).

## Entrega

### P0.1 Identidade e categoria determinísticas
- `src/lib/engine/merchant.ts`: separar delivery de mobilidade com dígitos colados (`99 food02`, `99foo`, `pay 99foo`, `99 te`), manter `99/99 app/99 pop/corrida` em mobilidade; consolidar variantes Autopass em um único canônico; manter PagSeguro/PicPay/Mercado Pago como intermediadores sem valor categórico.
- Camada de categorização (`supabase/functions/_shared/categorization/`): mapa determinístico marca→categoria semântica para os casos de intermediador+marca (99 Food → Alimentação, 99 → Transporte), com precedência acima de alias genérico.
- Testes de unidade cobrindo cada variante textual real encontrada no banco.

### P0.2 Saneamento de dados (migration + backfill idempotente)
- Remover/neutralizar aliases inválidos: `seguro do cartao → Assinaturas`, `pagseguro internet i p s a → Educação`, alias-frase que aponta Autopass para Alimentação; deduplicar Autopass.
- Reclassificar com evidência: lançamentos 99 Food → Alimentação; `Seguro do cartão` → Seguros.
- PagSeguro isolado: **não** reclassificar para categoria arbitrária — marcar como não resolvido/necessita revisão (`category_source`/fila de revisão), sem apagar histórico.
- Backfill registra: avaliados, corrigidos, regra aplicada, before/after, pendentes de revisão (auditável em tabela de correções já existente).

### P0.3 Refund Matcher V2
- Matcher determinístico compartilhado (merchant normalizado, valor, janela temporal, conta/cartão, descrição) com tolerâncias e regra “candidato único ou não vincula”.
- Backfill sobre estornos sem vínculo; caso real `Estorno Uber 12,95/10-08` deve fechar com o Uber 12,95 do mesmo dia.
- Ambiguidade → permanece sem vínculo, com telemetria.

### P0.4 Merchant Distribution determinística
- `formatMerchantDistribution()` + contrato de resposta: `period`, `category`, `category_total`, `resolved_total`, `unresolved_total`, `coverage`, `merchants[{merchant, amount, share_of_category, transactions_count}]`.
- Denominador obrigatório = total real da categoria (nunca só o resolvido).
- Rota determinística no `CapabilityRouter` para “distribuição da categoria X”, “onde mais gasto em X”, “quais estabelecimentos pesaram” — LLM não calcula nada.
- Coverage < 100% é declarada na frase (“identifiquei o estabelecimento de R$ X dos R$ Y — Z% de cobertura”).

### P0.5 Roteamento de “evolução”
- Remover `evolucao|tendencia|dia a dia|por dia` do regex de `visualization`; manter `grafico|chart|linha|barras|pizza|visualizar|donut`.
- “Como está minha evolução financeira?” → análise textual; “Gere um gráfico da minha evolução” → visualização. Testes para os dois lados, incluindo o espelho já existente em `src/test/agent-chart-routing.test.ts`.

### P0.6 Perguntas compostas executadas
- Planner de turno: cada task de `buildTurnPlan` é mapeada para capability/tool, executada, agregada e validada. Nenhuma subtarefa silenciosamente descartada; a resposta cita as três partes (ranking, percentual, comparação).

### P0.7 Truth Validator V2
- Ampliar o gate para percentuais, shares, totais de breakdown (`sum(breakdown) == total` com tolerância de arredondamento), períodos, contagem de transações, coverage, comparação com período anterior, ranking e direção de variação.
- Provenance por número (tool + campo). Falha no gate → resposta canônica determinística.

### P1.1 Conversation State persistente
- Persistir por conversa (via `StateManager`/`agent_sessions.state`): `current_topic`, `previous_intent`, `category_id`, `category_name`, `merchant`, `period`, `comparison_period`, `pending_action`, `pending_slots`, `last_tool`, `conversation_summary`.
- Sequência “Transporte este mês” → “E em julho?” (herda categoria, troca período) → “E alimentação?” (herda análise, troca categoria).

### P1.2 Separação Financial Truth / Conversational Layer
- Camada conversacional recebe apenas números já validados e não pode alterá-los; tom humano e objetivo, com evidência parcial dita como “pelo que já tenho até agora”, sem recusa burocrática.

### P1.3 Acknowledgements contextuais
- Política por latência: resposta rápida sem mensagem intermediária; latência moderada com acknowledgement ligado à intenção (categoria, comparação, previsão, comportamento); fluxo longo com segundo aviso só se necessário. Nunca erro genérico quando existe resposta final válida.

### P1.4 MultiFormat / Bulk Input Orchestrator
- Convergir texto multi-lançamento, JSON array, imagem, PDF, CSV e OFX para o mesmo contrato `DraftTransaction[]` no pipeline já existente (`BulkEntry`/`parseBatch`/`stage`/`commit`).
- Reconciliação obrigatória `input_items` × `parsed_items` × `persisted_items`; divergência inexplicada bloqueia a conclusão e grava telemetria. JSON com 4 objetos = 4 drafts.

## Testes de aceite (executados, não presumidos)
Suíte dedicada de aceite cobrindo todos os cenários listados no pedido: distribuição de Alimentação (ranking, valores, share sobre total da categoria, coverage), Transporte + follow-ups “E em julho?” / “E alimentação?”, evolução sem gráfico vs. com gráfico, pergunta composta com três partes, 99 App vs 99 Food, Seguro do cartão fora de Assinaturas, PagSeguro sem categoria arbitrária, vínculo do Estorno Uber, coverage incompleta explicitada, JSON/texto/imagem com múltiplos itens gerando a mesma quantidade de drafts, ausência de número financeiro fora da evidência, breakdown reconciliando com o total, “este mês” = dia 1 até hoje em America/Sao_Paulo e distinção entre mês passado completo e mesmo período do mês passado.

Ao final, entrego a matriz **Requisito | Arquivo/implementação | Teste | Resultado | Evidência**, marcando explicitamente qualquer item como NOT IMPLEMENTED ou PARTIALLY IMPLEMENTED com o motivo.

## Notas técnicas
- Migrations: limpeza de aliases, reclassificação com evidência, marcação de revisão e vínculo de estorno — todas idempotentes e auditadas.
- Deploy das Edge Functions afetadas (`agent-chat`, `agent-run`, `whatsapp-webhook`, `category-engine`) e sincronização do núcleo financeiro (`scripts/sync-finance-core.mjs`).
- Nenhuma alteração de identidade visual, LP, autenticação ou publicação em produção sem autorização.
