# Segurança do Nino — regras e auditoria (02/10/2026)

## Regras que não podem regredir
1. **Funções SECURITY DEFINER do schema `public` nunca são executáveis por `anon`**, exceto `resolve_short_link`. Funções novas já nascem sem EXECUTE para `anon`/PUBLIC (default privileges). Ao criar uma função que o app chama logado, conceda `authenticated` explicitamente.
2. **Função que recebe `user_id` e é executável por `authenticated` deve validar `auth.uid()`** (`auth.uid() IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid()` → erro 42501). `auth.uid()` nulo significa serviço/cron — por isso `anon` precisa estar revogado.
3. **Segredos de cron/webhook** se comparam com `safeEqual`/`matchesAnySecret` (`_shared/security/secrets.ts`), nunca com `===`. Há teste que falha se alguém reintroduzir.
4. Edge functions com `verify_jwt = false` autenticam sozinhas (segredo de cron, assinatura do provedor ou `getUser()`).
5. Todas as tabelas do `public` têm RLS ligado. Views internas não têm SELECT para `anon`.

## Achado crítico corrigido
~121 RPCs SECURITY DEFINER executáveis por `anon`. Exploração real confirmada: leitura de gastos e dívidas de qualquer usuário (`nino_expense_sum`, `debt_obligation_state`) e escrita (`agent_learn_merchant_category`) com a chave pública. Migração `20261002120000_security_harden_rpc_exposure.sql`.
Também: `agent_sim_enqueue/reset`, `notify_upsert`, `agent_upsert_draft`, `financial_truth_changed` e outras permitiam agir sobre OUTRO usuário estando logado; agora exigem ser o próprio usuário (ou admin, no simulador).

## Pendências que dependem do painel do Supabase/Vercel
- Ativar **Leaked password protection** (Auth → Providers → Email).
- Mover a extensão `pg_net` para o schema `extensions` (requer janela de manutenção: os crons usam `net.http_post`).
- CSP completa (hoje só diretivas não quebráveis: frame-ancestors, base-uri, object-src, form-action).
- Rotacionar `CRON_SECRET`/`INTERNAL_CRON_SECRET` periodicamente.
