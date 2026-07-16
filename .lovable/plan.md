## Diagnóstico
- `public.admin_waha_config_status()` hoje retorna apenas `configured/has_url/has_api_key/has_webhook_secret/session_name/updated_at`. NÃO retorna `role` nem capability.
- A edge function tenta remendar com `{ ...data, role: gate.role }`, mas isso não é contrato tipado e some silenciosamente em qualquer caminho de erro/timeout.
- Frontend usa `config?.role === "platform_owner"` para habilitar "Configurar/Substituir". Se o campo faltar (undefined), o botão desabilita com "Apenas o dono…" — bloqueando o próprio owner (Daniel), que está corretamente cadastrado em `platform_admins` como `platform_owner active=true`.
- **Causa raiz exata: divergência entre contrato do backend (sem capability) e tipo do frontend (assume `role`).**

## Correção

### 1. Migration — capability explícita e tipada
Recriar `public.admin_waha_config_status()`:
```json
{
  configured, has_url, has_api_key, has_webhook_secret,
  session_name, updated_at,
  admin_role,            // 'platform_owner' | 'platform_admin' | null (para display)
  can_manage_config      // bool = admin_role='platform_owner'
}
```
- Continua com `is_platform_admin()` gate + SECURITY DEFINER.
- Sem valores sensíveis (nenhum secret decifrado exposto além do já existente `session_name`).
- `admin_waha_save_config` mantém seu gate `current_platform_admin_role() <> 'platform_owner' RAISE 'not_authorized'`. Autorização segue 100% server-side.

### 2. Edge function `whatsapp-session`
- `config_status` retorna o payload da RPC diretamente. Remover o remendo `role: gate.role` para não mascarar o contrato.
- `save_config` continua exigindo `gate.role === "platform_owner"` como defesa em profundidade.

### 3. Frontend `WhatsAppSessionPanel.tsx`
- `ConfigStatus`: substituir `role?` por `admin_role?: string | null` e `can_manage_config?: boolean`.
- `const canManageConfig = config?.can_manage_config === true;`
- Regras:
  - `configLoading` → skeleton, sem hint de permissão.
  - `configError` → card "Tentar novamente".
  - Payload sem `can_manage_config` definido → tratar como contrato inválido: setar `configError = "invalid_contract"`.
  - `notConfigured && canManageConfig` → botão "Configurar conexão" habilitado.
  - `notConfigured && !canManageConfig` (config carregada com sucesso) → botão desabilitado + hint negativo.
  - Botão "Substituir credenciais" só renderiza quando `canManageConfig`.
- `loadConfig()` refetch em `visibilitychange` para evitar cache stale entre trocas de conta/aba.

### 4. Auditoria
- `rg "config\?\.role|platform_owner"` no `src/` — hoje só `WhatsAppSessionPanel.tsx` lê `role` do payload de config_status. Nenhuma outra tela afetada.

### 5. Testes
- Novo `src/test/whatsapp-permissions.test.tsx` (RTL + mock `functions.invoke`):
  1. Owner (`can_manage_config=true`, `configured=false`) → botão habilitado, sem hint.
  2. Não-owner (`can_manage_config=false`) → botão desabilitado + hint visível.
  3. Payload sem `can_manage_config` → estado de erro com "Tentar novamente".
  4. Loading (config_status pendente) → nenhum hint negativo.
  5. Owner clica "Substituir credenciais" → wizard abre em `mode=replace`.
- Atualizar `whatsapp-wizard.test.tsx` para novo shape (`can_manage_config: true`).
- Validação server-side de owner permanece coberta pelo gate SQL.

### 6. Ordem
1. `supabase--migration` — nova `admin_waha_config_status`.
2. Aguardar aprovação; types regenerados.
3. Editar `supabase/functions/whatsapp-session/index.ts` (limpar remendo de role).
4. Editar `src/pages/admin/WhatsAppSessionPanel.tsx` (novo type + `canManageConfig` + estado de contrato inválido + refetch em visibilitychange).
5. Atualizar/adicionar testes.
6. `bunx vitest run`.

## Aceite
- Daniel (owner ativo) vê "Configurar conexão" habilitado logo após o load.
- Admin não-owner vê hint negativa somente após load com sucesso.
- Payload malformado gera erro com retry, nunca falso bloqueio silencioso.
- `save_config`/`admin_waha_save_config` recusam não-owner mesmo com cliente adulterado.
- Suíte de testes verde; build ok.
