
# Fase 1 — Fundação de Auth, Perfis, Papéis e Onboarding

Objetivo: substituir o protótipo local por uma base real multiusuário com Lovable Cloud (Supabase), autenticação completa, perfis, papéis e onboarding mínimo — sem tocar em dados financeiros, WAHA, agente ou admin funcional. Visual premium já criado é preservado.

---

## 1. Arquivos a criar / alterar

### Criar
- `src/integrations/supabase/client.ts` — cliente Supabase (gerado ao habilitar Cloud).
- `src/context/AuthContext.tsx` — provider com `session`, `user`, `profile`, `roles`, `loading`, e ações `signUp`, `signIn`, `signOut`, `requestPasswordReset`, `updatePassword`, `refreshProfile`.
- `src/components/auth/ProtectedRoute.tsx` — bloqueia `/app/*` sem sessão; redireciona para `/login` preservando `next`.
- `src/components/auth/AdminRoute.tsx` — exige sessão + `has_role(uid, 'admin')` validado via RPC no servidor; nunca via localStorage/flag no client.
- `src/components/auth/OnboardingGuard.tsx` — força `/onboarding` quando `profiles.onboarding_completed_at` for null.
- `src/pages/auth/ForgotPassword.tsx` — envia `resetPasswordForEmail` com `redirectTo=/reset-password`.
- `src/pages/auth/ResetPassword.tsx` — rota pública que detecta `type=recovery` e chama `updateUser({ password })`.
- `src/pages/auth/EmailConfirm.tsx` — feedback pós clique de confirmação.
- `src/pages/Onboarding.tsx` — wizard curto (3 passos) com validação zod.
- `src/lib/validation/auth.ts` — schemas zod (email, senha ≥8 c/ complexidade, nome trim ≤80).
- `src/lib/validation/onboarding.ts` — schemas zod para os campos do onboarding.
- `supabase/migrations/<ts>_auth_foundation.sql` — schema, RLS, grants, trigger, função.

### Alterar
- `src/pages/Login.tsx` — substituir placeholder por form real (email/senha + link "esqueci minha senha").
- `src/pages/Signup.tsx` — substituir placeholder por form real com `emailRedirectTo=window.location.origin/app`.
- `src/App.tsx` — envolver com `AuthProvider`, registrar rotas `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/onboarding`, `/app/*` (ProtectedRoute + OnboardingGuard), `/admin/*` (AdminRoute).
- `src/components/AppLayout.tsx` — botão sair e exibição do nome do perfil.
- `index.html` e quaisquer strings remanescentes de "Mindful Money" → "NoControle.ia".
- `package.json` — se necessário, adicionar `@supabase/supabase-js` (feito ao habilitar Cloud).

Nenhuma tabela ou tela financeira é tocada nesta fase.

---

## 2. Schema SQL / RLS conceitual

Ordem obrigatória por tabela: `CREATE TABLE` → `GRANT` → `ENABLE RLS` → `POLICIES`.

### 2.1 Enum + tabela de papéis
```text
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

-- Usuário lê apenas os próprios papéis (não pode inserir/alterar)
create policy "user_roles_select_own" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid());
```

### 2.2 Função `has_role` SECURITY DEFINER
```text
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
$$;
```

### 2.3 profiles
```text
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  onboarding_completed_at timestamptz,
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- INSERT bloqueado no client; criação só via trigger definer.
```

### 2.4 user_financial_settings
```text
create type public.income_frequency as enum ('mensal', 'quinzenal', 'semanal', 'variavel');

create table public.user_financial_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approximate_monthly_income numeric(14,2),
  income_frequency public.income_frequency,
  income_day smallint check (income_day between 1 and 31),
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.user_financial_settings to authenticated;
grant all on public.user_financial_settings to service_role;
alter table public.user_financial_settings enable row level security;

create policy "ufs_select_own" on public.user_financial_settings for select to authenticated using (user_id = auth.uid());
create policy "ufs_insert_own" on public.user_financial_settings for insert to authenticated with check (user_id = auth.uid());
create policy "ufs_update_own" on public.user_financial_settings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 2.5 Trigger de criação automática de profile + role 'user'
```text
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id, role) do nothing;

  return new;
end;$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

Nenhuma tabela financeira é criada. Admin é atribuído manualmente via SQL pelo founder (sem endpoint no client).

---

## 3. Fluxo de autenticação e onboarding

### 3.1 Signup
1. Zod valida email + senha (mín 8, letras+número).
2. `supabase.auth.signUp({ email, password, options: { emailRedirectTo: origin + '/app', data: { display_name } } })`.
3. Trigger cria `profiles` + role `user`.
4. UI mostra "Confirme seu e-mail" (não bloqueia caso confirmação esteja desativada no ambiente).

### 3.2 Login
1. `signInWithPassword`.
2. `AuthContext` carrega `profile` e `roles` (via `.select().eq('id', uid)` e `user_roles`).
3. Se `profile.onboarding_completed_at` null → redireciona para `/onboarding`.
4. Caso contrário → `/app` (ou `next` da URL).

### 3.3 Logout
`supabase.auth.signOut()` → limpa contexto → redireciona `/`.

### 3.4 Recuperação de senha
- `/forgot-password`: `resetPasswordForEmail(email, { redirectTo: origin + '/reset-password' })`.
- `/reset-password`: detecta `type=recovery` no hash, exibe form, chama `updateUser({ password })`, redireciona login.

### 3.5 Atualização de senha logado
Em `/app/perfil` (form já existente será adaptado depois — fora do escopo desta fase). Nesta fase, expor apenas botão "Alterar senha" que usa o mesmo fluxo `/reset-password` via e-mail — evita gerenciar sessão sensível agora.

### 3.6 AuthContext
- Registra `onAuthStateChange` **antes** de `getSession()`.
- Usa `getUser()` para verificação sensível de identidade (ex.: AdminRoute).
- Expõe `loading` para evitar flicker de rota protegida.

### 3.7 Onboarding (3 passos)
1. Nome de exibição.
2. Renda mensal aproximada + frequência + dia de recebimento.
3. Confirmação de timezone `America/Sao_Paulo` e moeda `BRL` (pré-preenchidos, editáveis futuramente).

Salvar em transação lógica: `upsert user_financial_settings` + `update profiles set onboarding_completed_at = now(), display_name = ...`. Skip permitido apenas para passo 2 (renda opcional; frequência default `variavel`).

### 3.8 ProtectedRoute
Enquanto `loading` → spinner. Sem sessão → `<Navigate to="/login?next=...">`. Com sessão e sem onboarding → `<Navigate to="/onboarding">`.

### 3.9 AdminRoute
Além de sessão, chama `supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' })`. Falha → 403 elegante. Nunca confia em flag do client.

---

## 4. Riscos de segurança e mitigações

| Risco | Mitigação |
|---|---|
| Escalada de privilégio via profiles | Papéis em tabela separada `user_roles` com policies read-only ao próprio usuário; nenhuma policy de INSERT/UPDATE no client. |
| RLS recursivo | `has_role` é SECURITY DEFINER com `search_path` fixo. |
| Falta de GRANT | Grants explícitos por tabela conforme padrão. |
| Signup sem profile | Trigger `handle_new_user` com `on conflict do nothing`. |
| Vazamento de dados entre usuários | Todas as policies filtram por `auth.uid()`. |
| Reset de senha auto-login sem trocar | Rota `/reset-password` obrigatória + verificação `type=recovery`. |
| Redirect após email confirm/reset | `emailRedirectTo`/`redirectTo` explícitos; allow-list configurada no dashboard. |
| Enumeração de e-mail | Mensagens de erro genéricas ("credenciais inválidas"). |
| Senhas fracas | Zod client + habilitar HIBP (`password_hibp_enabled`) no Cloud Auth. |
| Sessão expirada | `onAuthStateChange` invalida contexto; ProtectedRoute revalida. |
| Admin forjado no client | Sempre via RPC `has_role`; roles nunca vindas do localStorage. |
| Marca residual "Mindful Money" | Sweep textual em index.html, metadados, README, strings visíveis. |

---

## 5. Testes e critérios de aceite

Verificação manual (Playwright headless via shell quando útil) + build limpo.

Critérios:
1. `/` continua servindo a Landing pública sem sessão.
2. Signup cria linha em `auth.users`, `profiles` e `user_roles(role='user')`.
3. Login sem onboarding → redireciona a `/onboarding`; com onboarding → `/app`.
4. `/app/*` sem sessão → `/login?next=...`; após login, retorna à rota original.
5. `/admin/*` só acessível se `has_role(uid,'admin')=true`; usuário comum recebe 403.
6. Forgot → email enviado; `/reset-password` aceita nova senha; login funciona.
7. Logout limpa sessão e bloqueia `/app`.
8. Tentativa de `select * from profiles` de outro usuário retorna 0 linhas (RLS).
9. Tentativa de `insert into user_roles` pelo client é negada.
10. Nenhuma referência a "Mindful Money" em HTML/UI.
11. Build sem erros TS; console sem warnings de auth.
12. Onboarding grava `user_financial_settings` + `onboarding_completed_at`.

---

## 6. Ordem exata de implementação (após aprovação)

1. Habilitar Lovable Cloud (`supabase--enable`).
2. Ativar HIBP e configurar redirect URLs no Cloud Auth.
3. Migration única `auth_foundation.sql`: enum → user_roles (+grants/RLS/policies) → has_role → profiles (+grants/RLS/policies) → income_frequency enum → user_financial_settings (+grants/RLS/policies) → handle_new_user + trigger.
4. Criar `AuthContext` + `client.ts`.
5. Substituir `Login.tsx` e `Signup.tsx` reais + schemas zod.
6. Criar `ForgotPassword`, `ResetPassword`, `EmailConfirm`.
7. Criar `ProtectedRoute`, `AdminRoute`, `OnboardingGuard`.
8. Criar `Onboarding.tsx` (3 passos).
9. Alterar `App.tsx` com o novo mapa de rotas.
10. Ajustar `AppLayout` (logout + nome).
11. Sweep de rebranding remanescente.
12. Verificações: build + smoke test manual dos 12 critérios de aceite.

---

## 7. Estimativa relativa de créditos

**Médio.** Uma migration, ~10 arquivos novos, ~5 alterações pontuais, sem UI complexa nova além do wizard. O maior custo está em ProtectedRoute/AdminRoute/AuthContext bem feitos e no ciclo de verificação pós-build.

---

Pare aqui. Aguardando aprovação explícita antes de habilitar Cloud ou tocar em qualquer arquivo.
