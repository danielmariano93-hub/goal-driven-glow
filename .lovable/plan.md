# Plano — Correção do Admin Meu Nino.IA (universo de clientes, filtros temporais, evolução diária e homologação)

Nenhuma alteração foi realizada nesta etapa. Este documento é apenas o plano.

## 1. Diagnóstico da causa dos "3 usuários"

Confirmado por leitura em produção:

- `auth.users` = 3
- `public.profiles` = 3
- `public.user_pseudonyms` = 3
- `public.platform_admins` (active) = 1
- `public.user_roles` com role `admin` = 1

Ou seja: existem **2 clientes reais + 1 administrador da plataforma**. Todas as RPCs `admin_v2_*` atuais (Cockpit, Clientes, Crescimento, Inteligência de Produto) partem de `auth.users` / `profiles` / `user_pseudonyms` sem excluir o conjunto `platform_admins`. Por isso o painel reporta 3.

O `product_events` é pseudonimizado por `user_pseudonyms`; como o admin também tem pseudônimo, qualquer contagem via pseudo_id sem filtro também o inclui.

Não há campo estável em `profiles` ou `auth.users` que identifique admin — a única fonte segura é `public.platform_admins` (chave `user_id`, com `active=true`) cruzada com `user_pseudonyms.user_id`.

## 2. Universo canônico de usuários

Regra única, aplicada em todo o Admin:

```
CLIENTE  ⇔ auth.users.id ∉ (SELECT user_id FROM platform_admins WHERE active)
         AND auth.users.id ∉ (SELECT user_id FROM user_roles WHERE role IN ('admin'))  -- defesa em profundidade
```

Materializada como:

- `public.v_client_users` (view SECURITY INVOKER) — `user_id`, `pseudo_id`, `registered_at`, `onboarding_completed_at`.
- `public.v_client_pseudonyms` (view) — só pseudo_ids de clientes.
- Função imutável `public.is_client_user(uuid) returns boolean` (STABLE, `SET search_path=public`) — usada em RPCs e testes.

Admin continua aparecendo em: `platform_admins`, `platform_admin_audit`, `admin_reauth_events`, `break_glass_sessions`, `admin_grants_audit`. Nunca em métricas de produto.

### Estratégia anti-regressão

- Lint SQL: teste que faz `EXPLAIN`/parse de todas as RPCs `admin_v2_*` e falha se qualquer uma referencia `auth.users`, `profiles`, `user_pseudonyms` ou `product_events` sem `JOIN v_client_users` (ou `WHERE ... is_client_user`).
- Teste de integração: insere 1 admin + N clientes em fixture e valida que toda RPC exposta retorna N (nunca N+1).
- Docstring canônica em cada RPC apontando para `v_client_users`.

## 3. Correção dos números atuais (fórmulas)

Todas as métricas de produto passam por `v_client_users`:

| Métrica | Fórmula canônica (TZ America/Sao_Paulo) | Tipo |
|---|---|---|
| Usuários totais | `count(*) v_client_users` | estoque |
| Cadastros no período | `count(*) v_client_users WHERE registered_at AT TIME ZONE 'America/Sao_Paulo' BETWEEN [from, to]` | fluxo |
| Ativados no período | primeiro `product_events.event_name IN (allow_significant)` do pseudo_id dentro do período | fluxo |
| Ativos no período | `count(DISTINCT pseudo_id)` em `product_events` (client-only) no período | fluxo |
| Dormant atuais | clientes cujo `last_event_at < now() - 14 dias` **e** `registered_at < now() - 14 dias` | estoque |
| Com dados financeiros | clientes com pelo menos 1 linha em `transactions` (client-only) | estoque |
| WVU 7d | `count(DISTINCT pseudo_id)` em `product_events` (client-only, últimos 7 dias, eventos de valor) | fluxo |

Validação cruzada obrigatória no teste SQL: `auth.users − platform_admins = profiles − platform_admins = user_pseudonyms − platform_admins = v_client_users`.

## 4. Filtros de data (contrato único)

Contrato em todas as RPCs de Cockpit, Clientes, Crescimento, Inteligência de Produto e Mensageria:

```
_from date, _to date, _tz text default 'America/Sao_Paulo'
```

- Semi-abertura: `[from 00:00 SP, to+1 00:00 SP)` para evitar duplicação entre períodos adjacentes.
- Períodos pré-definidos calculados no cliente (`src/lib/admin/periodPresets.ts`): hoje, ontem, 7d, 30d, mês atual, mês anterior, dia específico, intervalo custom.
- Compatibilidade: RPCs mantêm assinatura antiga como overload que chama a nova com defaults (últimos 30d).
- Componente compartilhado `AdminDateFilter` (baseado no shadcn Popover + Calendar com `pointer-events-auto`) publicado em `src/components/admin/AdminDateFilter.tsx`, consumido por Cockpit, Clientes, Crescimento e Inteligência de Produto.
- Cada cartão declara `metricKind: 'stock' | 'flow' | 'daily'` para o rótulo dinâmico ("atual" vs "no período" vs "por dia").

## 5. Evolução dia a dia

Nova RPC `admin_v2_daily_evolution(_from, _to)` retorna:

```json
{
  "series": [
    { "day": "2026-07-20",
      "new_clients": 0,
      "activated": 0,
      "active_unique": 0,
      "went_dormant": 0,
      "cumulative_clients": 2,
      "first_financial_action": 0 }
  ],
  "totals": { ... },
  "formula_version": "daily.evolution.v1",
  "sample_size": N,
  "sufficient_sample": bool,
  "timezone": "America/Sao_Paulo"
}
```

Componente `AdminDailyEvolutionCard` (recharts LineChart `type="monotone"`, tabela responsiva abaixo, tooltip com data localizada, estado vazio e badge "amostra insuficiente" quando `sample_size < 10`). Toggle "Comparar período anterior" só habilita quando `comparablePeriods` (helper já existente em `_shared/analytics/periods.ts`).

## 6. Cockpit e Crescimento — reorganização de cartões

Cada `KpiCard` passa a receber `definition: { formula, source, window, tz, formula_version, quality }` (exibido em tooltip "?"). Envelope já suporta `formula_version` e `data_quality`.

Cockpit rearranjado:
- Estoque: **Clientes totais**, **Dormant atuais**, **Com dados financeiros**.
- Fluxo (respeita filtro): **Novos clientes**, **Ativados**, **Ativos únicos**, **WVU**.
- Operacional: **Custo assessor no período**, **Falha mensageria no período**.

Novo bloco: **Evolução diária** (item 5) + banda de integridade (`auth == profiles == pseudonyms == clients + admins`).

## 7. Escopo de migrations, RPCs, componentes

| Objeto/arquivo | Problema | Mudança planejada | Risco | Teste | Deploy? |
|---|---|---|---|---|---|
| `supabase/migrations/20260726000000_client_universe.sql` (novo, aditivo) | admin contado como cliente | cria `v_client_users`, `v_client_pseudonyms`, `is_client_user()`; GRANTs para `authenticated`/`service_role` | baixo (só leitura) | SQL: contagem = 2 | migration |
| `20260726000500_admin_rpc_client_scoped.sql` (novo, aditivo) | RPCs contam admins | reescreve `admin_v2_cockpit`, `admin_v2_clients_list` (`clients.live.v6`), `admin_v2_growth_summary`, `admin_v2_growth_funnel`, `admin_v2_growth_cohorts`, `admin_v2_product_features`, `admin_v2_product_opportunities` usando `v_client_users`; adiciona params `_from/_to/_tz` opcionais com defaults compatíveis | médio (assinaturas) | fixture 1 admin + 2 clientes → todas RPCs retornam 2 | migration |
| `20260726001000_admin_daily_evolution.sql` (novo) | falta série diária | cria `admin_v2_daily_evolution(_from,_to,_tz)` | baixo | 30 dias fechados batem com totais | migration |
| `src/components/admin/AdminDateFilter.tsx` (novo) | sem filtro de data | Popover shadcn + presets + range custom | baixo | RTL: presets aplicam ranges corretos em SP | frontend |
| `src/lib/admin/periodPresets.ts` (novo) | — | helpers SP | baixo | unit | frontend |
| `src/components/admin/AdminDailyEvolutionCard.tsx` (novo) | — | line chart + tabela | baixo | RTL: renderiza empty state e amostra insuficiente | frontend |
| `src/pages/admin/Cockpit.tsx` | mistura estoque/fluxo | consome novo contrato, cartões agrupados por tipo, integra filtro + evolução | baixo | contract test | frontend |
| `src/pages/admin/Clientes.tsx` | admin listado | consome `clients.live.v6`; filtros lifecycle/financeiro/data; paginação | baixo | RTL | frontend |
| `src/pages/admin/Crescimento.tsx`, `InteligenciaProduto.tsx`, `operacao/Mensageria.tsx` | idem | plugam `AdminDateFilter` e novo contrato | baixo | RTL | frontend |
| `src/integrations/supabase/types.ts` | — | regenerar após migrations | — | build | auto |
| Edge Functions | — | **nenhuma** redeploy necessária: correções vivem no banco + frontend; nenhuma função importa `admin_v2_*` | — | — | não |

Migrations são aditivas e idempotentes (`CREATE OR REPLACE`, `CREATE VIEW IF NOT EXISTS` via `DROP VIEW IF EXISTS` + `CREATE`, `CREATE FUNCTION ... OR REPLACE`). Nenhuma migration histórica é alterada.

## 8. Testes obrigatórios

Unit / RTL (`src/test/`):
- `admin-client-universe.test.ts` — mock de RPC valida que 1 admin + 2 clientes ⇒ todos os cartões mostram 2.
- `admin-date-filter.test.tsx` — presets calculam `[from, to]` em SP corretamente, incluindo virada de dia e mês.
- `admin-daily-evolution.test.tsx` — série vazia, série parcial (amostra insuficiente), tooltip.
- `admin-metric-kind-labels.test.tsx` — cartões de estoque não mostram sufixo "no período".

SQL (via script de integração em `supabase/tests/`):
- `client_universe.sql` — `v_client_users` = `auth.users − platform_admins`.
- `daily_evolution_closure.sql` — soma da série diária = total do período para cada métrica de fluxo.
- `adjacent_periods_no_overlap.sql` — evento em 00:00 SP cai em um único período.
- `registration_is_not_activity.sql` — cliente recém-cadastrado sem eventos aparece como `new`, nunca `active`.

Fixtures em `supabase/tests/fixtures/admin_universe.sql`: 1 admin + cliente_new + cliente_activated + cliente_active_multi_day + cliente_dormant + evento na virada 23:59:59-03 / 00:00:00-03.

## 9. Homologação (executar após publicação futura)

- Cockpit: **Clientes totais = 2**, alerta de integridade limpo, `formula_version` visível.
- Clientes: 2 linhas, admin ausente, lifecycle correto.
- Cadastro novo aparece como `new`.
- App e WhatsApp: "Qual dia da semana eu mais gasto?" → padrão semanal `weekday.robust.v2`.
- Sequência "Quanto gastei na sexta?" → "Eu digo na média" preserva contexto.
- "Quanto gastei na sexta-feira?" isolado responde valor pontual, não padrão.
- Gráfico App/WhatsApp com PNG real ou fallback textual honesto.
- `agent_settings.proactive_enabled = false` em todos os clientes.
- Diff de contagens em `transactions`, `profiles`, `product_events` = 0 antes/depois.

## 10. Critérios de aceite

- [ ] Painel mostra 2 clientes.
- [ ] Admin ausente de todas as RPCs `admin_v2_*` de produto.
- [ ] Filtro de dia específico e intervalo custom funcionam em SP.
- [ ] Série diária fecha com total do período (assert automatizado).
- [ ] `clients.live.v6` documentado; frontend compatível.
- [ ] Testes do padrão semanal passam em App e WhatsApp.
- [ ] Zero perda de dados; zero PII exposta.
- [ ] SHA publicado registrado.

## 11. Riscos e rollback

- **Risco:** RPC v6 quebra tela existente. **Mitigação:** manter overload antigo por 1 release; feature flag `admin.date_filter.enabled` no frontend.
- **Risco:** view mascarar admin legítimo em auditoria. **Mitigação:** views são exclusivas de métricas; auditoria continua em `platform_admins`.
- **Rollback:** `DROP VIEW`/`DROP FUNCTION` das novas + revert do frontend; migrations antigas permanecem intactas.

## 12. Sequência de execução (futura, não agora)

1. Snapshot: `SELECT count(*) FROM auth.users, platform_admins, profiles, product_events`.
2. Branch `fix/admin-client-universe`.
3. Implementar migrations + frontend + testes.
4. `vitest run` + build verdes.
5. Revisão de diff.
6. Merge na `main`.
7. Aplicar migrations em ordem (client_universe → rpc_client_scoped → daily_evolution).
8. Regenerar types Supabase.
9. Publicar frontend.
10. Homologação SQL + UI + App + WhatsApp.
11. Relatório final com SHA e prints.

## 13. Estimativa de créditos

- Migrations + RPCs: baixo (SQL puro, ~1 rodada).
- Frontend (filtro + evolução + refactor Cockpit/Clientes/Crescimento/IA/Mensageria): médio (2–3 rodadas).
- Testes: baixo-médio.
- Deploy edge functions: **zero** (nenhuma afetada).
- Homologação: baixo (leituras + prints).

## 14. Classificação final

**READY_TO_IMPLEMENT** — diagnóstico confirmado em produção, escopo fechado, sem dependências externas, sem necessidade de redeploy de Edge Functions.

Confirmo que nenhuma alteração foi realizada nesta etapa.
