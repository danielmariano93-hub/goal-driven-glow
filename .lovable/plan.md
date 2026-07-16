## Correção definitiva do pareamento WhatsApp — QR + Código pelo telefone

Estado atual: sessão `default` em FAILED após expiração do QR. UI só renderiza QR quando `status=awaiting_qr`, então não há caminho para reiniciar o pareamento. Vou reconstruir o fluxo como máquina de estados explícita, com duas ações backend idempotentes (`prepare_pairing`, `begin_qr`, `request_pairing_code`) e UI que sempre oferece "Conectar aparelho" quando não estiver conectado.

### 1. Backend — `supabase/functions/whatsapp-session/index.ts` + `_shared/messaging/waha.ts`

Novas ações POST:

- **`prepare_pairing`** (idempotente, gate owner/admin):
  - resolve `session_name` do Vault (default);
  - lê status real via `GET /api/sessions/{name}`;
  - sessão inexistente → `POST /api/sessions` (config completa: webhook NoControle, metadata `app=nocontrole`, secret) + start;
  - `FAILED` → tenta `POST /api/sessions/{name}/restart`; poll curto (≤6s); se persistir FAILED → `POST /api/sessions/{name}/logout` → `POST /api/sessions/{name}/start`; re-aplicar webhook+metadata via `PUT /api/sessions/{name}`;
  - `STOPPED` → start;
  - `STARTING` → poll curto até SCAN_QR_CODE|WORKING|timeout;
  - `SCAN_QR_CODE` → pronto;
  - `WORKING` → retorna `connected`;
  - retorna `{ status, capabilities, correlation_id }` normalizado. Erros nunca vazam corpo bruto.

- **`begin_qr`**:
  - invoca `prepare_pairing`;
  - aguarda SCAN_QR_CODE (timeout ~8s);
  - `GET /api/{session}/auth/qr` (Accept: image/png);
  - converte binário → base64; retorna `{ qr, mime_type, expires_at≈60s }`;
  - QR não é logado nem persistido;
  - status FAILED não bloqueia (prepare_pairing já resolve).

- **`request_pairing_code`**:
  - gate owner/admin + rate-limit (`waha_pairing_code`);
  - invoca `prepare_pairing`;
  - normaliza telefone → dígitos com DDI (usa `normalizeBrPhone` → remove `+`);
  - `POST /api/{session}/auth/request-code` body `{ phoneNumber }`;
  - retorna `{ pairing_code, expires_at, status }`;
  - códigos `unsupported`, `PASSKEY_REQUIRED`, `PASSKEY_CONFIRMATION_REQUIRED` são mapeados para códigos humanos (`method_unsupported`, `passkey_required`, `passkey_confirmation_required`);
  - auditoria com telefone mascarado (últimos 4).

Endpoints WAHA confirmados desta instalação (versão 2026.5.1/NOWEB):
- update: `PUT /api/sessions/default` ✅
- create: `POST /api/sessions` ✅
- qr: `GET /api/default/auth/qr` ✅
- pairing-code: `POST /api/default/auth/request-code` (novo)
- start/stop/restart/logout: `POST /api/sessions/default/{action}` — validar em runtime, adaptar se 404.
- NUNCA usar `POST /api/sessions/default` (404 confirmado).

`_shared/messaging/waha.ts` ganha helpers: `preparePairing()`, `requestPairingCode(phoneDigits)`, e revisão de `restartSession/logoutSession/startSession` para usar apenas rotas aceitas (checar `PUT /api/sessions/default` vs `POST /api/sessions/{name}/restart`; adaptar se falhar).

Rate-limit adicionado via `admin_rate_check` para `waha_prepare`, `waha_qr`, `waha_pairing_code`.

### 2. Frontend — `src/pages/admin/WhatsAppSessionPanel.tsx`

Refatorar para máquina de estados explícita:
```
loading → (connected | disconnected)
disconnected → choose_method → (showing_qr | showing_code) → error*
```

- **Renderização não depende mais de `needsSession`**: se `status !== "connected"` e `can_manage_config`, mostra card "Conectar aparelho".
- Card "Conectar aparelho" abre tabs: **QR Code** | **Código pelo telefone**.
- Aba QR:
  - botão "Gerar QR Code" → `begin_qr` → renderiza `<img src="data:{mime};base64,{qr}"/>`;
  - contador de expiração (~60s) + botão "Gerar outro";
  - auto-renew opcional quando expira.
- Aba Código:
  - input com máscara `+55 11 99999-9999` (placeholder), botão "Gerar código";
  - resultado exibido em blocos grandes (`XXXX-XXXX`), botão "Copiar";
  - instruções: *WhatsApp → Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone*;
  - link "Tentar com QR Code" volta para aba QR;
  - erros mapeados (`method_unsupported` → mostra aviso + destaca QR; `passkey_required` → orienta).
- Polling de status continua, mas **não desmonta** o QR/código em erro transitório: mantém último QR renderizado até substituição bem-sucedida.
- Ao recarregar página com `SCAN_QR_CODE`, cai direto em `choose_method` (QR selecionado por padrão) — nunca tela vazia.
- Telefone digitado só existe em `useState`, nunca vai a storage.
- Quando `connected`: mostra telefone mascarado + ações de teste (já existentes).

### 3. Autorização

`config_status` já retorna `can_manage_config` (correção anterior). Frontend usa somente essa flag para habilitar ações — nenhuma checagem por email/role local.

### 4. Testes e validação

- Vitest: extender `whatsapp-wizard.test.tsx` cobrindo:
  - status FAILED → card "Conectar aparelho" visível;
  - clique em "Gerar QR Code" chama `begin_qr` e renderiza `<img>`;
  - tab "Código pelo telefone" com input + submit chama `request_pairing_code`;
  - resposta `method_unsupported` mostra fallback QR sem desmontar;
  - erro transitório de polling não apaga QR renderizado.
- Deploy real das Edge Functions no projeto (não só código local).
- Contra o Manager real: reiniciar sessão, `begin_qr` → confirmar HTTP 200 + PNG; `request_pairing_code` — validar contrato (sem enviar para número real sem autorização explícita do Daniel).
- `bunx tsgo --noEmit` + `bunx vitest run` + build Vite.

### 5. Aceite

- Página em FAILED mostra "Conectar aparelho" com dois métodos.
- QR sob demanda; código sob demanda; QR sempre disponível como fallback.
- Refresh de status nunca desmonta o fluxo ativo.
- Nenhuma credencial digitada; Daniel não vê "Apenas o dono".
- Nenhum secret no frontend; telefone jamais logado por completo.

### Arquivos a alterar
- `supabase/functions/_shared/messaging/waha.ts` — helpers `preparePairing`, `requestPairingCode`, revisão de start/restart/logout.
- `supabase/functions/whatsapp-session/index.ts` — actions `prepare_pairing`, `begin_qr`, `request_pairing_code`.
- `src/pages/admin/WhatsAppSessionPanel.tsx` — máquina de estados + UI tabs QR/Código.
- `src/lib/admin/statusMapper.ts` — mensagens novas (`method_unsupported`, `passkey_required`, `passkey_confirmation_required`, `preparing`).
- `src/test/whatsapp-wizard.test.tsx` — novos casos.
