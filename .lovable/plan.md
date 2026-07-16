
## Objetivo
Usar o slot `default` do Manager WAHA (tier CORE) exclusivamente para o NoControle, com isolamento vindo do Vault + metadata + webhook próprio, e destravar o painel `/admin/whatsapp` para mostrar status real e QR.

## Causa raiz
No commit anterior fixamos `NOCONTROLE_SESSION = "nocontrole"` como canônico no provider, webhook e RPC `admin_waha_save_config`. Como o Manager real está em CORE, ele rejeita qualquer sessão ≠ `default` com HTTP 422, e a antiga `default` (Sniper, FAILED) foi liberada pelo owner. Precisamos voltar a resolver `session_name` sempre pelo Vault, com fallback `default`, e nunca aceitar do frontend.

## Passos

### 1. Vault
- Atualizar via `_vault_upsert`: `WAHA_SESSION_NAME_NOCONTROLE = "default"`.
- Manter URL, API key e webhook secret já gravados.

### 2. Migration SQL
- `admin_waha_save_config(...)`: remover o pin de `nocontrole`. Aceitar `p_session_name` apenas quando explicitamente enviado pelo backend admin; default no servidor = `default`. Frontend nunca envia esse campo (whitelist server-side).
- `admin_waha_resolve_config()`: já retorna do Vault — sem mudanças além de garantir default `default`.
- Limpar heartbeats/estado que dependam do literal `nocontrole` como chave de sessão (metadata do projeto permanece `nocontrole`).

### 3. Runtime provider (`supabase/functions/_shared/messaging/waha.ts`)
- Remover `NOCONTROLE_SESSION` como constante canônica; manter apenas `DEFAULT_SESSION_FALLBACK = "default"`.
- `WAHA_SESSION` inicializado do env com fallback `default`; `loadWahaConfig` sobrescreve com Vault.
- `buildSessionConfig`: incluir `metadata: { app: "nocontrole", project: "nocontrole", environment: <env> }` no config da sessão, junto ao webhook.
- Não hardcode `nocontrole` em nenhum caminho de request (send, QR, status, /me).

### 4. Edge functions
- `whatsapp-webhook`: validar `payload.session === getSessionName()` (agora `default`), rejeitar demais. Idempotência já inclui `provider_message_id`; adicionar `session_name` na chave para evitar colisão histórica.
- `whatsapp-send`, `whatsapp-ack-watchdog`, health: já usam `getSessionName()` — confirmar após remoção do literal.
- `whatsapp-session`:
  - Ação `setup`: `createOrUpdateSession(webhookUrl)` idempotente (PUT/POST) com config novo (webhook + metadata NoControle) → se sessão FAILED, `restart`; se persistir FAILED, `logout` + `start` para forçar novo pareamento.
  - Ação `status`: retornar status real; quando `SCAN_QR_CODE`, buscar QR.
  - Nunca aceitar `session_name` do body.

### 5. Frontend `WhatsAppSessionPanel.tsx`
- Botão "Conectar" chama `setup` e navega direto à etapa QR (não apenas refresh).
- Enquanto status ∈ {`STARTING`,`SCAN_QR_CODE`}, poll a cada 3s e re-fetch QR quando status muda.
- Não exigir wizard de URL/key se Vault já tem config (`configured=true`).
- Owner com `can_manage_config=true` mantém acesso.

### 6. Execução real contra Manager
Sequência dentro de `whatsapp-session` (executada uma vez no console admin/manual):
1. `GET /api/sessions/default` → confirma FAILED.
2. `PUT /api/sessions/default` com config novo (webhook NoControle + metadata + eventos + header secret).
3. Se PUT retornar não-ok mas sessão existe: `POST /api/sessions/default/logout` → `POST /api/sessions/default/start`.
4. Poll status: STOPPED→start; STARTING→aguardar; FAILED→restart→(persistir) logout+start; SCAN_QR_CODE→GET QR; WORKING→GET /me.

### 7. Testes
- Atualizar `admin-waha-validate.test.ts` e `whatsapp-permissions.test.tsx` para o novo default `default`.
- Novo teste: webhook rejeita `session !== resolved`.
- Novo teste: provider não contém literal `"nocontrole"` em chamadas HTTP.
- `bunx vitest run` + `tsgo`.

## Aceite
Vault `session_name=default`; sessão `default` reconfigurada com webhook + metadata NoControle; status real `SCAN_QR_CODE` ou `WORKING`; QR visível no admin; owner Daniel com acesso; nenhuma credencial repetida.

## Ação manual restante
Escanear o QR no painel `/admin/whatsapp` (única etapa que exige o celular do owner).
