# Nino Agente Financeiro Autônomo — Ondas A a E

Checagem do código atual (feita agora, antes do plano):

- Já existe e não será recriado: `ToolOutcome.ts`, integração com `ResponseValidator.ts` e `DeterministicAnswers.ts`, `ConversationExpectation.ts` ampliado, `CapabilityRouter.ts`, `ConversationMemory.ts`, `StateManager.ts`, `MemoryStore.ts`, `ProactiveEngineV2.ts`, `AdvisorInteractionLearning.ts`, `ContinuationContract.ts`, `ReceiptBuilder.ts`, `DraftCard.ts`, `Acknowledgement.ts`, `ToneVariants.ts`.
- Não existe hoje no código: CapabilityRegistry, GoalPlanner, AutonomyPolicy, serviço de short links (`short_links` / `link_clicks`), matriz de capacidades em `docs/`.
- Correções P0 recentes (`financial_truth_changed`, `transaction_needs_categorization`, self-heal da fila, proteção contra remoção de categoria) estão aplicadas e serão apenas validadas, não refeitas.

## Onda A — Confiabilidade restante

1. Harness de write real + read-after-write para todas as entidades mutáveis (transação, edição, exclusão, dívida, pagamento de dívida, meta, aporte, cartão, fatura, pagamento de fatura, parcelamento, recorrência, compromisso, investimento, movimento, emoção, Divisão do Rolê). Cada caso: executa, relê o banco, valida campos, só então marca sucesso. Relatório salvo em `docs/`.
2. Regra dura: nenhuma confirmação verbal ("registrei", "pronto") sem persistência comprovada — `ResponseValidator` passa a exigir evidência de leitura pós-escrita para frases de confirmação.
3. `ToolOutcome` como contrato universal: auditar todas as tools, adaptador de migração progressiva, mapeamento completo dos 8 kinds (ex.: emoção não reconhecida → NEEDS_INPUT, conta ambígua → AMBIGUOUS, sem lançamentos → EMPTY_STATE, erro de RPC/rede → TECHNICAL_FAILURE).
4. Slot management universal: `awaiting = { operation, capability, missing_slot, partial_payload, created_at, expires_at }` persistido no estado da sessão, com TTL e cancelamento seguro; cobre amount, description, merchant, account, card, date, category, installments, emotion, goal, debt, recurrence, commitment, investment, shared expense.
5. Validação da fila de categorização: auditoria de enqueue, claim, processing, completion, retry; observabilidade por status (queued/processing/completed/review/failed).

## Onda B — Agência

6. `CapabilityRegistry`: fonte única declarando por domínio read/create/update/delete/simulate/execute, tools, engine, risk_level, confirmation_policy, canais, contexto e slots obrigatórios. Cobre todos os módulos existentes do produto.
7. Matriz gerada automaticamente (feature × capability × tool × engine × operações × teste × status) salva em `docs/NINO_CAPABILITY_MATRIX.md`.
8. Fechamento dos gaps: tools que faltam para o Nino operar por conversa investimentos, recorrências, compromissos, cartões/faturas, parcelamentos, dívidas, metas, Divisão do Rolê, preferências e desafios.
9. `GoalPlanner` acima do roteamento: entendimento do objetivo → requisitos de contexto → plano → composição de capabilities → tools → validação → resposta. Fast paths atuais preservados; consultas compostas (ex.: afordabilidade de compra parcelada) passam pelo planner.
10. `AutonomyPolicy` central: confiança, reversibilidade, impacto financeiro, ambiguidade, preferência do usuário e risco → EXECUTE / EXECUTE_AND_INFORM / ASK / CONFIRM.
11. Action Receipts universais: recibo curto com valor, categoria, data, conta/cartão e ações interativas (Editar, Excluir, Pausar, Ver meta, Desfazer) quando o canal suporta.

## Onda C — Inteligência

12. Financial Memory: `source`, `confidence`, `evidence_count`, `updated_at`; aprende merchant→categoria, merchant→cartão/conta, recorrências, padrões de salário, hábitos e correções. Inferência nunca vira verdade financeira.
13. Advisor Learning com múltiplas evidências (temas, insights abertos/ignorados, follow-ups, canal, horário, profundidade); influencia ranking e forma de resposta, nunca os cálculos.
14. Proatividade multi-finance num único pipeline: signal → situation → dedupe → impact → urgency → actionability → affinity → rank → channel.
15. Merchant intelligence: normalização de variações (UBER, UBER *TRIP, ON UBER TRIP), com hierarquia USER EXPLICIT > PERSONAL > GLOBAL.
16. Backfill retroativo: dry run primeiro em todos os usuários com relatório (analisado / já correto / classificável / revisão / erro), depois execução idempotente que nunca sobrescreve decisão manual.

## Onda D — Experiência

17. Camada conversacional consistente: nunca expor RPC, tool, engine, payload, validator, confidence, stack trace ou banco; linguagem próxima e objetiva.
18. Mensagens intermediárias variadas por contexto, sem repetição e sem fingir atividade; fast paths sem aviso.
19. Short Link Service com tabelas `short_links` e `link_clicks` (short_code imprevisível, sem PII), helper único usado por WhatsApp, insights, notificações e e-mail; autorização revalidada no destino.
20. Link analytics alimentando o advisor learning como evidência acumulada.
21. Novo Relatório do Mês Atual com narrativa: Como estou → Melhor ou pior (calendário e dias úteis via BrazilianCalendar) → Para onde foi → O que explica → O que ainda vai acontecer → Como vou fechar (faixa quando houver incerteza) → O que merece atenção → O que posso fazer.
22. 3–4 gráficos apenas (acumulado vs comparável, composição por categoria, entradas × saídas, projeção realizado→compromissos→variável→fechamento), mobile-first, design system atual; accordions reduzidos a detalhe/metodologia/listas longas.
23. Single financial truth: relatório usa os mesmos engines de app, WhatsApp, insights e notificações — nenhum cálculo próprio de relatório.

## Onda E — Hardening

24. Separação fast path / planned path, cache só de contextos seguros com invalidação em toda mutação relevante.
25. Observabilidade agentic em `agent_runs`/`agent_decisions`: goal, plan, capabilities, tools, ToolOutcomes, confiança, clarificações, execução, validação, latência, status final.
26. Suíte de testes por comportamento (variações de frase, multi-turn de emoção e de lançamento incompleto, edição/exclusão, pausa de recorrência, comparações e simulações) e testes de isolamento multiusuário.

## Notas técnicas

- Novos arquivos previstos: `CapabilityRegistry.ts`, `GoalPlanner.ts`, `AutonomyPolicy.ts`, `ActionReceipt.ts`, `ShortLink.ts` (+ edge function de redirect), harness de write E2E, docs da matriz.
- Migrations previstas: `short_links`, `link_clicks`, colunas de memória financeira (source/confidence/evidence_count), campos de observabilidade agentic. Todas com GRANT e RLS por usuário.
- Nada de backend/LP fora do escopo; identidade visual e paleta oficiais preservadas.
- Entrega por onda com IMPLEMENTADO / TESTADO / EVIDÊNCIA / PENDENTE / RISCO. Se houver limite de execução, paro na fronteira entre ondas e informo o estado exato.
