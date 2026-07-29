## Situação atual (verificada)

`src/pages/admin/WhatsAppSessionPanel.tsx` já possui um `ConnectDeviceCard` inline com QR, código por telefone, polling de status e reset de sessão. O que falta é o formato **modal**: hoje o pareamento aparece como card empilhado na página (renderizado em 4 pontos diferentes), o botão "Reconectar aparelho" apenas alterna um estado `forceConnect`, e as mensagens de erro são códigos crus (`qr_unavailable`, `network`, `provider_error`) tratados de forma dispersa.

## O que será feito

### 1. Novo componente `src/components/admin/WhatsAppPairingDialog.tsx`
Move a lógica do `ConnectDeviceCard` para um `Dialog` (shadcn), mobile-first:
- Props: `open`, `onOpenChange`, `status`, `onConnected`.
- Abas internas: **QR Code** e **Código de 8 dígitos** (entrada de telefone + botão copiar).
- Cabeçalho com faixa de estado ao vivo: "Aguardando leitura", "Conectando", "Conectado", "Sessão fora do ar" — usando `mapWhatsAppStatus` do `statusMapper.ts` (nada de código cru na tela).
- Ao detectar `connected` no polling: mostra confirmação verde por ~1,5s, fecha o modal e chama `onConnected()`.
- QR expira: contador regressivo e regeneração automática, com botão manual "Gerar outro QR Code".
- Polling só ativo enquanto o modal está aberto (evita chamadas em background).

### 2. Mensagens de erro claras
Novo mapa `PAIRING_ERRORS` em `src/lib/admin/statusMapper.ts`, no mesmo padrão de `mapWahaValidate`, cobrindo: `qr_unavailable`, `prepare_failed`, `qr_not_ready`, `unauthorized`, `unreachable`, `not_configured`, `pairing_unsupported`, `invalid_phone`, `provider_error`, `network`.
Cada erro rende: título curto, explicação em linguagem simples e **próxima ação** (tentar de novo / trocar para QR / redefinir sessão / revisar credenciais). Nenhuma URL, token ou nome de provedor exposto.

### 3. Integração no painel
- Em `WhatsAppSessionPanel.tsx`, substituir as 4 renderizações do card por um único `WhatsAppPairingDialog` controlado por estado `pairingOpen`.
- "Reconectar aparelho" (com o AlertDialog de confirmação já existente) passa a abrir o modal.
- Quando não há sessão conectada, um botão primário "Conectar aparelho" abre o mesmo modal.
- Se as credenciais não estiverem completas, o botão fica desabilitado com aviso explicativo em vez de abrir um modal que falharia.

### 4. Validação de status
- Antes de gerar QR/código, o modal chama `status`; se já estiver `connected`, mostra o estado conectado em vez de um QR inútil.
- Mantida a sequência de retry existente (`begin_qr` → `prepare_pairing` → até 4 tentativas), agora com feedback textual de progresso ("Preparando a sessão…").

## Detalhes técnicos
- Nenhuma mudança em Edge Functions, banco ou contratos: as ações `status`, `begin_qr`, `prepare_pairing`, `request_pairing_code`, `reset_session` continuam iguais.
- Trabalho restrito a frontend/apresentação, dentro da paleta e do design system atuais.
- Typecheck + suíte de testes ao final.
