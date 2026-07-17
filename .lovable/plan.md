# Plano — Corrigir parser WAHA NOWEB (@lid) no whatsapp-webhook

## Diagnóstico

O endpoint responde 200 e o log mostra `ignored=unmapped_or_bot`, ou seja, `mapInboundEvent` retorna `null` sem persistir nada. Causa provável no engine NOWEB 2026.5.1:

- `payload.from` / `payload.key.remoteJid` vêm como `<num>@lid` (identificador opaco do NOWEB), não `@c.us` nem `@s.whatsapp.net`. Após remover `@c.us`/`@s.whatsapp.net`, o parser atual mantém `<num>@lid`, então derruba tudo em `@.+` e passa um número **não real** para `normalizeBrPhone`, que falha (ou pior, aceitaria um id opaco). O telefone real vem em campos `*Alt` (`remoteJidAlt`, `participantAlt`) ou aninhados em `_data.key.*`.
- Não há nenhum caminho de log/persistência para eventos descartados, então o "200 silencioso" esconde a causa.
- Não há dedupe entre `message` e `message.any` (o mesmo `provider_message_id` chega duas vezes). Hoje é absorvido pela unique key em `inbound_messages`, mas o diagnóstico duplica.

## Correção cirúrgica

Escopo restrito a `_shared/messaging/waha.ts` (parser), `_shared/messaging/types.ts` (helper `resolveRealJid`, opcional), `whatsapp-webhook/index.ts` (persistência do diagnóstico) e testes.

### 1) Parser NOWEB seguro (`mapInboundEvent`)

Ordem de resolução do telefone (para cada candidato, extrair sufixo e só aceitar `@c.us` ou `@s.whatsapp.net`; **rejeitar `@lid`, `@g.us`, `@broadcast`, `@newsletter`**):

```
pl.remoteJidAlt
pl.participantAlt
pl._data?.key?.remoteJidAlt
pl._data?.key?.participantAlt
pl._data?.remoteJidAlt
pl.key?.remoteJidAlt
pl.key?.participantAlt
pl.from              (se sufixo c.us/s.whatsapp.net)
pl.key?.remoteJid    (se sufixo c.us/s.whatsapp.net)
pl.participant       (se sufixo c.us/s.whatsapp.net)
```

Regras invariantes:
- Se todos os candidatos válidos falharem → retornar `null` com `reason="no_real_jid"`.
- Nunca passar um `@lid` para `normalizeBrPhone`. Nunca gravar `@lid` em `whatsapp_links.phone_e164`.
- Bloquear grupos: sufixo `@g.us` em qualquer candidato aceito → `reason="group"`.
- `fromMe` (raiz ou `key.fromMe` ou `_data.key.fromMe`) → `reason="from_me"`.
- Filtro de evento: aceitar apenas `event ∈ {message, message.any}` explicitamente; qualquer outro → `reason="event_ignored"` (hoje há um tolerante que aceita ausência de evento — manter).
- `msgId`: `pl.id (string|object._serialized|object.id) → pl.key?.id → pl._data?.id?._serialized → pl._data?.key?.id`. Se ausente → `reason="no_message_id"`.
- `body`: manter o encadeamento atual + `pl.message?.imageMessage?.caption`, `videoMessage.caption`, `documentMessage.caption`, `pl._data?.message?.*` equivalentes. Vazio é permitido (mídia sem legenda) — não é motivo de descarte.
- `timestamp`: aceitar `pl.timestamp` (segundos) e `pl.messageTimestamp` (segundos). Sanitizar se fora de `[now-30d, now+1d]` → cair para `Date.now()`.

Retorno adicional (opcional, sem quebrar contrato): função interna `classifyInbound(payload)` que retorna `{ ok: NormalizedInbound } | { ok: null, reason, event, session, jid_domains: string[] }`. O `mapInboundEvent` continua expondo apenas `NormalizedInbound | null` (compatível com `MessagingProvider`).

### 2) Dedupe message + message.any

No `whatsapp-webhook/index.ts`, após `classifyInbound`, calcular `provider_message_id` **antes** do insert (já é feito). O unique constraint já dedupa a persistência do inbound; o problema é chamar `runOrchestrator` duas vezes. Adicionar guarda: `INSERT ... ON CONFLICT (provider_message_id) DO NOTHING RETURNING id`. Se `id` for null → segunda cópia, responder `{ok:true, dedup:true}` sem orquestrar (o código atual já faz isso via `if (insErr) return dedup`, mas depende do erro de duplicate; migrar para `ignoreDuplicates` explícito é mais robusto).

### 3) Diagnóstico sanitizado

Nova tabela leve `provider_inbound_drops` (ou reuso de `provider_health_events` com `kind='inbound_drop'`). Preferir **reuso de `provider_health_events`** — já existe no schema — para evitar migration nova. Payload gravado:

```json
{
  "reason": "no_real_jid" | "group" | "from_me" | "event_ignored" | "foreign_session" | "no_message_id" | "unmapped",
  "event": "message.any",
  "session": "default",
  "jid_domains": ["lid"],       // sufixos vistos, nunca o JID inteiro
  "has_alt": false,
  "has_key": true
}
```

Nunca gravar: body, telefone, JID completo, pushName, ids privados, payload bruto.

No `whatsapp-webhook`, substituir todos os `return json({ok:true, ignored:...})` por: `await logDrop(reason, evt, session, jid_domains)` + `return json`. Falha do log não bloqueia a resposta.

### 4) Testes unitários (Vitest)

Novo arquivo `src/test/waha-mapinbound.test.ts` cobrindo `classifyInbound` (exportado para testes):

- NOWEB @lid com `remoteJidAlt: "5511999999999@s.whatsapp.net"` → aceita, `from_phone="+5511999999999"`.
- NOWEB @lid sem alt → `reason="no_real_jid"`.
- Legado `pl.from="5511988887777@c.us"` → aceita.
- `fromMe: true` na raiz → `reason="from_me"`.
- `key.fromMe: true` aninhado → `reason="from_me"`.
- `remoteJid: "...@g.us"` → `reason="group"`.
- `event: "session.status"` → `reason="event_ignored"`.
- Sem `key.id` nem `id` nem `_data.id` → `reason="no_message_id"`.
- Mesmo `provider_message_id` chegando via `message` e `message.any` → segundo insert é dedup (teste no wrapper, mockando supabase).
- Body vindo apenas de `imageMessage.caption`.
- Timestamp fora de janela → substituído por `Date.now()`.

Rodar `vitest run` — meta: 100% verde + suite anterior estável.

### 5) Deploy

Apenas `whatsapp-webhook`. `whatsapp-send` **não** precisa (não muda). `_shared/messaging/waha.ts` é incluído automaticamente na função quando referenciado.

## Arquivos

- `supabase/functions/_shared/messaging/waha.ts` — reescrever `mapInboundEvent` + exportar `classifyInbound`.
- `supabase/functions/_shared/messaging/jid.ts` (novo, opcional) — util `parseJid(raw): { local, domain } | null` + lista branca de domínios reais.
- `supabase/functions/whatsapp-webhook/index.ts` — usar `classifyInbound`, logar drops em `provider_health_events`, dedupe explícito por `provider_message_id`.
- `src/test/waha-mapinbound.test.ts` (novo).
- Sem migration nova (reusa `provider_health_events`). Se essa tabela não tiver o shape necessário, cria migration mínima adicionando índice `(created_at desc)` — verificar antes.

## Critério de aceite

1. Enviar mensagem real do WhatsApp para o número oficial:
   - `inbound_messages` ganha linha nova (uma só, mesmo com `message`+`message.any`).
   - `conversations`/`conversation_messages` populam.
   - `agent_runs` registra execução.
   - `outbound_messages` recebe resposta e é enviada.
2. Payload com `@lid` sem alt não deve mais causar 200 silencioso — deve aparecer registro em `provider_health_events` com `reason="no_real_jid"`.
3. Nenhum `whatsapp_links.phone_e164` contém `@lid` (query de verificação).
4. Todos os testes novos + suite existente passam.
5. Deploy de `whatsapp-webhook` confirmado; nenhuma alteração em WAHA/sessão/infra.

## Fora do escopo

- WAHA config, sessão, QR, admin panel.
- `whatsapp-send`, orquestrador, agente, prompts.
- Frontend/publish.
