
## Diagnóstico do incidente

Sequência real no banco (conversa `1b4c8b3c…`, 22/07 22:42 – 22:43):

1. Usuário: "Faça o lançamento como despesa de 33,89 na conta corrente do Itaú"
2. Agente (LLM): "Faltou a descrição. Qual a finalidade da despesa de R$ 33,89?"
3. Usuário: "Alimentação"
4. Agente (LLM): **"Despesa de R$ 33,89 na conta corrente Itaú — Alimentação em 2026-07-22. Responda *CONFIRMAR* para registrar ou *CANCELAR* para descartar."**
5. Usuário: "Confirmar" → agente: "Não encontrei nada pendente para confirmar…"
6. Usuário: "Estou falando do lançamento de 33,89…" → mesma resposta.

**Causa-raiz:** No passo 4 o LLM escreveu o texto exato do template de rascunho — inclusive o "Responda *CONFIRMAR*" — **sem chamar `create_transaction_draft`**. Nenhuma linha foi criada em `pending_confirmations`. Os guardrails atuais (`ResponseValidator.validate`) só cobrem três padrões:

- `RECEIPT_LANGUAGE_RX` — "registrado/salvo/anotado ✅"
- `CONFIRM_QUESTION_RX` — "você confirma?", "posso registrar?"
- `DRAFT_LANGUAGE_RX` — "rascunho/proposta … confirmar" ou "posso/vou/quer que eu … criar/salvar"

Nenhum casa com a frase-template real usada pelo próprio `deterministicFallback`/`orchestrator` (`Responda *CONFIRMAR* para registrar ou *CANCELAR* para descartar`). O LLM aprendeu a frase por few-shot e a devolve como texto, sem tool call, e o validador aprova.

Consequência: qualquer variação "descreve a operação + Responda CONFIRMAR/CANCELAR" produz o mesmo bug — usuário confirma, `PolicyEngine.evaluate` não acha `pending_confirmations`, responde "Não encontrei nada pendente" e todo o contexto se perde.

## Cenários adicionais que a mesma falha permite

1. LLM diz *"Registrei sua despesa de R$X ✅"* após uma tool call que falhou (`tool_call_errors ≥ 1` mas < 2). O guardrail atual só dispara em ≥ 2 erros.
2. LLM diz *"Vou lançar R$X no Itaú, pode ser?"* — não bate em `CONFIRM_QUESTION_RX` nem em `DRAFT_LANGUAGE_RX`.
3. LLM devolve resumo estruturado ("Valor: X · Conta: Y · Data: Z") pedindo confirmação — mesmo problema.
4. LLM inventa nome de conta/categoria ("Registrei na Conta Corrente Bradesco") sem consultar `list_accounts`.
5. Usuário confirma um rascunho verdadeiro que já expirou entre turnos — hoje já cai em "expirou", mas sem oferecer recriação.

## O que vai mudar

Escopo cirúrgico, sem tocar em dados nem em migrations. Todo o trabalho vive em `supabase/functions/_shared/agent/core/` + prompt.

### 1. `ResponseValidator.ts` — novo guardrail "draft-invite sem mutação"

Adicionar regex e razão:

```
DRAFT_INVITE_RX = /(responda\s*\*?\s*confirmar\s*\*?)|(\*?confirmar\*?\s*para\s+(registrar|salvar|lan[çc]ar|criar|anotar))|(\bposso\s+(lan[çc]ar|registrar|salvar|criar|anotar)\b.*\?)|(\bvou\s+(lan[çc]ar|registrar|salvar|criar|anotar)\b)/i
```

Regra: se `hasSuccessfulMutation === false` **e** `DRAFT_INVITE_RX.test(reply)` → `action="fallback_deterministic"`, `reason="hallucinated_draft_invite"`. Também baixar o limite de `too_many_tool_errors` para `≥ 1` quando o texto contém `RECEIPT_LANGUAGE_RX` (recibo com qualquer erro de tool = suspeito).

### 2. `AgentCore.ts` — recuperação real, não mensagem de erro

Hoje, quando o validador cai em `fallback_deterministic` e a rota LLM não conseguiu mutação, o `deterministicFallback` recebe apenas o **último** `input.text` do usuário (ex.: `"Alimentação"`), que sozinho não descreve a operação. Ajuste:

- Recuperar as últimas 4 mensagens `inbound` da conversa via `tctx.history` **antes** de chamar o fallback recuperador.
- Concatená-las em `recoveredText` (mais antiga → mais nova) e chamar `deterministicFallback(sb, { …input, text: recoveredText })`.
- Se o fallback conseguir criar um rascunho real (`kind === "draft"`), esse rascunho passa a existir em `pending_confirmations` e o próximo "Confirmar" funciona.
- Se o fallback não conseguir montar draft, responder texto claro: *"Perdi o rascunho anterior. Pode me mandar tudo em uma frase, ex.: 'gastei 33,89 alimentação Itaú hoje'?"* — nunca a mensagem genérica.

### 3. `AgentCore.ts` — reforço no system prompt

Trocar o bloco `[REGRA CRÍTICA]` já existente para proibir explicitamente o template:

```
NUNCA escreva a frase "Responda CONFIRMAR/CANCELAR", nem qualquer resumo do tipo
"Despesa de R$X na conta Y — Categoria em DATA", sem antes ter chamado
create_transaction_draft / create_transfer_draft / add_goal_contribution_draft
NESTE MESMO TURNO. Se faltar informação, pergunte só o slot faltante — não
antecipe o rascunho.
```

### 4. `PolicyEngine.evaluate` — auto-recuperação no "confirm sem pending"

Antes de responder "Não encontrei nada pendente", verificar se a última mensagem `outbound` casa `DRAFT_INVITE_RX`. Se sim, disparar a mesma recuperação da §2 (montar `recoveredText` a partir das últimas 4 inbound e tentar `deterministicFallback`). Se conseguir criar um draft real, responder o novo resumo pedindo nova confirmação; se não, responder mensagem clara pedindo a frase completa (não a genérica atual).

### 5. Fallback determinístico — reaproveitar spans acumulados

Em `DeterministicFallback.ts`, quando `extractSpans(text)` já reunir `amount + description + payment_method|account_hint`, o rascunho é criado; a alteração em §2 (passar `recoveredText` concatenado) faz esse caminho funcionar sem novas dependências. Nada muda aqui além de garantir que `extract.ts` consiga combinar spans quando o texto tem múltiplas linhas — checar rapidamente e, se necessário, ordenar a extração para preferir o **primeiro** amount + a **última** descrição livre.

### 6. Testes de regressão (vitest, espelhando o padrão de `agent-response-validator-hallucination.test.ts`)

Novo arquivo `src/test/agent-hallucinated-draft-invite.test.ts` com casos:

1. `"Despesa de R$ 33,89 na conta corrente Itaú — Alimentação em 2026-07-22. Responda *CONFIRMAR* para registrar ou *CANCELAR* para descartar."` com `hasSuccessfulMutation:false` → `fallback_deterministic`, razão `hallucinated_draft_invite`.
2. `"Posso lançar R$50 no Nubank?"` sem mutação → `fallback_deterministic`.
3. `"Vou registrar R$30 alimentação"` sem mutação → `fallback_deterministic`.
4. Mesma frase do caso 1 **com** `hasSuccessfulMutation:true` e `hasDraft:true` → `accept` (não pode regredir o fluxo real).
5. Recibo `"Despesa registrada ✅"` com **1** erro de tool → agora `fallback_deterministic` (novo threshold).

### 7. Observability

`DecisionLogger` já grava `validations`. Nenhum schema muda; só passa a registrar os novos motivos (`hallucinated_draft_invite`) para conseguirmos medir recorrência no admin.

### 8. Deploy

Após tests + typecheck verdes, deploy apenas de `agent-chat`, `agent-run`, `whatsapp-webhook` (compartilham `_shared/agent/core`). Sem migration, sem mudança em tabela.

## Fora de escopo

- Persistência de estado verbal em `agent_sessions` (já existe via `pending_confirmations`, não é o gargalo aqui).
- Reescrita do prompt principal ou troca de modelo.
- UI do app / mobile.
- Novos campos em `agent_decisions` ou `agent_runs`.

## Critério de aceite

- Suíte `bunx vitest run` verde (inclui os 5 novos testes).
- Reproduzir o incidente na conversa `1b4c8b3c…`: mandar novamente "Faça o lançamento como despesa de 33,89 na conta corrente do Itaú" → "Alimentação" → "Confirmar" deve terminar com uma transação real criada, sem cair em "Não encontrei nada pendente".
- Nenhum recibo/draft-invite passa quando `hasSuccessfulMutation=false`.
- Quando o LLM alucina, o agente recupera contexto e monta um rascunho real via caminho determinístico em vez de devolver a mensagem genérica de erro.
