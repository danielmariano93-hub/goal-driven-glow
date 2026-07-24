# Reconciliação de migrations — Meu Nino

Registro das migrations aplicadas fora do timestamp linear do repositório.
Nenhum arquivo `supabase/migrations/*.sql` já aplicado deve ser renomeado.

## Migrations do PR #2 aplicadas em produção
- `20260723234500_canonical_financial_foundation.sql` — Fundação financeira canônica
- `20260723235000_split_delivery_diagnostics.sql` — Diagnóstico Divisão do Rolê
- `20260724023000_canonical_finance_and_split_delivery_hardening.sql` — Hardening PR #2

## Migrations Fatias B–H (rollout consolidado)
- `20260724030000_ack_semantics_backfill_phase_security.sql` — ACK semântico + backfill phase + segurança

Timestamps monotônicos crescentes a partir de `20260724030000` para os próximos incrementos.
Se houver drift entre `supabase_migrations.schema_migrations` e a árvore, registrar aqui.
