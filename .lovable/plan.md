
# Refatoração: Platform Admin vs Usuário Financeiro

Objetivo: separar completamente a experiência do founder (administra o negócio NoControle.ia) da experiência do usuário financeiro (administra a própria vida financeira). Preservar tudo já construído em `/app/*`, isolar `/admin/*` como aplicação independente.

## 1. Modelo de papéis (migration incremental)

Nova estrutura, coexistindo temporariamente com `user_roles`:

- Enum `platform_role`: `platform_owner | platform_admin | support | analyst`.
- Tabela `platform_admins(user_id uuid PK → auth.users, role platform_role, active bool default true, created_at, created_by uuid)`. RLS: apenas `platform_owner/platform_admin` leem; nenhuma escrita direta (só via RPC).
- Tabela `platform_admin_audit(id, actor_user_id, target_user_id, action, meta jsonb, created_at)`. RLS: leitura por owner/admin.
- RPCs `SECURITY DEFINER` sem argumento `user_id`:
  - `is_platform_admin() → bool` (qualquer role ativa).
  - `current_platform_admin_role() → platform_role | null`.
  - `grant_platform_admin(_target uuid, _role platform_role)` — só `platform_owner`; audita.
  - `revoke_platform_admin(_target uuid)` — só `platform_owner`; audita; impede auto-revogação do último owner.
- Migração de dados: para cada `user_roles.role='admin'` existente, inserir em `platform_admins` com `role='platform_owner'` (idempotente) e registrar audit.
- Manter `is_current_user_admin()` como wrapper temporário sobre `is_platform_admin()` para compatibilidade das Edge Functions existentes até serem atualizadas nesta rodada.
- Founder (`daniel.assis@nocontrole.com.br`): garantir `platform_admins.role='platform_owner'` idempotente via migration que resolve o `user_id` por e-mail se já existir em `auth.users`. Não inserir dados financeiros para o founder. Não marcar `onboarding_completed_at` como completo para forçá-lo ao /app.

## 2. Tabelas de finanças da empresa

Namespaces separados, RLS bloqueando usuário financeiro:

- `company_accounts`, `company_categories`, `company_vendors`, `company_transactions`, `company_budgets`.
- Grants apenas para `authenticated` + `service_role`.
- RLS: `USING (is_platform_admin() AND current_platform_admin_role() IN ('platform_owner','platform_admin'))`.
- Trigger `updated_at`.
- Sem dados fictícios; empty states quando vazio.

## 3. Guards e roteamento

- `PlatformAdminRoute`: verifica RPC `current_platform_admin_role()`. Se não admin → `/app`. Se anon → `/login?next=`.
- `ProtectedRoute` (existente): se usuário for platform admin sem role `user` → redireciona `/admin`. Onboarding financeiro só se roles inclui `user` e não completou.
- `AuthContext`: expor `platformRole` além de `roles`. Não misturar com `isAdmin` financeiro (remover uso de `isAdmin` legado que hoje libera menu admin no `DesktopSidebar`).
- Login: após auth, decidir destino: `platformRole` presente → `/admin`; senão `/onboarding` ou `next` ou `/app`.
- Founder NÃO recebe `user_roles.role='user'` automático (ajustar trigger `handle_new_user` para não inserir `user` quando o usuário já for platform admin; ou remover role `user` do founder via migration).

## 4. AdminLayout independente

- `src/components/admin/AdminLayout.tsx`: sidebar desktop e bottom nav mobile próprios. Branding "NoControle.ia Admin — Centro de Comando". Header mostra e-mail + label da role (Platform Owner/Admin/Support/Analyst).
- Não reutilizar `AppLayout`/`DesktopSidebar`/`BottomTabBar`.
- Remover botão "Admin" do `DesktopSidebar` financeiro.

## 5. Rotas admin (lazy)

Todas envoltas em `<PlatformAdminRoute><AdminLayout /></PlatformAdminRoute>` como layout com `Outlet`:

```
/admin                     VisaoGeral (dashboard executivo)
/admin/usuarios            Usuarios
/admin/engajamento         Engajamento
/admin/financeiro          Financeiro da empresa
/admin/financeiro/lancamentos
/admin/agente              Agente (prompts, config, runs)
/admin/agente/simulador    Simulador
/admin/whatsapp            WhatsApp/WAHA (mover WhatsAppSessionPanel)
/admin/operacao            Jobs, crons, outbox, dead letters
/admin/produto             Desafios, categorias globais, feature flags
/admin/seguranca           Admins, auditoria, exclusões
/admin/configuracoes       Configurações
```

Todas com empty states honestos; sem placeholders inertes.

## 6. Matriz de permissões

Módulo `src/lib/admin/permissions.ts` + espelho em `_shared/admin/permissions.ts` para Edge Functions:

| Área | owner | admin | support | analyst |
|---|---|---|---|---|
| Visão Geral | ✓ | ✓ | ✓ | ✓ (read) |
| Usuários (ler) | ✓ | ✓ | ✓ | ✓ |
| Usuários (suspender/reset) | ✓ | ✓ | ✓ | ✗ |
| Financeiro empresa | ✓ | ✓ | ✗ | ✗ |
| Agente config | ✓ | ✓ | ✗ | ✗ (read) |
| WhatsApp ações críticas | ✓ | ✓ | ✗ | ✗ |
| Operação (retry/kill) | ✓ | ✓ | ✗ | ✗ |
| Produto flags | ✓ | ✓ | ✗ | ✗ |
| Segurança (grant/revoke) | ✓ | ✗ | ✗ | ✗ |
| Segurança (audit read) | ✓ | ✓ | ✗ | ✗ |
| Configurações críticas | ✓ | ✗ | ✗ | ✗ |

Edge Functions revalidam role via RPC no servidor (`current_platform_admin_role()` executado com JWT do chamador).

## 7. Migração de páginas existentes

- Mover `src/pages/AdminDashboard.tsx` → `src/pages/admin/VisaoGeral.tsx` (adaptar).
- Mover `src/pages/admin/Agente.tsx` remove o `WhatsAppSessionPanel` embutido; painel WAHA passa a viver em `src/pages/admin/WhatsApp.tsx`.
- Novas páginas: `Usuarios.tsx`, `Engajamento.tsx`, `Financeiro.tsx`, `Operacao.tsx`, `Produto.tsx`, `Seguranca.tsx`, `Configuracoes.tsx`.
- RPCs de suporte (novas, `SECURITY DEFINER`, gated por `is_platform_admin`):
  - `admin_users_list(p_search text, p_limit int, p_offset int)` — retorna id, email, created_at, onboarding_completed_at, last_sign_in_at, whatsapp_linked bool. Sem descrições/valores.
  - `admin_engagement_stats()` — DAU/WAU/MAU, ativação, retenção coorte simples.
  - `admin_agent_stats()` — runs, sucesso, tokens, custo agregado.
  - `admin_ops_health()` — outbox pendentes, dead letters, reminder jobs, imports recentes.
  - `admin_list_platform_admins()` — owner/admin only.
- Dashboard executivo estende `admin_dashboard_stats` existente com engajamento agregado; nunca expõe valores pessoais.

## 8. Founder bootstrap

- Migration idempotente: se `auth.users` contém `daniel.assis@nocontrole.com.br`, inserir/atualizar em `platform_admins` como `platform_owner active=true` e remover `user_roles.role='user'`. Se não existir ainda, a estrutura fica pronta e `admin-bootstrap` (já existente) passa a também gravar em `platform_admins` além de `user_roles`.
- Ajustar `handle_new_user` para NÃO inserir `user_roles.role='user'` se o e-mail estiver em uma allowlist controlada por `platform_admins` (via check pós-insert), ou mais simples: `admin-bootstrap` remove a role `user` após criação.

## 9. Testes

- Unit: matriz de permissões (`can(role, action)`).
- Integration (mock supabase): guards `PlatformAdminRoute` / `ProtectedRoute` para os 4 papéis + anon.
- RLS smoke (SQL): usuário financeiro não lê `company_*`; support não escreve `platform_admins`; owner concede/revoga; analyst não altera.
- Existing 68 testes continuam passando.

## 10. Fora de escopo

- Não redesenhar `/app/*`.
- Não criar billing/MRR real (mostrar "não configurado").
- Não implementar "impersonate user".
- Sem publicação.

## Detalhes técnicos

**Arquivos novos**
- `supabase/migrations/<ts>_platform_admin_model.sql`
- `supabase/migrations/<ts>_company_finance.sql`
- `src/components/auth/PlatformAdminRoute.tsx`
- `src/components/admin/AdminLayout.tsx`, `AdminSidebar.tsx`, `AdminBottomNav.tsx`
- `src/pages/admin/{VisaoGeral,Usuarios,Engajamento,Financeiro,WhatsApp,Operacao,Produto,Seguranca,Configuracoes}.tsx`
- `src/lib/admin/permissions.ts`
- `supabase/functions/_shared/admin/guard.ts` (helper que valida role no servidor)

**Arquivos editados**
- `src/App.tsx` — novas rotas `/admin/*` como layout aninhado.
- `src/context/AuthContext.tsx` — expor `platformRole`, remover `isAdmin` legado (ou reapontar).
- `src/components/auth/ProtectedRoute.tsx` — redireciona platform admin para `/admin`.
- `src/pages/Login.tsx` — decisão de destino pós-login.
- `src/components/DesktopSidebar.tsx` — remover atalho Admin.
- `src/pages/AdminDashboard.tsx` → renomear para `pages/admin/VisaoGeral.tsx`.
- `src/pages/admin/Agente.tsx` — separar WhatsApp panel.
- Edge Functions admin-* — usar novo guard baseado em `is_platform_admin`.

**Migrations** (2 incrementais, sem alterar antigas): platform_admin_model e company_finance.

Após aprovação, executo tudo nesta rodada, rodo testes, typecheck e reporto: migrations aplicadas, rotas, matriz de permissões, resultado dos testes e status real do founder (se `auth.users` já contém o e-mail).
