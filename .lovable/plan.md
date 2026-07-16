## Estado atual (já implementado nas rodadas anteriores)
- Vault `session_name = default` (migration aplicada e `_vault_upsert` reexecutado).
- Provider `createOrUpdateSession`: PUT em `/api/sessions/{session}`; fallback POST em `/api/sessions` só quando o PUT retorna 404 (nunca POST em `/api/sessions/default`).
- `NOCONTROLE_SESSION` removido. Sessão sempre resolvida do Vault; metadata `app=nocontrole, project=nocontrole` mantida em `buildSessionConfig`.
- Webhook rejeita `payload.session ≠ getSessionName()` (agora `default`).
- Painel `/admin/whatsapp`: polling de 3s enquanto `status ∈ {connecting, awaiting_qr}` ou `connectMode`; bloco inline "Escaneie este QR Code" renderiza `data:image/png;base64,…` assim que status vira `awaiting_qr`.
- Owner com `can_manage_config` habilitado.
- `getQr()` já faz `arrayBuffer → btoa` (sem `JSON.parse`) quando `Content-Type: image/png`.
- 91/91 testes verdes; `tsgo` limpo.

## Ajustes finais desta rodada
1. **Copy inline do QR**: trocar `"Escaneie o código no WhatsApp do número oficial."` por `"Escaneie este QR Code"` conforme aceite literal do usuário.
2. **`getQr()` — cabeçalho literal `image/png`**: manter o caminho binário e adicionar guard para content-types que começam com `image/` (não só `application/json`) para evitar qualquer tentativa de parse JSON acidental em futuras variantes do Manager. Preservar comportamento atual.
3. **Auto-render sem clique**: garantir que quando a página carregar com `snap.status === "awaiting_qr"`, o bloco QR aparece e o `useEffect` de polling já dispara um `qr` fetch imediato (hoje o polling só busca no primeiro tick após 3s). Adicionar um fetch inicial dentro do effect antes do `setInterval`.
4. **Validação real via preview**: rodar Playwright autenticado como owner Daniel contra `http://localhost:8080/admin/whatsapp`, aguardar status `awaiting_qr`, capturar screenshot e confirmar que o `<img alt="QR de conexão">` está no DOM com `src` começando por `data:image/png;base64,`.
5. **Testes/typecheck**: `bunx vitest run` + `bunx tsgo --noEmit`. Sem publicar.

## Aceite
- Owner abre `/admin/whatsapp` e vê o QR sem inserir credenciais e sem clicar em "Configurar".
- Screenshot Playwright anexado como evidência.
- Único passo humano restante: escanear o QR.
