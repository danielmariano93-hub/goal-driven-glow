## Diagnóstico — lançamento do WhatsApp que sumiu

Turno reproduzido no banco (22/07 10:36–10:37, danielmariano93):

1. Inbound "Registre esse novo gasto… R$ 30,00 A Ventana Itau Ceic… Conta Corrente Itaú"
   → agent_runs `af426755` concluído com **0 tool_calls**
   → outbound: *"Despesa de R$ 30,00 na sua Conta Corrente Itaú… Você confirma?"*
   → **nenhum registro em `pending_confirmations`**
2. Inbound "Confirmo"
   → agent_runs `50bc3e85` concluído com **0 tool_calls**
   → outbound: *"Despesa registrada: R$ 30,00. ✅"*
   → **nenhum `INSERT` em `transactions`**

Causa raiz: o LLM respondeu pedindo confirmação sem chamar `create_transaction_draft`, e no turno seguinte alucinou o recibo sem chamar `confirm_pending_action`. O `ResponseValidator` só bloqueia linguagem de rascunho quando `expectedKind === "receipt"` e `hasDraft === false` — quando o próprio `kind` cai em `"info"` (o que acontece quando nenhuma tool roda), a frase "Despesa registrada ✅" passa direto.

## Correção

Patch único e cirúrgico, sem tocar em fluxos que já funcionam.

### 1) Guardrail anti-alucinação (backend)
Arquivo: `supabase/functions/_shared/agent/core/ResponseValidator.ts`
- Adicionar `RECEIPT_LANGUAGE_RX` cobrindo *registrada/registrado/salvo/salva/anotado/confirmado + ✅*.
- Adicionar `CONFIRM_QUESTION_RX` cobrindo *"você confirma", "confirma?", "posso registrar", "posso lançar"*.
- Nova validação em `validate()`:
  - Se `RECEIPT_LANGUAGE_RX` casar e não houver tool call de sucesso (`create_*_draft` ou `confirm_pending_action`) → `fallback_deterministic`.
  - Se `CONFIRM_QUESTION_RX` casar e `hasDraft === false` → `fallback_deterministic` (força o caminho determinístico que sabe criar o rascunho a partir de mensagens estruturadas).
- Passar `hasSuccessfulMutation` no `ValidationContext` a partir do `AgentCore` (já temos `toolCallLog`).

### 2) Reforço no system prompt (backend)
`AgentCore.ts`: acrescentar bloco fixo antes do `personalizeSystemPrompt`:
> "Nunca responda como se um lançamento tivesse sido registrado sem ter chamado `create_transaction_draft` (novo) ou `confirm_pending_action` (rascunho existente) neste mesmo turno. Se pedir confirmação, obrigatoriamente crie o rascunho antes."

### 3) Modo "registrar direto" (feature nova)
Palavra-mágica configurável que dispara gravação imediata **sem** rascunho/confirmação, tanto no Assessor do app quanto no WhatsApp.

Token padrão: `!ja` (também aceitos: `#ja`, `/ja`, no início ou no fim da mensagem; case-insensitive). Configurável em `user_ai_preferences.fast_log_token` (nova coluna `text`, default `!ja`).

Novo módulo: `supabase/functions/_shared/agent/core/FastLog.ts`
- `detectFastLog(text, token)` → remove o token e devolve `{ triggered: boolean, cleanText: string }`.
- Chamado no início de `handleTurn`, antes do IntentRouter.
- Se `triggered`:
  1. Roda o parser + `extractSpans` no `cleanText` (mesma lógica do `DeterministicFallback`).
  2. Chama `create_transaction_draft` (ou `create_transfer_draft`/`add_goal_contribution_draft`) — que já grava com `status='pending'` em `pending_confirmations`.
  3. Chama imediatamente `confirm_pending_action` com o id retornado.
  4. Devolve `reply_kind: "receipt"` com o `receipt` real da tool.
  5. Se algum dado obrigatório faltar (valor, conta), pergunta uma única coisa em vez de gravar (não inventa dados).
- Registra tudo em `agent_tool_calls` normalmente (path = `fast_log`), então o guardrail (1) passa.

Frontend (mínimo, para descobribilidade):
- `src/pages/Perfil.tsx` — nova seção "Registro rápido": input para editar `fast_log_token` + dica com exemplo (*"!ja gastei 42,90 no almoço no Nubank"*).
- `src/components/assessor/AssessorPanel.tsx` — placeholder do input passa a mencionar `!ja` (uma linha).
- `src/pages/WhatsApp.tsx` — bloco de dicas ganha 1 item explicando o `!ja`.

### 4) Migração
`supabase/migrations/2026072300_fast_log_token.sql`:
```sql
alter table public.user_ai_preferences
  add column if not exists fast_log_token text not null default '!ja';
```

### 5) Testes (vitest)
- `src/test/agent-response-validator-hallucination.test.ts` — cobre "Despesa registrada ✅" sem tool + "Você confirma?" sem draft.
- `src/test/agent-fast-log.test.ts` — cobre `detectFastLog` (prefixo, sufixo, case, sem match) e o fluxo integrado (draft + confirm em um turno).
- Reaproveitar o fixture do webhook em `whatsapp-orchestrator-flow.test.ts` para garantir regressão zero.

### 6) Correção manual pontual (não retroativa em massa)
Inserir a transação perdida de R$ 30 / A Ventana Itau Ceic / 22-07 na Conta Corrente Itaú do usuário afetado, para reconciliar a Home. Sem migração — vira uma chamada única `supabase--insert` com `origin='manual_repair'` na descrição.

### Fora de escopo
- Reprocessar outras mensagens antigas (não solicitado).
- Alterar o parser/extract além do necessário para o fast-log reaproveitá-los.
- Mudanças de UI além dos três pontos acima.

## Aceite
- Enviar "Registre esse novo gasto… R$ X…" e responder "Confirmo" cria linha em `transactions` **ou** o agente devolve mensagem de erro amigável (nunca recibo falso).
- Enviar "!ja gastei 42,90 no almoço no Nubank" cria a transação em um único turno, sem "Você confirma?".
- Suíte de testes (`npx vitest run`) passa integralmente.
