## Cleanup: remover overload legado de `split_create`

### Contexto auditado
- `pg_proc` mostra 2 assinaturas de `public.split_create`:
  - Legada (9 args, sem `p_owner_amount`) — oid 18838
  - Nova (10 args, com `p_owner_amount`) — oid 18860
- Ambas têm `anon_exec=false` e `auth_exec=true`.
- Frontend (`src/pages/DivisaoDoRoleNova.tsx`) chama a assinatura nova (passa `p_owner_amount`).
- Nenhuma outra referência de código à assinatura legada.
- Auditoria de demais RPCs sensíveis (`recurring_*`, `split_*`, `import_*`, `notify_*`, `user_*`, `admin_*`, `challenge_*`, `join_challenge`): sem overloads obsoletos. Todas com `anon_exec=false`. Nenhum outro cleanup necessário.

### Migration incremental (única)
`supabase/migrations/<ts>_cleanup_split_create_legacy.sql`:
1. `REVOKE ALL ON FUNCTION public.split_create(text,numeric,date,date,split_mode,boolean,boolean,text,jsonb) FROM PUBLIC, anon, authenticated;`
2. `DROP FUNCTION public.split_create(text,numeric,date,date,split_mode,boolean,boolean,text,jsonb);`
3. Reafirmar grants na nova (idempotente):
   - `REVOKE ALL ON FUNCTION public.split_create(text,numeric,date,date,split_mode,boolean,boolean,text,jsonb,numeric) FROM PUBLIC, anon;`
   - `GRANT EXECUTE ON FUNCTION public.split_create(text,numeric,date,date,split_mode,boolean,boolean,text,jsonb,numeric) TO authenticated;`

### Validação pós-migration
- `SELECT` em `pg_proc` confirma exatamente 1 `split_create`, com `p_owner_amount`, `anon_exec=false`, `auth_exec=true`.
- `bunx vitest run` (esperado 68/68).
- `tsgo` typecheck.
- Build.
- `supabase functions` — nenhuma edição, sem impacto.

### Fora de escopo
- Nenhuma alteração de UI, tipos gerados, Edge Functions ou outras RPCs.
