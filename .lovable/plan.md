## Diagnóstico confirmado

O bug do print não é causado por “demora de 10 minutos” nem apenas por interpretação da IA. O fluxo atual permite que o agente fale como se houvesse um rascunho, sem criar nenhuma pendência real.

Achados objetivos no estado atual:

- A mensagem “Pode sim” foi corretamente classificada como confirmação, mas `pending_confirmations` não tinha nenhum item pendente para essa conversa; por isso o `PolicyEngine` respondeu “Não encontrei nada pendente...”.
- Nos turnos recentes do WhatsApp, `agent_runs` mostra `steps = 0` e não há `agent_tool_calls`: o modelo respondeu verbalmente, mas não chamou `create_transaction_draft`.
- O histórico canônico usado pelo Agent Core (`ConversationHistory.ts`) lê apenas `conversation_messages`, mas no WhatsApp os outbound reais estão em `outbound_messages`; na conversa investigada, `conversation_messages` tinha somente mensagens inbound. Resultado: a IA recebe o que o usuário disse, mas não recebe suas próprias respostas anteriores, favorecendo reinícios, alucinação e perda de continuidade.
- O prompt ativo no banco é mais curto que o `DEFAULT_SYSTEM_PROMPT` técnico e não contém todas as regras rígidas sobre tool-calling. Como `loadActivePrompt` usa o prompt ativo como substituto integral, as regras críticas do código ficam enfraquecidas.
- O bloco de segurança em `AgentCore` instrui o modelo a chamar `confirm_pending_action`, mas essa tool não existe em `tools.ts`; só existe `cancel_pending_action`. Se o parser não interceptar uma confirmação, o caminho LLM de confirmação fica quebrado.
- A sessão `agent_sessions` está viva por 30 minutos e não explica o erro do print. Porém a sessão hoje é pouco usada para guardar fluxo operacional; `state` está vazio e não há fallback de continuidade quando uma pendência não foi persistida.

## Objetivo da correção

Garantir que o assessor só peça confirmação quando houver uma pendência persistida, recupere contexto real entre mensagens do WhatsApp e App, e nunca reinicie a conversa quando o usuário responder “sim/pode/confirmar” dentro da janela válida.

## Plano de implementação

### 1. Corrigir histórico canônico do WhatsApp

- Ajustar `loadHistory` em `supabase/functions/_shared/agent/core/ConversationHistory.ts` para montar histórico unificado:
  - inbound: `conversation_messages`;
  - outbound WhatsApp: `outbound_messages` vinculadas à mesma conversa pelo `inbound_message_id`/eventos recentes e/ou metadados quando disponível.
- Alternativa mais segura e mínima: quando `enqueueReply` enviar uma resposta do agente no WhatsApp, também gravar um espelho em `conversation_messages` com `direction='outbound'`.
- Evitar duplicação com chave idempotente baseada no `inbound_message_id`.
- Resultado esperado: próximos turnos terão pares `user/assistant` reais no histórico enviado ao LLM.

### 2. Impedir “rascunho verbal” sem pendência persistida

- Em `AgentCore.ts`, depois do LLM:
  - se a resposta contém linguagem de rascunho/confirmação (“posso criar um rascunho”, “você confirma”, “posso registrar”, “se sim...”) mas não houve tool `_draft`, rejeitar a resposta;
  - executar fallback determinístico quando a mensagem contém dados suficientes de lançamento;
  - se faltarem dados, responder pergunta objetiva sem fingir que criou rascunho.
- Reforçar `ResponseValidator.ts` com uma regra específica: `draft_language_without_draft` gera fallback determinístico.

### 3. Forçar criação determinística de rascunho antes do LLM quando possível

- No `AgentCore`, para intents `transaction`, `transfer` e `goal_contribution` detectados pelo parser com dados suficientes:
  - chamar o plano determinístico/tool de rascunho antes de recorrer ao LLM;
  - deixar o LLM apenas para casos ambíguos ou analíticos.
- Isso reduz custo, latência e alucinação.
- Para o caso do print, a mensagem com valor, estabelecimento, cartão e data deve gerar `pending_confirmations` imediatamente e responder com “Responda CONFIRMAR/CANCELAR”.

### 4. Criar tool real de confirmação para paridade com o prompt

- Adicionar `confirm_pending_action` em `tools.ts`:
  - busca pendência por `conversation_id` + `user_id` + `status='pending'`;
  - chama `agent_execute_confirmation`;
  - retorna resultado idempotente.
- Atualizar `openAIToolDefinitions` para incluir essa tool.
- Corrigir o bloco `[PENDÊNCIA ATIVA]` para apontar para uma tool existente.

### 5. Endurecer `findPending` e confirmação

- Em `PendingConfirmations.ts`, filtrar também `expires_at > now()`.
- Se existir pendência vencida, expirar e responder “Este pedido expirou...” em vez de “não encontrei”.
- Em `cancel_pending_action`, filtrar por `user_id` além de `conversation_id`.

### 6. Usar sessão como fallback operacional, não como fonte única

- Ao criar um rascunho, registrar no `agent_sessions.state`:
  - `last_pending_id`;
  - `last_draft_summary`;
  - `last_intent`;
  - `updated_at`.
- Ao receber confirmação e não encontrar pendência, verificar `last_pending_id`:
  - se o id existe e está pendente, confirmar;
  - se expirou, avisar expiração;
  - se nunca existiu, não inventar confirmação.
- Isso cobre pequenas falhas de leitura/ordenação sem permitir gravação sem pendência real.

### 7. Corrigir prompt ativo sem apagar configuração do admin

- Alterar `loadActivePrompt` para sempre compor:
  - bloco base obrigatório do sistema (`DEFAULT_SYSTEM_PROMPT` com regras de tools e segurança);
  - depois o prompt/persona ativo do admin como camada de tom e preferências.
- Assim o admin pode ajustar persona, mas não remove guardrails técnicos.

### 8. Tratar race condition e idempotência

- Em `enqueueReply`, se espelhar outbound em `conversation_messages`, usar idempotência por `inbound_message_id` para não duplicar em retries do webhook.
- Em `resolveSession`, substituir o fallback sintético silencioso por uma estratégia com `upsert`/releitura quando houver corrida de criação.
- Manter `conversation_id` estável para WhatsApp, sem recriar sessão se o telefone/conversa já existem.

### 9. Testes de regressão obrigatórios

Adicionar/ajustar testes para:

- WhatsApp: mensagem com dados completos cria `pending_confirmations` e resposta contém confirmação real.
- WhatsApp: “Pode sim” até 15 minutos depois confirma a pendência, sem reiniciar fluxo.
- WhatsApp: outbound é incluído no histórico canônico do próximo turno.
- LLM sem tool `_draft` e com linguagem de rascunho é rejeitado pelo validator.
- `confirm_pending_action` confirma pendência existente e retorna idempotente quando já confirmado.
- Pendência expirada responde expiração, não “não encontrei nada”.
- App e WhatsApp continuam usando o mesmo Agent Core.

### 10. Deploy e validação

- Rodar testes focados do Agent Core/parser/WhatsApp e depois a suíte completa.
- Fazer deploy das funções afetadas:
  - `agent-chat`;
  - `agent-run`;
  - `whatsapp-webhook`.
- Validar em banco/logs um fluxo real:
  1. enviar lançamento completo;
  2. confirmar após alguns minutos;
  3. verificar `pending_confirmations.status='confirmed'`;
  4. verificar transação criada;
  5. verificar histórico com inbound e outbound.

## Escopo que não será alterado

- Não vou mexer em contabilidade, categorias, documentos, Divisão do Rolê ou UI administrativa.
- Não vou criar novas tabelas se a correção couber nas tabelas atuais.
- Não vou remover dados existentes nem apagar histórico.