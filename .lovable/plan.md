## Objetivo

Fazer o fluxo do usuário comum funcionar mesmo quando `VITE_WHATSAPP_OFFICIAL_NUMBER` estiver ausente, resolvendo o número oficial via backend a partir da sessão WAHA já conectada, sem expor segredos.

## 1. Nova Edge Function `whatsapp-official-number` (autenticada, leitura)

- `verify_jwt = true` (usuário comum autenticado basta).
- Fluxo:
  1. Validar Bearer do usuário via `auth.getUser()`.
  2. Instanciar service client, `loadWahaConfig()` (lê Vault). Se não configurado → `{ available: false, official_number: null, source: "unconfigured" }`.
  3. Chamar `provider.getSessionStatus()` + `provider.getMe()`. Se status ≠ WORKING ou sem `phone` → `{ available: false, official_number: null, source: "not_connected" }`.
  4. Normalizar telefone via `normalizeBrPhone`. Retornar apenas `{ available: true, official_number: "+55DDDNNNNNNNNN", source: "waha" }`.
- Cache em memória do módulo (TTL 60s) para evitar hit a cada abertura do sheet.
- Retornar apenas os 3 campos citados. Nunca URL/API key/webhook.

## 2. Cache público sanitizado (fallback)

- Reaproveitar tabela `app_settings` (se existir) ou criar `public.platform_public_config` (`key text primary key`, `value text`, `updated_at`) — RLS habilitada, `GRANT SELECT` para `authenticated`, escrita só via service role. Migration com GRANT + policy `select using (true)`.
- A edge function grava `official_whatsapp_number` (E.164) sempre que resolve com sucesso via WAHA. Ele serve como fallback quando WAHA está momentaneamente indisponível.

## 3. Ajuste do `WhatsAppLinkSheet.tsx`

- Estado: `resolving` | `available(number)` | `unavailable`.
- Ao abrir: em paralelo `list_my_whatsapp_link` e `functions.invoke("whatsapp-official-number")`.
- Se `available`, usar `official_number`. Se erro/`unavailable`, tentar fallback: (a) valor de `platform_public_config.official_whatsapp_number` via select; (b) `VITE_WHATSAPP_OFFICIAL_NUMBER` normalizado. Só mostrar "número oficial em configuração" quando **todas** as fontes falharem.
- Normalização client-side via `normalizeBrPhone` antes de montar `wa.me`.
- `create_phone_link_code` só é chamado **após** ter número válido e consentimento marcado; código guardado em state e não descartado em erro de abertura de janela.
- `window.open` a partir do click síncrono (já é), mas se retornar `null` (popup bloqueado): mostrar bloco com código `VINCULAR NNNNNN`, botão **"Abrir WhatsApp novamente"** (retry `window.open`) e botão **"Copiar mensagem"**. Sheet não fecha automaticamente nesse caso.
- Aplicar mesma lógica em `src/pages/WhatsApp.tsx` (mesmo bug do OFFICIAL_NUMBER ali).

## 4. Testes (vitest)

Adicionar em `src/test/whatsapp-official-number.test.tsx`:
- Sheet com env ausente + edge disponível → botão habilitado, chama `create_phone_link_code`, `wa.me` correto.
- Env ausente + edge falha + fallback `platform_public_config` presente → funciona.
- Env ausente + edge falha + sem fallback → mostra indisponibilidade.
- Popup bloqueado (`window.open` mock retorna null) → código permanece visível com botão retry.
- URL final `https://wa.me/5511999999999?text=VINCULAR%20123456`.

## 5. Deploy e verificação real

- Deploy explícito da nova função + `whatsapp-session` inalterada.
- Rodar `bunx tsgo --noEmit`, `bunx vitest run`, build.
- Consulta SQL: `select count(*) from whatsapp_links where phone_masked ilike '%test%'` para garantir zero vínculos artificiais.
- Reportar URL do preview e instruir: entrar como usuário → Home → CTA WhatsApp → aceitar → clicar em "Gerar código" → WhatsApp abre com "VINCULAR NNNNNN" pré-preenchido.

## Não vamos

- Alterar sessão WAHA, Vault, credenciais ou config atual.
- Expor URL/API key WAHA no cliente.
- Exigir platform_admin do usuário final.
- Publicar produção.
