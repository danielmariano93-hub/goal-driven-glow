# Confirmação instantânea do Nino (fast path) + correções pendentes

## O problema real

Em 10/09 o usuário mandou um comprovante de Pix de R$ 6,00. O Nino montou o rascunho certo e perguntou "Pode salvar?". O usuário respondeu "Salvar" — e o Nino respondeu que não conseguia confirmar, depois de 21 segundos pensando.

Causa raiz confirmada no código: a lista de palavras que o Nino reconhece como "sim" (`parser.ts`) tem `sim`, `ok`, `pode`, `confirma`, `beleza`, `manda` — mas **não tem** `salvar / salva / registra / lança / pode salvar / correto / isso mesmo`. Sem cair em "confirmar", o turno virou pergunta nova: foi para a camada de análise, que respondeu "isso não é suportado", e o planejador geral produziu a negação falsa. O executor de confirmação nunca foi chamado, mesmo com o rascunho válido e não expirado no banco.

Ou seja: existia estado suficiente para salvar; o Nino tratou uma palavra de confirmação como pergunta aberta.

## O que vamos entregar

1. **Confirmação resolvida antes de tudo.** Se existe um rascunho pendente na conversa, a próxima mensagem é lida primeiro contra um classificador pequeno de "sim/não". Havendo confirmação, o Nino executa e devolve o recibo — sem análise, sem contexto pesado, sem modelo de IA.
2. **Vocabulário natural completo** de confirmação (salvar, salva, salve, registra, registrar, lança, lançar, pode salvar, pode registrar, pode seguir, confirmado, fechado, certinho, correto, isso, é isso, manda ver, beleza…) e de cancelamento (não, cancela, deixa, esquece, não salva, não registra, desconsidera, descarta, está errado). Acento, emoji, pontuação e maiúsculas normalizados. Ambíguo → o Nino pergunta; nunca salva por palpite.
3. **Essas palavras só confirmam quando há rascunho pendente.** Sem rascunho, "Salvar" continua não criando nada — passa a explicar que não há nada pendente. Rascunho expirado → aviso natural de expiração.
4. **Comprovante bancário estruturado vira rascunho direto.** Mensagens no formato "Pix de R$ X enviado para Y / Data: dd/mm/aaaa hh:mm" com leitura de alta confiança montam o rascunho deterministicamente. Confiança baixa → caminho normal. A confirmação continua obrigatória.
5. **Fim da negação falsa.** Havendo rascunho pendente com executor disponível, o Nino fica proibido de dizer "não consigo confirmar/salvar por aqui" ou "finalize pelo app" sem falha real do executor.
6. **Correções dos dois alertas de qualidade abertos**: "não foi mercado, foi farmácia" deixa de ser gravado como sentimento novo (só vira correção de humor quando os termos são realmente emoções); e alerta dentro do app nunca mais é salvo sem título.

## Detalhes técnicos

**Fast path de confirmação** — novo `core/ConfirmationFastPath.ts`, chamado em `AgentCore.handleTurn` logo após dedupe/sessão e a checagem de lote, **antes** de `routeIntent`, Human Understanding, ContextPipeline, diagnóstico, Semantic IR e ActionPlanner:
- `findPending(conversation_id, user_id)`; se fresco, classifica o texto (`classifyConfirmationAct`): `confirm | cancel | ambiguous | unrelated`.
- `confirm` → `confirmAndBuildReceipt` (que já usa `executeConfirmation` → `agent_execute_transaction_confirmation_v2` e `PersistenceProof`). Nenhum caminho paralelo novo.
- `cancel` → marca `cancelled` e responde.
- `unrelated`/sem pendência → segue pipeline normal.
- Idempotência: o dedupe de inbound e a checagem `status='pending'` garantem WRITE única em retry.

**Vocabulário** — extraído para `core/ConfirmationVocabulary.ts` (puro, testável) e reaproveitado por `parser.ts`, que passa a reconhecer os mesmos termos quando há contexto de rascunho.

**ConversationExpectation** — novo `kind: "confirmation"` com `pending_id` e `operation_kind`, gravado programaticamente quando qualquer tool `*_draft` retorna `draft_id` (não por regex sobre a prosa). `pending_confirmations` continua a verdade da operação.

**Semantic IR** — em `isSemanticReadEligible`, `pending_confirmation + ato de confirmação/cancelamento` → inelegível (fail-closed).

**Fast path de comprovante** — `core/BankNotificationParser.ts` (Pix enviado/recebido, compra aprovada, transferência) extrai tipo, valor, contraparte, data, meio de pagamento e conta quando inequívoca; com confiança alta chama `create_transaction_draft` direto, sem ActionPlanner.

**Orçamento por rota** — `core/TurnBudget.ts` define teto por capability: confirmação/cancelamento = 0 chamadas de IA e prompt zero; entrada estruturada = 0–1; entrada simples = 1; análise = pipeline completo. Diagnóstico (`nino_diagnosis_context_for_user`), snapshot financeiro, contexto de assessor e comparação de período deixam de ser carregados em confirmação, cancelamento e rascunho determinístico. Auditoria do prompt de 25,8k chars com registro de qual bloco consome o quê.

**Observabilidade** — `path = confirmation_fast_path | structured_entry_fast_path` em `agent_runs`, com `pending_found`, `pending_id`, `confirm_act`, `execution_ms`, `persistence_proof_ms`, `total_ms`, `llm_calls=0`, `tokens=0`. Latência percebida separada em marcos (inbound → agente → outbound → provider → ack) com `backend_latency`, `provider_latency`, `perceived_latency`.

**Correções dos alertas** — em `CapabilityRouter.ts`, `parseEmotionCorrection` só roteia para `emotional_checkin` quando ambos os termos são emoções conhecidas (catálogo ou `user_emotions`); caso contrário segue para correção de lançamento. Em `CommunicationDispatcherV3`, a supressão de título passa a valer só no WhatsApp; a notificação no app sempre grava título.

**Auditoria dos demais rascunhos** — transferência, pagamento de fatura, dívida, meta, contribuição e divisão do rolê passam pelo mesmo fast path (todos já têm `confirmationExecutor`), com fixture por tipo.

## Testes

- Fixtures A–J pedidas: "Salvar", "Sim", "Pode salvar", "Ok" confirmam; "Cancelar" e "Não salva" cancelam; sem pendência não cria nada; pendente expirado avisa; retry duplicado escreve uma vez; falha do executor nunca diz que salvou.
- Reprodução do incidente real (R$ 6,00 / Pagar Me Pagamentos / Banco Itaú / 10/09/2026) em fixture, com zero chamadas de IA no passo da confirmação.
- Comparativo antes/depois de latência, tokens e chamadas de modelo para Pix estruturado, "Salvar", "Sim", "Cancelar" e as confirmações de transferência, fatura, meta e rolê.
- Suíte completa (1.945 testes) + typecheck + guards.

Nada é publicado em produção sem autorização explícita.
