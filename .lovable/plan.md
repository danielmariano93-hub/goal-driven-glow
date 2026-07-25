# Plano — Correção do Admin Meu Nino.IA (universo de clientes, filtros temporais, evolução diária e homologação)

Reemissão do plano já aprovado, sem alterações. Nenhuma implementação nesta etapa (modo plano).

## 1. Diagnóstico da causa dos "3 usuários"

Confirmado por leitura em produção:

- `auth.users` = 3
- `public.profiles` = 3
- `public.user_pseudonyms` = 3
- `public.platform_admins` (active) = 1
- `public.user_roles` com role `admin` = 1

Existem **2 clientes reais + 1 administrador da plataforma**. As RPCs `admin_v2_*` partem de `auth.users` / `profiles` / `user_pseudonyms` sem excluir `platform_admins`. O admin também tem pseudônimo, então qualquer contagem via `pseudo_id` sem filtro o inclui. A única fonte segura para exclusão é `public.platform_admins` (`user_id`, `active=true`) cruzada com `user_pseudonyms.user_id`, com defesa em profundidade via `user_roles.role='admin'`.

## 2. Universo canônico de usuários

```
CLIENTE ⇔ auth.users.id ∉ (SELECT user_id FROM platform_admins WHERE active)
        AND auth.users.id ∉ (SELECT user_id FROM user_roles WHERE role='admin')
```

Materializado como:
- `public.v_client_users` (view) — `user_id`, `pseudo_id`, `registered_at`, `onboarding_completed_at`.
- `public.v_client_pseudonyms` (view) — apenas pseudo_ids de clientes.
- `public.is_client_user(uuid) returns boolean` (STABLE, `SET search_path=public`).

Admin permanece em `platform_admins`, `platform_admin_audit`, `admin_reauth_events`, `break_glass_sessions`, `admin_grants_audit`. Nunca em métricas de produto.

### Anti-regressão
- Teste que faz parse de todas as `admin_v2_*` e falha se referenciarem `auth.users`, `profiles`, `user_pseudonyms` ou `product_events` sem `v_client_users` / `is_client_user`.
- Fixture 1 admin + N clientes valida que toda RPC retorna N.

## 3. Fórmulas canônicas

| Métrica | Fórmula (TZ America/Sao_Paulo) | Tipo |
|---|---|---|
| Usuários totais | `count(*) v_client_users` | estoque |
| Cadastros no período | `v_client_users WHERE registered_at AT TIME ZONE 'America/Sao_Paulo' BETWEEN [from,to]` | fluxo |
| Ativados no período | primeiro evento significativo do pseudo_id no intervalo | fluxo |
| Ativos no período | `count(DISTINCT pseudo_id)` de `product_events` (client-only) | fluxo |
| Dormant atuais | `last_event_at < now()-14d` e `registered_at < now()-14d` | estoque |
| Com dados financeiros | clientes com ≥1 linha em `transactions` | estoque |
| WVU 7d | pseudo_ids únicos com eventos de valor nos últimos 7 dias | fluxo |

Validação cruzada: `auth.users − platform_admins = profiles − platform_admins = user_pseudonyms − platform_admins = v_client_users`.

## 4. Filtros de data (contrato único)

`_from date, _to date, _tz text default 'America/Sao_Paulo'` em todas as RPCs de Cockpit, Clientes, Crescimento, IA/Produto e Mensageria. Semi-aberto `[from 00:00 SP, to+1 00:00 SP)`. Presets no cliente: hoje, ontem, 7d, 30d, mês atual, mês anterior, dia específico, intervalo custom. Compatibilidade via overload com defaults de 30d.

Componente `src/components/admin/AdminDateFilter.tsx` (Popover + Calendar shadcn com `pointer-events-auto`). Cada `KpiCard` declara `metricKind: 'stock' | 'flow' | 'daily'` para rótulos dinâmicos.

## 5. Evolução dia a dia

RPC `admin_v2_daily_evolution(_from,_to,_tz)`:

```json
{ "series": [{ "day": "2026-07-20", "new_clients": 0, "activated": 0,
  "active_unique": 0, "went_dormant": 0, "cumulative_clients": 2,
  "first_financial_action": 0 }],
  "totals": {}, "formula_version": "daily.evolution.v1",
  "sample_size": N, "sufficient_sample": bool, "timezone": "America/Sao_Paulo" }
```

Componente `AdminDailyEvolutionCard` (recharts LineChart `type="monotone"` + tabela + tooltip localizado + estado vazio + badge "amostra insuficiente" quando `<10`). Comparação com período anterior habilita apenas se `comparablePeriods`.

## 6. Cockpit e Crescimento

`KpiCard` recebe `definition: { formula, source, window, tz, formula_version, quality }` (tooltip "?"). Cockpit rearranjado:
- **Estoque:** Clientes totais, Dormant atuais, Com dados financeiros.
- **Fluxo:** Novos clientes, Ativados, Ativos únicos, WVU.
- **Operacional:** Custo assessor no período, Falha mensageria no período.

Novo bloco Evolução diária + banda de integridade.

## 7. Escopo de migrations, RPCs, componentes

| Objeto/arquivo | Problema | Mudança | Risco | Teste | Deploy? |
|---|---|---|---|---|---|
| `supabase/migrations/20260726000000_client_universe.sql` | admin contado | cria views + `is_client_user()` + GRANTs | baixo | contagem = 2 | migration |
| `20260726000500_admin_rpc_client_scoped.sql` | RPCs contam admins | reescreve `admin_v2_cockpit`, `admin_v2_clients_list` (`clients.live.v6`), `admin_v2_growth_summary/funnel/cohorts`, `admin_v2_product_features/opportunities` sobre `v_client_users`; adiciona `_from/_to/_tz` | médio | fixture 1 admin + 2 clientes → 2 | migration |
| `20260726001000_admin_daily_evolution.sql` | falta série diária | cria `admin_v2_daily_evolution` | baixo | série fecha com totais | migration |
| `src/lib/admin/periodPresets.ts` | — | helpers SP | baixo | unit | frontend |
| `src/components/admin/AdminDateFilter.tsx` | sem filtro | Popover + presets + custom | baixo | RTL | frontend |
| `src/components/admin/AdminDailyEvolutionCard.tsx` | — | linha + tabela | baixo | RTL | frontend |
| `src/pages/admin/Cockpit.tsx` | mistura estoque/fluxo | reagrupa cartões, integra filtro + evolução | baixo | contract | frontend |
| `src/pages/admin/Clientes.tsx` | admin listado | `clients.live.v6`, filtros | baixo | RTL | frontend |
| `src/pages/admin/Crescimento.tsx`, `InteligenciaProduto.tsx`, `operacao/Mensageria.tsx` | idem | integram filtro + contrato | baixo | RTL | frontend |
| `src/integrations/supabase/types.ts` | — | regenerar | — | build | auto |
| Edge Functions | — | **nenhuma** — sem redeploy | — | — | não |

Migrations aditivas e idempotentes. Nenhuma migration histórica alterada.

## 8. Testes obrigatórios

- `admin-client-universe.test.ts` — 1 admin + 2 clientes ⇒ 2 em todo cartão.
- `admin-date-filter.test.tsx` — presets em SP, virada de dia/mês.
- `admin-daily-evolution.test.tsx` — vazia, parcial, tooltip.
- `admin-metric-kind-labels.test.tsx` — estoque sem "no período".
- SQL: `client_universe`, `daily_evolution_closure`, `adjacent_periods_no_overlap`, `registration_is_not_activity`.

Fixtures: admin + `cliente_new` + `cliente_activated` + `cliente_active_multi_day` + `cliente_dormant` + evento na virada 23:59:59-03 / 00:00:00-03.

## 9. Homologação (após publicação)

Cockpit com 2 clientes; Clientes listando 2; cadastro novo como `new`; padrão semanal em App/WhatsApp; sequência "sexta" → "eu digo na média"; "quanto gastei na sexta?" isolado ≠ padrão; gráfico com PNG ou fallback honesto; `proactive_enabled=false`; diff de dados = 0.

## 10. Critérios de aceite

- [ ] 2 clientes no painel.
- [ ] Admin ausente de todas as `admin_v2_*` de produto.
- [ ] Filtro de dia específico e intervalo funcionam em SP.
- [ ] Série diária fecha com totais.
- [ ] `clients.live.v6` compatível.
- [ ] Testes App/WhatsApp verdes.
- [ ] Zero perda de dados; zero PII.
- [ ] SHA publicado registrado.

## 11. Riscos e rollback

- RPC v6 quebrar tela → overload antigo por 1 release + feature flag `admin.date_filter.enabled`.
- View mascarar admin em auditoria → auditoria não usa `v_client_users`.
- Rollback: `DROP VIEW/FUNCTION` das novas + revert frontend.

## 12. Sequência de execução

1. Snapshot de contagens.
2. Branch `fix/admin-client-universe`.
3. Migrations + frontend + testes.
4. Vitest + build verdes.
5. Revisão de diff.
6. Merge `main`.
7. Aplicar migrations (client_universe → rpc_client_scoped → daily_evolution).
8. Regenerar types.
9. Publicar frontend.
10. Homologação SQL + UI + App + WhatsApp.
11. Relatório final com SHA.

## 13. Créditos

- Migrations/RPCs: baixo.
- Frontend: médio (2–3 rodadas).
- Testes: baixo-médio.
- Deploy Edge Functions: zero.
- Homologação: baixo.

## 14. Classificação final

**READY_TO_IMPLEMENT**.

Confirmo que nenhuma alteração foi realizada nesta etapa.
