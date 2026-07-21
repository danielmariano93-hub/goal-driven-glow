# Correção — "Sim pode" não confirma rascunho pendente

## Diagnóstico (confirmado no código)

Duas causas convergentes, ambas na orquestração — não é o LLM:

**1. Regex de confirm/cancel ancorada exige a mensagem inteira** — `supabase/functions/_shared/agent/parser.ts:119-120`

```
CONFIRM_WORDS = /^\s*(confirmar|confirma|sim|ok|okay|yes|👍)\s*[.!]?\s*$/i
```

"Sim pode", "pode sim", "sim, pode criar", "manda", "vai", "ok pode" **não casam**. `interpret()` cai em `unknown` (sem valor) → `PolicyEngine.evaluate` recebe intent≠confirm e retorna `pass` (`PolicyEngine.ts:30`). Não há interceptação, nem `agent_execute_confirmation`.

**2. O LLM não recebe a pendência no contexto** — `AgentCore.ts:117,144-155`

`hasPendingConfirmation` é usado só para telemetria em `decideTurn`. O `ActionPlanner.plan()` e `personalizeSystemPrompt()` **nunca injetam** o `pending_confirmations` no system prompt nem no histórico. Sem essa dica, o modelo trata "Sim pode" como abertura de conversa e cumprimenta.

Combinação = fluxo reiniciado exatamente como no print. Sessão, adapter e race condition **não são** o culpado (session é por (user_id, channel) e persiste; pendência foi criada em turno anterior e ficou no banco).

## Correção mínima (arquivo por arquivo)

### 1. `supabase/functions/_shared/agent/parser.ts`
Ampliar detecção de confirm/cancel para frases curtas com afirmação/negação inicial, sem quebrar transações que começam com "sim" acidentalmente.

- Manter o regex estrito atual como fast-path.
- Adicionar segundo teste: se `raw` tem ≤ 6 palavras, sem valor monetário (`AMOUNT_RE` não casa) e **começa** com `sim|pode|confirma|confirmar|ok|beleza|manda|vai|isso|👍|positivo|claro|tá|ta` → `confirm`. Análogo para `não|nao|cancela|cancelar|para|negativo|❌` → `cancel`.
- Ordem: fast-path → checagem de valor → checagem por prefixo.

Ganho: "Sim pode", "pode criar", "manda ver", "ok pode confirmar", "isso mesmo", "não, cancela" passam a ser interceptadas por `PolicyEngine.evaluate` e disparam `agent_execute_confirmation` — o caminho já existente e testado.

### 2. `supabase/functions/_shared/agent/core/AgentCore.ts`
Rede de segurança: mesmo quando o parser errar, o LLM precisa saber que há um rascunho aguardando.

- Ler `pending = await tctx.pending()` **antes** do planner (já feito para `decideTurn`; reaproveitar).
- Se `pending`, prefixar o `systemPrompt` (após `personalizeSystemPrompt`) com bloco fixo:
  ```
  [PENDÊNCIA ATIVA]
  Existe um rascunho aguardando confirmação: {pending.summary_text}
  Se o usuário confirmar (mesmo com frases como "sim pode", "manda", "ok"), chame a tool `confirm_pending_action` com id={pending.id}.
  Se cancelar, chame `cancel_pending_action`.
  Não crie novo rascunho nem inicie nova conversa.
  ```
- Nenhum novo tool: `confirm_pending_action`/`cancel_pending_action` já existem no ToolRuntime (usados hoje pelo caminho LLM).

### 3. Teste `src/test/agent-parser.test.ts` (append)
Casos: "Sim pode", "pode criar sim", "manda ver", "ok pode", "isso", "não cancela", "cancela por favor" → esperar `kind: "confirm"|"cancel"`. E regressão: "sim, gastei 50 no mercado" deve continuar `transaction` (tem valor).

### 4. Teste `src/test/agent-core-phase2.test.ts` (ou novo `agent-core-confirm-loose.test.ts`)
Cenário end-to-end mockado: pendência existe → chega "Sim pode" → `handleTurn` retorna `reply_kind: "receipt"` e chama `agent_execute_confirmation` com o `pending.id`.

## Fora de escopo
- Não mexer em SessionManager, adapters, race conditions ou schema — nenhuma evidência aponta para eles neste bug.
- Não alterar Fase 3 (memória, insights, planner financeiro).

## Validação
`bunx vitest run` (esperado: 384 anteriores + novos casos verdes) e typecheck. Sem migrations. Deploy só das Edge Functions afetadas: `agent-chat`, `whatsapp-webhook` (ambas dependem de `_shared/agent`).
