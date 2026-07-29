## Diagnóstico (confirmado com dados reais)

A sessão está conectada, mas **nenhuma mensagem chega ao Nino**. Evidências:

- `provider_inbound_drops` (últimos 3 dias): os únicos eventos de mensagem recebidos hoje (29/07, 09:58) foram descartados com `reason=no_real_jid`, `jid_domains=["lid"]`, `has_alt=false`, `has_key=false`.
- `inbound_messages`: última mensagem processada em **28/07 15:28** — ou seja, nada entrou depois da atualização do WAHA.
- O classificador `supabase/functions/_shared/messaging/wahaInbound.ts` só aceita telefone quando o domínio do JID é `c.us` ou `s.whatsapp.net`, ou quando existem campos `remoteJidAlt`/`participantAlt`. A nova versão do WAHA entrega apenas `@lid` (identificador interno do WhatsApp) e não envia mais os campos `*Alt` nesse formato — por isso todo evento vira `no_real_jid` e a conversa nunca chega ao Agent Core.

Ou seja: não é o agente nem a sessão — é o contrato de payload do WAHA que mudou. Confirmado também na documentação/discussões do WAHA: o número real precisa ser resolvido via `GET /api/{session}/lids/{lid}` (retorna o `pn`) ou lido de novos campos de "phone number" no payload.

## Correção proposta

### 1. Resolver `@lid` no classificador (núcleo da correção)
Em `wahaInbound.ts`:
- Aceitar novos campos de telefone que o WAHA/Baileys atual pode enviar: `senderPn`, `participantPn`, `key.senderPn`, `key.participantPn`, `_data.key.senderPn`, além dos `*Alt` já suportados.
- Quando nada disso existir, **não descartar**: retornar a classificação com o `lid` capturado (`sender_lid`), para o webhook resolver.
- Manter intactas as regras de segurança atuais: grupos/broadcast/newsletter continuam descartados, `fromMe` continua descartado.

### 2. Resolução de LID no webhook, com cache
Em `supabase/functions/whatsapp-webhook/index.ts` (e um helper novo `_shared/messaging/lidResolver.ts`):
1. Consultar cache local (nova tabela `whatsapp_lid_map`: `lid` → `phone_e164`, `last_seen_at`).
2. Se não houver, chamar `GET {WAHA_API_URL}/api/{session}/lids/{lid}` autenticado (usando `getWahaAccess()`, com o mesmo `safeFetch`/guard SSRF já usado no projeto e timeout curto).
3. Normalizar com `normalizeBrPhone` e gravar no cache.
4. Se ainda assim não resolver, registrar drop com razão específica `lid_unresolved` (diagnóstico claro no admin) — sem quebrar o webhook.

O restante do fluxo (vínculo, conversa, orquestrador, resposta) permanece igual, pois passa a receber um telefone real.

### 3. Diagnóstico melhor
- Nova razão de drop `lid_unresolved` + coluna opcional para o `lid` mascarado, para o painel mostrar o motivo real em vez de "no_real_jid" genérico.
- Log estruturado (sem dados sensíveis) quando a resolução via API falhar.

### 4. Reprocessamento
Como as mensagens descartadas não foram persistidas (só o drop), não há corpo para reprocessar automaticamente. Após o deploy, faremos um teste real end-to-end: enviar uma mensagem para o número e confirmar `inbound_messages` → `outbound_messages` com resposta do Nino. Se você tiver lançamentos enviados nesse intervalo, me diga e eu registro como fizemos antes.

### 5. Testes
- Novos casos em vitest para `classifyInbound`: payload só com `@lid`; payload com `senderPn`; payload com `@lid` de grupo (deve continuar descartado); `fromMe` com `@lid`.
- Teste unitário do resolver com cache hit / API hit / falha.

## Detalhes técnicos

- Nova migration: tabela `public.whatsapp_lid_map` (`lid text primary key`, `phone_e164 text not null`, `updated_at timestamptz`), com `GRANT` para `service_role` apenas, RLS habilitada e sem policies para clientes (acesso só via edge function service-role).
- `provider_inbound_drops`: adicionar `lid_masked text null` (idempotente).
- Sem alterações na LP, no app autenticado ou na autenticação.
