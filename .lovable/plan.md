## Reconectar WhatsApp oficial pelo painel admin

O usuário relatou que a sessão oficial caiu e o botão "Código pelo telefone" (e o QR) não conclui a reconexão. A causa provável, revisando `whatsapp-session` + `waha.preparePairing/requestPairingCode`:

- Quando a sessão está em `STOPPED`/`FAILED`, `request_pairing_code` chama `preparePairing` mas ignora o status devolvido e dispara `POST /api/{session}/auth/request-code` mesmo com a sessão fora de `SCAN_QR_CODE`. O WAHA responde erro genérico e a UI só mostra `provider_error`.
- Não existe um botão explícito de "Redefinir e reconectar" (logout + create + start) no card `ConnectDeviceCard`. Hoje só o wizard inicial faz isso, e o admin fica preso quando a sessão está em estado ruim.
- As mensagens de erro (`provider_error`, `method_unsupported`, `passkey_required`) aparecem cruas no card, sem instrução do que fazer.

### O que muda

Backend (`supabase/functions/whatsapp-session/index.ts` + `_shared/messaging/waha.ts`):
1. Em `request_pairing_code`: aguardar até 10s por `SCAN_QR_CODE` após `preparePairing`. Se não chegar nesse estado, retornar `error_code: "session_not_ready"` (sem tentar `/auth/request-code` no vazio).
2. Se `preparePairing` retornar `MISSING`/`FAILED` após tentativas, forçar `logoutSession → createOrUpdateSession → startSession` e reesperar.
3. Nova ação `reset_session` (owner/admin): `logoutSession → createOrUpdateSession(webhookUrl) → startSession`, retornando o snapshot atualizado.
4. Higienizar `requestPairingCode`: manter os códigos já mapeados e adicionar `session_not_ready`.

Frontend (`src/pages/admin/WhatsAppSessionPanel.tsx`):
5. Em `ConnectDeviceCard`, exibir botão "Redefinir sessão" quando o status for `disconnected`/`needs_attention`/`unavailable` — chama `reset_session`, aguarda status e reabilita QR/código.
6. Traduzir erros para instruções acionáveis:
   - `session_not_ready` → "A sessão ainda está subindo. Aguarde 10s ou clique em Redefinir sessão."
   - `method_unsupported` → "Este servidor WAHA não suporta código pelo telefone. Use QR."
   - `passkey_required` / `passkey_confirmation_required` → "O WhatsApp exigiu confirmação por passkey. Use QR."
   - `provider_error` → "Falha temporária no provedor. Tente novamente ou redefina a sessão."
7. Ao entrar na aba "Código pelo telefone", disparar `prepare_pairing` uma vez em background para acelerar o `SCAN_QR_CODE`.

Testes:
8. Ampliar `src/test/admin-waha-validate.test.ts` (ou adicionar `whatsapp-reset.test.tsx`) cobrindo:
   - request-code sem `SCAN_QR_CODE` retorna `session_not_ready`;
   - `reset_session` só permitido a owner/admin;
   - UI exibe botão "Redefinir sessão" quando status é `disconnected`.

### Fora de escopo
- Não altero Vault, número oficial, RLS ou webhook secret.
- Não publico produção; apenas deploy das edge functions em dev e verificação no preview admin.

### Como validar
1. Preview `Admin > WhatsApp` mostra status atual e botão "Redefinir sessão".
2. Clicar em "Redefinir sessão" leva a sessão para `SCAN_QR_CODE`; QR renderiza.
3. Aba "Código pelo telefone" com telefone válido retorna código; se WAHA não suportar, mostra mensagem clara.
4. Ao concluir escaneamento, snapshot vira `connected` sem intervenção adicional.
