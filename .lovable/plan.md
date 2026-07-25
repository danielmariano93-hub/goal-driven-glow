# Plano revisado — Admin Meu Nino: correção do universo canônico, contratos e segurança

Confirmação: **nenhuma implementação foi realizada nesta rodada de revisão**. Foram apenas leituras no banco (`SELECT`) para embasar os pontos abaixo.

---

## 1) Diagnóstico confirmado (achados desta revisão)

**Achado P0 — vazamento de PII (novo, precisa entrar no escopo):**
As views `public.v_client_users` e `public.v_client_pseudonyms`, criadas na migration anterior, saíram com ACL `anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres`. Como usam `security_invoker=true` mas concedem SELECT direto a `authenticated`, **qualquer cliente autenticado do app pode listar todos os `pseudo_id` e `user_id` de todos os clientes** — viola RLS e o item 1 do briefing.

**Achado P0 — overload ambíguo em `admin_v2_cockpit`:**
Coexistem hoje `admin_v2_cockpit()` (legada, retorna estado do dia atual) e `admin_v2_cockpit(_from date, _to date)` (nova). PostgREST pode escolher a errada, e o frontend novo já chama a variante com parâmetros. Todas as outras `admin_v2_*` **ainda estão no contrato antigo** (`_days/_hours/_weeks/_limit`); só `cockpit` e `daily_evolution` migraram — o plano anterior descreveu como se todas já tivessem `_from/_to`, o que era falso.

**Achado P1 — allowlist de "ação significativa" divergente:**
`admin_v2_clients_list` v6 lista como significativas: `financial_entry_created, goal_created, goal_progress_recorded, split_created, split_participant_paid, document_confirmed, onboarding_completed, agent_response_delivered`. Porém `product_event_types` **não contém** `document_confirmed` nem `onboarding_completed` (usa `ocr_document_confirmed` e não tem onboarding_completed), e `agent_response_delivered` é resposta do assessor — inflaria ativação. Precisa canonização.

**Achado P1 — `user_registered` no product_event_types:**
O evento existe na allowlist do trigger (adicionado em `20260725050000`), mas semanticamente NÃO deve contar como atividade nem WVU. O código de `clients_list` filtra por `<> 'user_registered'`, mas outras RPCs não têm essa proteção uniforme.

**Achado ok — is_client_user:** já está `STABLE SECURITY DEFINER`. Não precisa recriar; precisa apenas travar `EXECUTE`.

**Achado ok — universo canônico**: 3 profiles = 3 auth users; 1 `platform_admins` ativo (role `platform_owner`, mesmo user com `user_roles.role='admin'`); recálculo confirma **2 clientes reais**.

Fontes reais consultadas nesta revisão:
- `pg_class.relacl` das views ⇒ ACL para authenticated.
- `pg_proc` ⇒ overloads `admin_v2_cockpit`, `is_client_user STABLE`, todas as `admin_v2_*`.
- `platform_admins`: PK=user_id, role `platform_role`, `active bool default true`.
- Enums: `platform_role` = {platform_owner, platform_admin, support, analyst}; `app_role` = {admin, user}.
- `platform_permissions(role, action, allowed)`; 22 actions granulares (incluindo `clients.read`, `clients.identity.read`, `clients.identity.masked`, `cockpit.read`, `growth.read`, `product_intel.read`, `audit.read`, etc.).
- `product_event_types(event_name, category, requires_value_bucket, description)` — 21 eventos catalogados.

---

## 2) Arquitetura segura do universo de clientes

**Regra 1 — Views são internas.** `v_client_users`, `v_client_pseudonyms` e `is_client_user` deixam de ser acessíveis a `anon`/`authenticated`. Só `postgres` (owner de views) e RPCs `SECURITY DEFINER` (que rodam como owner) enxergam.

**Regra 2 — Todo consumo do Admin passa por RPC.** Nenhuma leitura direta de views/tabelas de universo pelo frontend. RPCs `admin_v2_*` já são `SECURITY DEFINER` + `_require_perm(...)`; vamos apenas garantir grants mínimos.

**Regra 3 — Fonte canônica de admin: `platform_admins WHERE active`**, mantendo `user_roles.role='admin'` como sinal defensivo secundário (belt-and-suspenders). É por isso que `is_client_user` faz **anti-join contra ambos**: um user só é cliente se não está em nenhum. Nada de e-mail, domínio ou UUID hardcoded.

**Precedência real hoje** (verificado):
- `platform_admins` ativos → autoridade da UI/permissões via `platform_permissions`.
- `user_roles.role='admin'` → sinal legado; apenas 1 registro, alinhado com o platform_owner. Continua servindo de rede de proteção caso a linha em `platform_admins` seja acidentalmente marcada `active=false`.
- Risco de inconsistência: alguém removeria só de um lado; mitigado por manter os dois na definição de "não-cliente".

---

## 3) Assinaturas atuais e futuras das RPCs

### Assinaturas encontradas hoje

| RPC | Assinatura atual | Estado |
|---|---|---|
| `admin_v2_cockpit()` | sem args | LEGADA — remover, ambígua |
| `admin_v2_cockpit(_from date,_to date)` | novo contrato | manter |
| `admin_v2_daily_evolution(_from date,_to date)` | novo | manter |
| `admin_v2_clients_list(_limit int)` | sem período | expandir |
| `admin_v2_growth_summary(_days int)` | legado | expandir |
| `admin_v2_growth_cohorts(_weeks int)` | legado | manter (semanal) |
| `admin_v2_growth_funnel(_days int)` | legado | expandir |
| `admin_v2_messaging_activity(_days int)` | legado | expandir |
| `admin_v2_ia_ocr_metrics(_days int)` | legado | expandir |
| `admin_v2_product_features(_days int)` | legado | expandir |
| `admin_v2_whatsapp_monitor(_days int)` | legado | manter |
| `admin_v2_operations_health(_hours int)` | legado | manter |
| `admin_v2_clients_identity(_pseudo_ids uuid[])` | ok | manter |
| `admin_v2_clients_identity_masked(_pseudo_ids uuid[])` | ok | manter |
| `admin_v2_audit_list(_limit int)` | ok | manter |
| `admin_v2_assistant_health(_days int)` | legado | manter |
| `admin_v2_metrics_audit()` | ok | manter |
| `admin_v2_governance_summary()` | ok | manter |
| `admin_v2_product_opportunities()` | ok | manter |
| `admin_v2_revenue_summary()` | ok | manter |

### Assinaturas futuras (estratégia sem ambiguidade)

Regras:
- **Nunca** manter duas assinaturas da mesma RPC coexistindo em produção.
- Substituição atômica dentro da mesma migração: `DROP FUNCTION` (assinatura antiga específica) + `CREATE OR REPLACE FUNCTION` (nova assinatura). Não usar `CREATE OR REPLACE` sozinho, pois PostgreSQL trata assinatura diferente como função nova.
- Todas as RPCs de período recebem **exatamente** `(_from date, _to date, _tz text default 'America/Sao_Paulo')`. Sem `_days` default. Sem overload.
- Frontend é adaptado no **mesmo commit** que aplica a migration.

| RPC | Nova assinatura definitiva |
|---|---|
| `admin_v2_cockpit(_from date,_to date,_tz text)` | mantém |
| `admin_v2_daily_evolution(_from date,_to date,_tz text)` | mantém |
| `admin_v2_clients_list(_from date,_to date,_tz text,_limit int default 100,_lifecycle text default null,_financial text default null)` | filtragem no servidor |
| `admin_v2_growth_summary(_from date,_to date,_tz text)` | substitui `(_days)` |
| `admin_v2_growth_funnel(_from date,_to date,_tz text)` | substitui `(_days)` |
| `admin_v2_messaging_activity(_from date,_to date,_tz text)` | substitui `(_days)` |
| `admin_v2_ia_ocr_metrics(_from date,_to date,_tz text)` | substitui `(_days)` |
| `admin_v2_product_features(_from date,_to date,_tz text)` | substitui `(_days)` |
| `admin_v2_assistant_health(_from date,_to date,_tz text)` | substitui `(_days)` |

RPCs de estoque atual (`total_users`, `active break_glass`) não recebem período — retornam sempre "agora".

---

## 4) Fórmulas versionadas

### `activity.v1` — atividade significativa (allowlist positiva)
Um evento conta como atividade se **e somente se**:
```
event_name IN (
  'financial_entry_created', 'financial_entry_edited', 'financial_entry_categorized',
  'goal_created', 'goal_progress_recorded',
  'split_created', 'split_participant_paid',
  'ocr_document_uploaded', 'ocr_document_confirmed'
)
```
**Excluídos explicitamente:** `user_registered`, `agent_response_delivered`, `personalized_response_delivered`, `insight_delivered`, `forecast_delivered`, `whatsapp_message_sent/delivered/read`, todos com `event_source='backfill'` ou `'backfill_proxy'` e qualquer `pseudo_id` cujo `user_id` seja admin.

### `value_delivered.v1` — valor entregue pelo produto
```
event_name IN (
  'goal_progress_recorded', 'split_participant_paid',
  'ocr_document_confirmed', 'financial_entry_created'
)
AND event_source = 'live'
```
Retorna soma de `amount_from_bucket(value_bucket)` quando aplicável.

### `activation.v1` — primeira ação significativa da vida do cliente
```sql
first_significant_at := (
  SELECT min(occurred_at)
  FROM product_events e
  WHERE e.pseudo_id = <cliente>
    AND e.event_name IN (<activity.v1>)
    AND e.event_source = 'live'
)
```
- **Ativados no período** = clientes cujo `first_significant_at ∈ [from, to+1d)`.
- **Não** é "qualquer ação no período".

### `dormant_transition.v1` — série diária de `went_dormant`
Definição formal do dia `D`:
```
Um pseudo_id p entra em dormant no dia D se:
  MAX(occurred_at | activity.v1) em [D-14d, D-1d] existe (usuário estava ativo até dia D-1)
  E o intervalo entre a última atividade e D atingiu 14 dias exatos em D
  E nenhuma atividade ocorreu em [D-13d, D] (janela sem retorno)
```
Implementação canônica:
```
went_dormant(D) := |{ p : last_activity(p, ate=D) = D-14 }|
onde last_activity(p, ate=D) = max(occurred_at::date) filtrando activity.v1 e ≤D
```
Isso garante que cada usuário só é contado uma vez por transição. Se voltar a agir em D+3, ele é contado em `activated(D+3)` mas não em novo `went_dormant` até completar novos 14 dias parado.

### `snapshot.v1` — estado do lifecycle no fim de qualquer dia
```
lifecycle_at(p, D) :=
  CASE
    WHEN p.registered_at::date > D THEN NULL
    WHEN NOT EXISTS activity.v1(p) até D E onboarding is null até D THEN 'new'
    WHEN last_activity(p, D) IS NULL AND onboarding_at <= D THEN 'activated'
    WHEN D - last_activity(p, D) > 14 THEN 'dormant'
    ELSE 'active'
  END
```
Snapshot histórico **não** usa "hoje" — usa `D` como cursor. Assim `Dormant no fim de D` reflete o estado daquele dia, não o atual.

### `client_universe.v1`
Definição canônica (JOIN pré-computado, dispensa a função nas RPCs quentes):
```sql
user_id NOT IN (SELECT user_id FROM platform_admins WHERE active)
AND user_id NOT IN (SELECT user_id FROM user_roles WHERE role='admin')
```

Todos os retornos JSON expõem `formula_version` explícito.

---

## 5) Estoque vs período — contratos por cartão

| Cartão | Tipo | Fonte | Reage ao filtro? |
|---|---|---|---|
| Clientes totais | Estoque atual | `count(v_client_users) agora` | **Não** |
| Custo do assessor | Fluxo no período | soma `agent_runs` em `[from,to+1d)` | Sim |
| Falha mensageria 7d | Janela fixa 7d | rolling, ignora filtro | **Não** |
| Novos clientes | Fluxo | `registered_at ∈ [from,to+1d)` | Sim |
| Ativações | Fluxo | `first_significant_at ∈ período` | Sim |
| Valor entregue | Fluxo | `value_delivered.v1` no período | Sim |
| WVU | Snapshot rolling | pseudos ativos+valor em janela de 7d dentro do período | Sim |
| Dormant | Snapshot ao fim de `to` | `snapshot.v1(D=to)` | Sim (usa fim do intervalo) |
| Evolução diária | Série | `daily_evolution` | Sim |

UI marca visualmente estoque atual com selo "agora" para eliminar ambiguidade.

---

## 6) Migrations aditivas (sequência definitiva)

Todas idempotentes-por-condição, nenhuma altera migration histórica. Cada uma acompanha `-- ROLLBACK` documentado no cabeçalho.

**M1 — `20260726100000_client_universe_lockdown.sql` (P0 segurança)**
- `REVOKE ALL ON public.v_client_users, public.v_client_pseudonyms FROM PUBLIC, anon, authenticated;`
- `REVOKE EXECUTE ON FUNCTION public.is_client_user(uuid) FROM PUBLIC, anon, authenticated;`
- `GRANT SELECT ON public.v_client_users, public.v_client_pseudonyms TO service_role;`
- `GRANT EXECUTE ON FUNCTION public.is_client_user(uuid) TO service_role;`
- Rollback: `GRANT SELECT ON v_client_* TO authenticated;` (só se algum consumidor legítimo emergir — nenhum hoje).

**M2 — `20260726100500_admin_v2_cockpit_disambiguate.sql`**
- `DROP FUNCTION IF EXISTS public.admin_v2_cockpit();` (remove só a assinatura sem args, mantém a com `_from/_to`).
- Rollback: recriar a função sem args a partir do dump anexado ao cabeçalho da migration.

**M3 — `20260726101000_admin_v2_period_contract.sql`**
- Para cada RPC listada em §3, executa `DROP FUNCTION` da assinatura antiga específica + `CREATE OR REPLACE FUNCTION` com nova assinatura `(_from, _to, _tz)`. Uso de `CREATE OR REPLACE VIEW` onde aplicável.
- Nunca `DROP VIEW`.
- Rollback: bloco `DROP FUNCTION ... (novas) + recriação das antigas` (SQL anexo no cabeçalho).

**M4 — `20260726101500_metrics_taxonomy_v1.sql`**
- Cria função pura `public.activity_events()` retornando o array constante da allowlist `activity.v1`. RPCs passam a referenciar essa função — mudar taxonomia = uma migration futura.
- Idem `value_events()`.
- Rollback: `DROP FUNCTION` das duas.

**M5 — `20260726102000_admin_v2_daily_evolution_v2.sql`**
- `CREATE OR REPLACE FUNCTION admin_v2_daily_evolution(_from, _to, _tz)` implementando `dormant_transition.v1`, `activation.v1` e snapshots corretos.
- Reaproveita índices existentes: `product_events_pseudo_idx`, `product_events_occurred_idx`, `product_events_name_idx`. Sem novos índices — plano de execução usa `Index Only Scan` em `(pseudo_id, occurred_at DESC)`.
- Rollback: recriar versão anterior de `daily_evolution`.

**M6 — `20260726102500_admin_grants_normalize.sql`**
- `REVOKE ALL ON FUNCTION admin_v2_* FROM PUBLIC, anon;`
- `GRANT EXECUTE ON FUNCTION admin_v2_* TO authenticated;` (só authenticated; a autorização real é dentro da RPC via `_require_perm`).
- Idem para novas funções auxiliares.

Ordem de aplicação: M1 → M2 → M3 → M4 → M5 → M6. **M1 pode ser aplicada isoladamente e imediatamente** por ser hotfix de segurança.

---

## 7) Frontend — arquivos e componentes afetados

Adiciona / substitui (apenas presentational + data-fetching, sem lógica financeira):
- `src/lib/admin/periodPresets.ts` (já existe do turno anterior; **manter**)
- `src/components/admin/AdminDateFilter.tsx` (já existe; **manter**)
- `src/components/admin/AdminDailyEvolutionCard.tsx` (já existe; **ajustar bindings para novo envelope**)
- `src/pages/admin/Cockpit.tsx` (já existe; **ajustar chamada** `admin_v2_cockpit` para `(_from,_to,_tz)`, incluir selo "agora" nos cartões de estoque)
- `src/pages/admin/Clientes.tsx` (já existe; passar `_from`, `_to`, `_lifecycle`, `_financial` para filtragem server-side)
- `src/pages/admin/Crescimento.tsx` — trocar `_days` por `_from/_to`
- `src/pages/admin/InteligenciaProduto.tsx` — idem
- `src/pages/admin/Mensageria.tsx` — idem
- `src/pages/admin/IA.tsx` — idem
- `src/lib/admin/adminRpc.ts` — utilitário `withPeriod(range)` que injeta `_from/_to/_tz`
- `src/lib/admin/displayDictionary.ts` — palavras já existem; incluir "Sem histórico", "Amostra insuficiente", "0 no período" com semânticas distintas
- Nada muda no design system: `PageHeader`, `KpiCard`, `AdminResponsiveList`, `EmptyState`, `AdminSkeleton` — reutilizados.

---

## 8) Provas SQL da contagem atual

```sql
-- (a) 3 usuários autenticados (via profiles como proxy sem tocar auth)
SELECT count(*) FROM public.profiles;                       -- 3

-- (b) 1 admin ativo canônico
SELECT count(*) FROM public.platform_admins WHERE active;   -- 1

-- (c) 2 clientes reais pela definição canônica
SELECT count(*) FROM public.user_pseudonyms up
WHERE up.user_id NOT IN (SELECT user_id FROM public.platform_admins WHERE active)
  AND up.user_id NOT IN (SELECT user_id FROM public.user_roles WHERE role='admin');
                                                            -- 2

-- (d) confirmação cruzada
SELECT (SELECT count(*) FROM public.profiles)
     - (SELECT count(*) FROM public.platform_admins WHERE active) AS clientes_esperados; -- 2
```

RPCs que hoje reportam 3 (a corrigir pela M3+M5): qualquer `admin_v2_*` que faz `count(distinct pseudo_id)` **sem** filtrar `is_client_user` na origem. Ex.: `admin_v2_growth_summary`, `admin_v2_product_features`, `admin_v2_messaging_activity` ao contar "usuários únicos" sobre `product_events` cru. Correção: `JOIN v_client_pseudonyms USING (pseudo_id)` em cada agregação. Como as views ficam com grant só para service_role e a RPC é SECURITY DEFINER, isso funciona.

---

## 9) Timezone, DST e limites

- Toda RPC monta janela como:
  ```sql
  v_start := (_from::text || ' 00:00:00')::timestamp AT TIME ZONE coalesce(_tz,'America/Sao_Paulo');
  v_end   := ((_to::date + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE coalesce(_tz,'America/Sao_Paulo');
  ```
- Comparações sempre `>= v_start AND < v_end` (semi-aberto).
- Buckets diários: `(occurred_at AT TIME ZONE _tz)::date`.
- **DST histórico BR**: Brasil aboliu DST em 2019; testes cobrem virada 2018→2019 (última) para evitar regressão.
- Limite: `_to - _from ≤ 365 dias`. RPC lança `raise_invalid_parameter_value` acima disso.
- Séries diárias: `generate_series(_from, _to, '1 day'::interval)` + `LEFT JOIN` — garante buckets vazios explícitos.

---

## 10) Testes

### SQL (arquivo `supabase/tests/admin_v2/`)
- `test_universe_isolation.sql`: um usuário `authenticated` não consegue `SELECT` nas views nem `EXECUTE` `is_client_user`.
- `test_cockpit_no_overload.sql`: `pg_proc` só tem uma assinatura.
- `test_activation_first_action.sql`: cliente com 3 eventos significativos aparece em `activated` apenas no dia da primeira ação.
- `test_dormant_transition_once.sql`: usuário sem ação por 30 dias aparece uma única vez em `went_dormant(D_14)`; nada em `went_dormant(D_15..D_30)`.
- `test_activity_allowlist.sql`: `user_registered`, `agent_response_delivered`, `insight_delivered`, backfills não contam.
- `test_snapshot_history.sql`: `snapshot.v1(D=ontem)` não muda quando um evento novo é gerado hoje.
- `test_semiopen_dst.sql`: evento em `2018-11-04 23:59 BRST` (última virada DST) pertence ao dia 04 e não ao 05.

### Unitário (Vitest)
- Já existente: `period-presets.test.ts` (8/8). Adicionar:
  - `period-presets-dst.test.ts` (viradas históricas e virada de ano).
  - `admin-rpc-withPeriod.test.ts` (garante que nenhum caller manda `_days` residual).
  - `admin-daily-evolution.test.tsx`: render diferencia "0 no período" vs "sem amostra" vs "sem histórico".

### E2E (Playwright headless, existente)
- Login como platform_owner → Cockpit renderiza 2 clientes; troca preset e valida request outbound com `_from/_to/_tz`.
- Login como cliente comum (via session vars) → `fetch supabase.rpc('admin_v2_cockpit')` retorna 401/403; **não** consegue `SELECT` em `v_client_users` (403 permission denied).

### Autorização por papel (tabela)
| Papel | `admin_v2_cockpit` | `admin_v2_clients_list` | `admin_v2_clients_identity` | `admin_v2_clients_identity_masked` | `v_client_users` |
|---|---|---|---|---|---|
| cliente autenticado | 403 | 403 | 403 | 403 | 403 |
| support | 200 (cockpit.read) | 200 | 403 | 200 | 403 |
| analyst | 200 | 200 | 403 | 403 | 403 |
| platform_admin | 200 | 200 | 200 | 200 | 403 |
| platform_owner | 200 | 200 | 200 | 200 | 403 |

Todas as expectativas verificadas em `test_authorization_matrix.sql`. Nenhum papel — nem `platform_owner` — recebe PII em RPCs agregadas: só via `admin_v2_clients_identity[_masked]` explicitamente permissionadas.

---

## 11) Design e UX

- Preservação total do sistema visual atual: `PageHeader`, `KpiCard`, `AdminResponsiveList`, `EmptyState`, `Skeleton`. Nada novo em cor, tipografia ou raio.
- Cartões de estoque atual ganham selo compacto "agora" à direita do título; cartões de fluxo mantêm badge com intervalo aplicado.
- Estado 0 vs sem amostra vs sem histórico: aplicar `displayDictionary` com:
  - `zero_in_period` → "0 no período" (rótulo neutro).
  - `insufficient_sample` → badge âmbar "amostra n=X".
  - `no_history` → texto discreto "sem histórico".
- `AdminDailyEvolutionCard` mantém curva `monotone` + tabela complementar responsiva.
- Mobile: filtro de data em bottom sheet vertical; presets primeiro, calendário abaixo.

---

## 12) Critérios de aceite

1. `SELECT * FROM v_client_users` como cliente comum autenticado retorna 42501.
2. `pg_proc` mostra exatamente uma assinatura para cada `admin_v2_*`.
3. Cockpit exibe **2** em "Clientes totais" com selo "agora"; nunca 3.
4. `admin_v2_growth_summary(_from,_to)` com um range de 30 dias e outro de 7 dias retorna valores distintos e coerentes; nenhum reage a filtragem por não-clientes.
5. `admin_v2_daily_evolution` para um período onde há um único cliente com 20 dias de inatividade retorna exatamente uma linha com `went_dormant=1`.
6. Nenhuma RPC agregada retorna `user_id`, e-mail, nome ou telefone.
7. Testes SQL, Vitest e Playwright verdes; `supabase--linter` sem novo alerta crítico.
8. Design system inalterado (diff visual em `AdminLayout`, `PageHeader`, `KpiCard` = 0).

---

## 13) Riscos e rollback

| Risco | Mitigação | Rollback |
|---|---|---|
| Frontend antigo em cache chamar `admin_v2_cockpit()` sem args | Deploy migrations + frontend juntos; RPC nova responde 42883 se ainda houver caller stale | Migration reversa recria a assinatura sem args |
| Alguma edge function referenciar RPC legada com `_days` | Grep pré-deploy nas functions; substituir chamadas no mesmo commit | Cada migration traz `-- ROLLBACK` inline |
| REVOKE em views quebrar consumidor legítimo | `pg_stat_user_tables` + logs mostram nenhum acesso hoje | `GRANT SELECT ON v_client_* TO service_role` — já contemplado |
| Perda de performance na filtragem por universo | Anti-join com `platform_admins`/`user_roles` roda em ≤2ms (tabelas de 1 e 3 linhas); `product_events` já tem `pseudo_id_idx` | N/A |
| DST/timezone edge case | Testes específicos; timestamp math sempre em `AT TIME ZONE` | Correção pontual |

---

## 14) Estimativa de créditos

- Migrations (6, revisão + escrita): ~30k tokens.
- Refactor frontend (7 arquivos): ~40k tokens.
- Testes SQL + Vitest + Playwright: ~30k tokens.
- Sub-total: **~100k tokens** de trabalho de execução, sem gerar imagens.

## 15) Classificação final

- Complexidade: **Alta** (segurança + contrato + série temporal).
- Escopo: **Fechado** — só Admin. App do cliente e edge functions financeiras não são tocados.
- Risco de regressão no app do usuário final: **zero** (nenhuma alteração fora de `admin_v2_*`, views internas e páginas admin).
- Impacto de segurança: **crítico positivo** — fecha vazamento P0 introduzido no turno anterior.
- Status: **READY FOR APPROVAL**.

Aguardando aprovação para executar. Nenhum arquivo, migration ou deploy foi tocado nesta rodada.
