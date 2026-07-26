# Relatório de classificação de usuários — 2026-07-27

Fonte: `auth.users × profiles × platform_admins × user_roles × sinais de uso`
(cf. auditoria consolidada em `.lovable/plan.md`, Fase 0).

Nenhum registro foi excluído automaticamente. Este documento apenas
classifica cada conta e serve de base para decisões futuras de higienização.

## Classificação

| Origem  | Categoria | Motivo / Sinal |
|---------|-----------|----------------|
| `platform_admins` (1 conta) | **Admin** | Conta operacional do painel; não é cliente do produto. Excluída de todas as métricas de "clientes reais" via `is_client_user()` e `v_client_universe`. |
| `profiles.is_test = true` (3 contas `@t.test`) | **Teste** | E-mails de teste marcados via migration `20260726120000_client_universe_excludes_test.sql`. Excluídas das métricas do Admin. `onboarding_completed_at` nulo, sem transações reais. |
| Demais (2 contas) | **Cliente real** | Onboarding concluído, transações, uso do assessor e/ou WhatsApp. Devem aparecer como os 2 clientes de fato do Meu Nino. |

## Consistência

- `auth.users` × `profiles`: sem órfãos identificados nesta rodada
  (todos os `profiles.user_id` estão em `auth.users`; toda `auth.users`
  ativa tem `profile` correspondente).
- Duplicidades: nenhuma detectada por e-mail canonicalizado.
- Roles: apenas 1 usuário com `user_roles.role = 'admin'`, coincidente
  com `platform_admins`.

## Efeito nas métricas

- Cockpit / Crescimento / Clientes agora refletem **2 clientes reais**.
- `is_client_user(uuid)` retorna `false` para o admin e para as três contas de teste.
- Views `v_client_users` / `v_client_universe` filtram consistentemente
  em toda RPC `admin_v2_*` que agrega base de clientes.

## Próximas ações recomendadas (não executadas)

1. Manter as 3 contas `@t.test` como sandbox de QA. Não excluir.
2. Se um dia forem descartadas, executar `admin_approve_deletion_request`
   por conta, jamais `DELETE` direto (para preservar auditoria).
3. Revisar este relatório sempre que uma nova conta admin ou de teste
   for criada.
