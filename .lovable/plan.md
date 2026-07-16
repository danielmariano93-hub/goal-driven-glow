## Objetivo
Validar, no servidor, se as credenciais do WAHA (`WAHA_API_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_SECRET`, sessão `default`) estão corretas e se o host `waha.sincrofy.com.br` responde, sem expor secrets no bundle, chat ou logs. Sem publish.

## Diagnóstico
- `whatsapp-session` já expõe status *capability-based*, mas não temos um endpoint de "validação inicial" que reporte, em um único payload sanitizado, se cada peça está OK: URL alcançável, API key aceita, sessão existente, webhook configurado apontando para o nosso `whatsapp-webhook`, e secret do webhook coerente.
- O painel `/admin/whatsapp` só mostra status agregado; falta um passo explícito de "Validar credenciais" para o founder rodar antes de conectar QR.
- Precisamos que o resultado nunca imprima valores de secrets — apenas presença/ausência e códigos amigáveis (`ok`, `unreachable`, `unauthorized`, `session_missing`, `webhook_mismatch`, `not_configured`).

## Mudanças

### Backend
1. **Edge function `whatsapp-session`** — adicionar ação `validate` (POST `{ action: "validate" }`), gated por `is_platform_admin()`, que executa em paralelo e retorna um objeto sanitizado:
   ```
   {
     secrets: { api_url: bool, api_key: bool, webhook_secret: bool, session_name: "default" },
     host:    { ok: bool, latency_ms, code },      // GET /api/server/version (ou /api/sessions) com timeout
     auth:    { ok: bool, code },                   // 200 vs 401/403
     session: { exists: bool, status, code },       // GET /api/sessions/default
     webhook: { configured: bool, matches_url: bool, has_secret_header: bool, events_ok: bool, code }
   }
   ```
   Nenhum valor de secret, nenhum QR, nenhum token cru é logado ou devolvido. Erros mapeados para códigos curtos.
2. **`_shared/messaging/waha.ts`** — expor `getServerInfo()` e `describeWebhook()` (lê `sessions/default` e inspeciona `config.webhooks[]` para comparar `url`, presença de `X-Webhook-Secret` sem revelar valor, e cobertura de eventos `message`, `message.any`, `message.ack`, `session.status`). Comparações feitas server-side; devolve apenas booleans.

### Frontend (admin)
3. **`src/pages/admin/WhatsAppSessionPanel.tsx`** — adicionar bloco "Validar credenciais" acima do painel de sessão:
   - Botão "Validar agora" → chama `functions.invoke('whatsapp-session', { body: { action: 'validate' } })`.
   - Renderiza 5 linhas com `StatusChip`: Secrets configurados, Host alcançável, Autenticação, Sessão `default`, Webhook.
   - Cada linha com hint curto amigável mapeado por `errorMapper` / `statusMapper` (sem stack, sem URL, sem token).
   - Botão "Sincronizar webhook" só habilita se `host.ok && auth.ok` e webhook estiver `configured=false` ou `matches_url=false`.
4. Reaproveitar `AdminErrorBoundary` já existente.

### Testes
5. `src/test/admin-waha-validate.test.ts` — cobre o `statusMapper` para os novos códigos (`unreachable`, `unauthorized`, `session_missing`, `webhook_mismatch`) e garante que nenhum campo do payload de validação contém strings de URL/segredo (regex bloqueia `http`, `sk_`, `Bearer`, `X-Api-Key`).

## Ordem de implementação
1. Estender `waha.ts` com helpers de validação sanitizada.
2. Adicionar ação `validate` em `whatsapp-session` + gate admin.
3. UI do painel + integração + chips.
4. Testes + typecheck + build.

## UX / Copy (pt-BR)
- Título do bloco: "Validar credenciais do WhatsApp".
- Linhas: "Segredos configurados", "Servidor acessível", "Autenticação aceita", "Sessão `default` encontrada", "Webhook apontando para o NoControle.ia".
- Empty/erro: "Não consegui falar com o servidor agora." / "As credenciais foram recusadas." / "A sessão `default` ainda não existe — clique em Conectar para criá-la." / "O webhook aponta para outro endereço — clique em Sincronizar webhook."
- Nenhuma menção a nomes de env vars ou URLs internas.

## Riscos / Segurança
- Chamadas ao WAHA feitas apenas server-side; timeout 10s; sem retry agressivo.
- Endpoint gated por `is_platform_admin()` — 403 para qualquer outro.
- Payload passa por whitelist de campos antes do `Response`.
- Logs da function: apenas códigos (`ok`, `unauthorized`…), nunca corpo bruto do WAHA.
- Sem migration; nada muda em RLS.

## Critérios de aceite
- Founder abre `/admin/whatsapp`, clica "Validar agora", vê 5 chips com estado real.
- Se algum secret faltar, aparece "não configurado" sem revelar qual valor.
- Nenhum secret, URL ou token aparece no Network, console, bundle ou logs.
- Ação exige perfil `platform_admin`; usuário comum recebe 403.
- Typecheck, testes e build limpos.
