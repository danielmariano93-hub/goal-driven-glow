## Diagnóstico — o que aconteceu de verdade

Reproduzi o turno olhando `conversation_messages`, `agent_runs`, `agent_tool_calls`, `pending_confirmations` e `user_ai_preferences` (usuário `danielmariano93@gmail.com`).

**Causa raiz #1 — o `!ja` deixou de ser mágico e virou "todas as mensagens".**
`user_ai_preferences.fast_log_token = '1908A'`. Ou seja: qualquer coisa começando por `1908A ` (que o iPhone dele antepõe ao encaminhar as notificações do banco) dispara FastLog. As mensagens `1908A 💳 Registre esse novo gasto…` de 10:51, 10:58 e 11:00 caíram todas no FastLog. O `agent_runs` confirma: 3 rodadas com `model='fast_log'` naquele intervalo. **Nunca houve validação do token na hora de salvar** — aceita string alfanumérica, aceita palavra comum, aceita prefixo que o WhatsApp já usa.

**Causa raiz #2 — FastLog não entende notificação bancária estruturada.**
Ao rodar em `💳 Registre… Valor: R$ 15,86 Estabelecimento: Hirota… Conta Corrente Itaú`, o `extractSpans` **captura valor e descrição rotulados** (`LABELED_DESC_RX`), **mas não tem regex equivalente para "Conta:"/"Conta Corrente X"**. Resultado: `account_hint = null` → FastLog responde `"Em qual conta eu registro?"` mesmo com "Conta Corrente Itaú" escrito na mensagem. Foi exatamente o que o usuário reclamou ("Ta escrito na mensagem").

**Causa raiz #3 — `CONFIRM_LOOSE` engole frases que não são confirmação.**
`parser.ts:125` casa qualquer coisa que **começa** por `sim|pode|ok|ta|tá|manda|…`. `"Ta escrito na mensagem"` começa com `ta` → `intent=confirm` → PolicyEngine olha e não acha pendência → devolve `"Não encontrei nada pendente para confirmar…"`. Foi a **segunda resposta desconectada** do print.

**Causa raiz #4 — prompt vaza o próprio token e continua sem exigir tool.**
`AgentCore.ts:197-205` interpola o token literal (`"1908A"` nesse caso) no system prompt e diz "se a mensagem contiver X, o sistema já registrou". Isso alucina o LLM em qualquer fluxo onde o FastLog não rodou (ex.: cliente estava com pendência antiga).

Impacto colateral: os 3 `agent_runs` de FastLog ficaram em `status='running'` (o `update` foi engolido dentro de um `guard`; não é a raiz do bug mas suja a auditoria).

---

## Correção (uma rodada, sem ampliar escopo)

### 1) Endurecer o token do FastLog
Arquivo: `supabase/functions/_shared/agent/core/FastLog.ts`
- Nova função `isValidFastLogToken(tk: string): boolean`:
  - obrigatório começar com `!`, `#` ou `/`;
  - `bare` (sem o prefixo) precisa ter 2–12 chars, só `[a-z0-9]`, e **não** pode ser palavra pt-BR comum (`ja|sim|nao|ok|pode|confirma|cancela|registra|gasto|conta`);
  - **não** pode casar `^\d+[a-z]?$` (bloqueia "1908A", "123", "42b").
- `loadFastLogToken` passa a validar: se inválido, cai para `DEFAULT_FAST_LOG_TOKEN` (não usa o valor do banco).
- `detectFastLog` continua permissiva com os 3 prefixos alternativos **do bare**, mas se o token custom for inválido usa o default.

### 2) Validar no salvamento (frontend)
Arquivo: `src/components/FastLogTokenCard.tsx`
- Espelhar `isValidFastLogToken` (mesmas regras); bloquear submit com mensagem clara ("O código precisa começar com `!`, `#` ou `/` e ter 2–12 letras/números.").
- Placeholder passa a mostrar `!ja` de exemplo.

### 3) Migração de dados: consertar tokens inválidos já salvos
Arquivo novo: `supabase/migrations/20260722120000_fix_fast_log_token.sql`
```sql
update public.user_ai_preferences
set fast_log_token = '!ja'
where fast_log_token is null
   or btrim(fast_log_token) = ''
   or fast_log_token !~ '^[!#/][a-z0-9]{2,12}$'
   or lower(regexp_replace(fast_log_token,'^[!#/]','')) in
      ('ja','sim','nao','ok','pode','confirma','cancela','registra','gasto','conta');
```
(Corrige o do `danielmariano93` de `1908A` para `!ja` e blinda futuros usuários.)

### 4) Extrair conta rotulada em mensagens estruturadas
Arquivo: `supabase/functions/_shared/agent/extract.ts`
- Novo `LABELED_ACCOUNT_RX = /(?:^|\n)\s*(?:conta|conta\s+corrente|conta\s+poupan[çc]a|banco)\s*:?\s*([^\n]+)/i`.
- Se casar e `payment_method` ainda for `null`, setar `payment_method='account'` e `account_hint = match[1].trim()` (aplicar o mesmo cleanup do resto do arquivo).
- Também aceitar linha isolada `Conta Corrente Itaú` (sem `:`) como âncora: se última linha tiver forma `(Conta\s+(Corrente|Poupan[çc]a)\s+\S.+)` sem valor, casar igual.
- **Espelhar** a mesma adição em `src/lib/agent/extract.ts` (o frontend usa o outro arquivo) para o Assessor no app se beneficiar.

### 5) Apertar `CONFIRM_LOOSE`
Arquivos: `supabase/functions/_shared/agent/parser.ts` e `src/lib/agent/parser.ts` (mesma alteração nos dois).
- Manter a lista de tokens, mas exigir que a frase inteira seja curta E que **não haja outras palavras substantivas** depois. Nova regra:
  - `CONFIRM_LOOSE = /^\s*(sim|pode|confirma(?:r|do)?|ok|okay|beleza|blz|manda(?:\s+ver)?|vai|isso(?:\s+mesmo)?|positivo|claro|👍|yes)\s*[.!?]?\s*$/i`
  - Aplicar somente se `words.length <= 3` **e** `CONFIRM_LOOSE.test(raw)` (hoje é `<= 4` e casa começo → passa "Ta escrito na mensagem").
- Adicionar caso de teste: `"Ta escrito na mensagem"`, `"Pode ser amanhã"`, `"Sim, quero ver o saldo"` → **não** devem ser `confirm`.

### 6) Prompt limpo (sem vazar token) + reforço mantido
Arquivo: `supabase/functions/_shared/agent/core/AgentCore.ts`
- Remover a linha `Palavra-mágica do usuário: se a mensagem contiver "${fastLogToken}"…` do bloco `[REGRA CRÍTICA]`.
- Manter o restante do guardrail anti-alucinação (funciona: bloqueou "Despesa registrada ✅" quando não houve tool).

### 7) Fechar `agent_runs` do FastLog mesmo quando o `path` já é 'fast_log'
Mesmo arquivo, bloco FastLog:
- Trocar o `.update({... path: 'fast_log' ...})` por dois updates separados: primeiro `status/ended_at/latency_ms`, depois `path/steps` — hoje um único update com `path='fast_log'` **está** funcionando (coluna é `text`), então basta garantir que o update ocorra mesmo com `tool_calls.length === 0` (já ocorre) e checar o retorno; se `guard` engolir erro, registrar em `metrics.errors` (já registra). Nenhuma mudança de schema — só logar melhor.
- Reparo pontual: `update agent_runs set status='done', ended_at=now(), path='fast_log' where id in ('0d5a63c3-…','ec3a56d4-…','ee410449-…') and status='running'`. Feito via `supabase--insert`.

### 8) Testes (vitest)
- `src/test/agent-fast-log.test.ts` — adicionar:
  - `detectFastLog("1908A 💳 …", "1908A")` **não deve** disparar (token inválido → cai para default).
  - `isValidFastLogToken("1908A") === false`, `("!ja") === true`, `("/gogo") === true`, `("!sim") === false`.
- `src/test/agent-extract.test.ts` — adicionar caso da notificação bancária: `extractSpans("💳 Registre… Valor: R$ 15,86 Estabelecimento: Hirota Conta Corrente Itaú")` retorna `amount=15.86`, `payment_method='account'`, `account_hint` contendo "Itaú".
- `src/test/agent-parser.test.ts` — cobrir `"Ta escrito na mensagem"` **não** ser `confirm`; `"Pode"` isolado continua sendo.

### 9) Aceite
- Enviar de novo `1908A 💳 Registre… Conta Corrente Itaú` faz o agente **entender o valor E a conta** e pedir confirmação (fluxo normal, não FastLog).
- `"Ta escrito na mensagem"` deixa de virar "Não encontrei nada pendente".
- Salvar token `1908A` no Perfil é rejeitado; token válido (`!ja`, `#gasto`) segue funcionando.
- Nenhum turno passado (LLM/fallback) muda de comportamento.
- `npx vitest run` verde.

## Fora de escopo
- Reescrita do IntentRouter, do LLM ou do PolicyEngine.
- Alterar retenção de logs, migrar `agent_runs.path` para enum, mudar dashboards.
- Reprocessar mensagens antigas em lote (só o reparo dos 3 runs órfãos citados).
