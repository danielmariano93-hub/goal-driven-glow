## Objetivo
Fazer o webhook WAHA receber mensagens reais, consumir o código de vinculação, refletir o vínculo na plataforma, enviar respostas reais pelo WhatsApp e humanizar a mensagem pré-preenchida.

## Diagnóstico
- `phone_link_codes` tem 1 código ativo mas `inbound_messages=0` → o webhook nunca foi chamado.
- Provável causa: sessão `default` no Manager WAHA não tem o webhook do NoControle configurado corretamente, ou o `customHeaders` (X-Webhook-Secret) não é propagado nesta versão (2026.5.1/NOWEB), ou o evento não bate com o mapper atual.
- Falta dispatcher real que envie `outbound_messages` via WAHA — hoje o webhook só insere na tabela.
- Mensagem pré-preenchida técnica (`VINCULAR 123456`) precisa virar frase humana.

## Plano de execução

### 1. Sincronizar webhook da sessão default (sem derrubar conexão)
- Nova rota admin em `whatsapp-session/index.ts`: `action=sync_webhook` que faz `PUT /api/sessions/default` preservando `config.metadata` e credenciais atuais, aplicando:
  - `config.webhooks[0].url` = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`
  - `events`: `["message", "message.any"]` (compatível com NOWEB 2026.5.1)
  - Autenticação: como `customHeaders` não é confiável entre versões, adotar **HMAC nativo** (`hmac: <secret>`) quando suportado + **token opaco no path** como fallback (`/functions/v1/whatsapp-webhook?t=<opaque>`).
  - Segredos: `WAHA_WEBHOOK_HMAC` e `WAHA_WEBHOOK_TOKEN` (gerar via `generate_secret`).
- Botão "Sincronizar webhook" no `WhatsAppSessionPanel`, com feedback do último `status`/erro sanitizado.

### 2. Endurecer verificação no `whatsapp-webhook`
- Aceitar duas formas de verificação, em ordem:
  1. HMAC: header `X-Webhook-Hmac` = `HMAC_SHA512(body, WAHA_WEBHOOK_HMAC)` (formato WAHA).
  2. Token opaco: query `?t=` == `WAHA_WEBHOOK_TOKEN`.
  3. Compat: header `X-Webhook-Secret` (fluxo atual) mantido.
- Rejeitar 401 quando nenhuma bate. Nunca aceitar sem verificação.

### 3. Corrigir event mapping WAHA 2026.5.1
Em `_shared/messaging/waha.ts` `mapInboundEvent`:
- Aceitar `event ∈ {"message", "message.any"}`.
- Extrair `from` de `payload.from` **ou** `payload.key.remoteJid` (strip `@c.us`/`@s.whatsapp.net`).
- Extrair `id` de `payload.id` (string) ou `payload.key.id` (objeto → string).
- Extrair `body` de `payload.body` ou `payload.message.conversation` ou `payload.message.extendedTextMessage.text`.
- Ignorar `fromMe=true` e `payload.key.fromMe=true`.
- Adicionar fixture real sanitizada em teste.

### 4. Parser amigável + humanização
- Regex no webhook aceita:
  - novo: `/c[oó]digo de verifica[cç][aã]o[:\s]+(\d{6})/i` **apenas** se contiver "NoControle" ou frase-âncora de verificação.
  - legado: `/^\s*VINCULAR\s+(\d{4,8})\s*$/i`.
- Número solto em conversa comum **não** vincula.
- Mensagem pré-preenchida em `WhatsAppLinkSheet.tsx` e `pages/WhatsApp.tsx`:
  `"Olá! Quero vincular meu WhatsApp ao NoControle. Meu código de verificação é: 123456"`
- Resposta de sucesso usa primeiro nome do `profiles.display_name` quando existir:
  `"Tudo certo, {nome}! Seu WhatsApp foi conectado à sua conta. 🎉 A partir de agora, pode me mandar seus gastos, metas e dúvidas por aqui."`
- Resposta de erro humana: `"Não consegui validar seu código. Ele pode ter expirado. Gere um novo código no app e me envie novamente. 💛"` (sem rota técnica).

### 5. Dispatcher real de outbound
- Fazer o webhook chamar `whatsapp-send` (invoke via service-role) diretamente após inserir `outbound_messages`, com idempotency por `outbound_messages.id`. Envio síncrono para respostas de vínculo e resposta do agente.
- Marcar `status='sent'` / `error_code` no registro.
- Dedupe: se `provider_message_id` de `inbound_messages` já processado, retornar sem re-enviar.
- Ativar `whatsapp-ack-watchdog` cron (se já existe) sem alterar.

### 6. Health/diagnóstico no admin
- Card em `WhatsAppSessionPanel`: "Recebendo mensagens" (verde) se houve `inbound_messages` nas últimas 24h; "Precisa de atenção" caso contrário. Mostra timestamp da última recebida. Nada de URL/secret/stack.
- Nova RPC `admin_whatsapp_inbound_health()` retornando `{last_inbound_at, count_24h}`.

### 7. Reflexo na plataforma
- Após envio da mensagem no `WhatsAppLinkSheet`, iniciar polling curto (5s × 24) em `list_my_whatsapp_link`; ao detectar `active`, invalidar queries e trocar sheet para "WhatsApp conectado" com telefone mascarado.
- `list_my_whatsapp_link` já retorna active — só falta o refetch reativo.

### 8. Preservar correções anteriores
- Migration `extensions.digest`, portal `z-[200]`, `BottomTabBar z-40`, safe-area, scroll lock, erro inline, número oficial server-side: tudo mantido.

### 9. Testes
- `whatsapp-webhook`:
  - HMAC válido aceita; inválido 401.
  - Token opaco fallback funciona.
  - Formato novo amigável → código extraído e vínculo criado.
  - Legado VINCULAR continua.
  - Número solto em conversa comum → nada vincula.
  - Código expirado → resposta amigável, sem vínculo.
  - Vínculo cria `whatsapp_links active` + `used_at`.
  - `fromMe=true` ignorado.
  - Dedupe: mesmo `provider_message_id` → uma resposta.
  - Fixture WAHA 2026.5.1 real (payload.key.remoteJid).
- UI: portal/z-index/polling.
- Rodar suite completa + typecheck + build.

### 10. Validação final
- Deploy `whatsapp-webhook`, `whatsapp-session`, `whatsapp-send`.
- Chamar `action=sync_webhook` no ambiente real da sessão default preservando conexão.
- Teste sintético: enviar payload assinado por HMAC → checar `inbound_messages` incrementa → **remover** o registro sintético e o inbound gerado por ele para não deixar lixo. Não criar `whatsapp_links` sintético.
- Consultar contadores e relatar objetivamente. **Não publicar produção.**

## Arquivos a alterar
- `supabase/functions/whatsapp-webhook/index.ts` (verificação HMAC+token, parser amigável, chamada de dispatcher, resposta humanizada com primeiro nome).
- `supabase/functions/_shared/messaging/waha.ts` (mapInboundEvent 2026.5.1, HMAC helper, sync_webhook payload).
- `supabase/functions/whatsapp-session/index.ts` (action `sync_webhook`).
- `supabase/functions/whatsapp-send/index.ts` (idempotency por outbound id, chamada interna).
- `src/pages/admin/WhatsAppSessionPanel.tsx` (botão sync + card health).
- `src/components/whatsapp/WhatsAppLinkSheet.tsx` (mensagem humana, polling reativo).
- `src/pages/WhatsApp.tsx` (mesma mensagem humana).
- `src/hooks/useAdminPlatformStatus.ts` ou hook novo para inbound health.
- Migration: RPC `admin_whatsapp_inbound_health`.
- Testes: `whatsapp-webhook.test.ts` novo com fixtures WAHA 2026.5.1; atualizar `whatsapp-wizard.test.tsx`.
- Secrets: `WAHA_WEBHOOK_HMAC`, `WAHA_WEBHOOK_TOKEN` (generate_secret).

## Riscos e mitigação
- **Derrubar sessão conectada ao dar PUT**: enviar payload que preserva `config.metadata` e não toca em credenciais/engine.
- **HMAC não suportado nesta versão**: token opaco no path serve de fallback imediato e mantém segurança.
- **Loop de resposta**: dedupe por `provider_message_id` + ignorar `fromMe`.
