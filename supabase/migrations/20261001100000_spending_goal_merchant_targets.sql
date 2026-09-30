-- Metas hierárquicas de gasto (`spending_goals.v1`).
--
-- A meta continua sendo da CATEGORIA (category_spending_goals). Submetas por
-- estabelecimento detalham como esse limite é consumido: todo valor de uma
-- submeta também compõe a meta principal — não existe despesa em dobro.
--
-- A submeta é vinculada à identidade NORMALIZADA do comerciante
-- (`merchant_truth.v2`: chave canônica do resolvedor), nunca ao texto bruto do
-- extrato. Um grupo ("Uber + 99", "streaming") é uma submeta com várias chaves.

create table if not exists public.spending_goal_merchant_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.category_spending_goals(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 80),
  merchant_keys text[] not null check (cardinality(merchant_keys) between 1 and 12),
  limit_kind text not null check (limit_kind in ('amount', 'percent_reduction', 'zero', 'track')),
  limit_amount numeric check (limit_amount is null or limit_amount >= 0),
  reduction_pct numeric check (reduction_pct is null or (reduction_pct > 0 and reduction_pct <= 100)),
  -- Referência histórica mensal congelada na criação (base da economia medida).
  baseline_amount numeric check (baseline_amount is null or baseline_amount >= 0),
  -- Limite mensal efetivo; null só para "acompanhar sem limite".
  computed_limit numeric check (computed_limit is null or computed_limit >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_via text not null default 'app' check (created_via in ('app', 'nino')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sgmt_limit_shape check (
    (limit_kind = 'track' and computed_limit is null)
    or (limit_kind = 'zero' and computed_limit = 0)
    or (limit_kind in ('amount', 'percent_reduction') and computed_limit is not null)
  )
);

create index if not exists idx_sgmt_goal on public.spending_goal_merchant_targets(goal_id) where status <> 'cancelled';
create index if not exists idx_sgmt_user on public.spending_goal_merchant_targets(user_id, status);

alter table public.spending_goal_merchant_targets enable row level security;

drop policy if exists sgmt_owner_all on public.spending_goal_merchant_targets;
create policy sgmt_owner_all on public.spending_goal_merchant_targets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- A submeta pertence ao mesmo dono da meta principal.
create or replace function public.sgmt_enforce_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.category_spending_goals g
     where g.id = new.goal_id and g.user_id = new.user_id
  ) then
    raise exception 'merchant_target_goal_owner_mismatch';
  end if;
  new.merchant_keys := array(select distinct lower(btrim(k)) from unnest(new.merchant_keys) k where btrim(k) <> '');
  if cardinality(new.merchant_keys) = 0 then raise exception 'merchant_target_keys_required'; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sgmt_enforce_owner on public.spending_goal_merchant_targets;
create trigger trg_sgmt_enforce_owner
  before insert or update on public.spending_goal_merchant_targets
  for each row execute function public.sgmt_enforce_owner();

-- Destino opcional da economia apurada (reserva, investimento, dívida).
alter table public.category_spending_goals
  add column if not exists savings_goal_id uuid references public.goals(id) on delete set null;

-- Confirmação atômica do plano criado pelo Nino: metas de categoria e
-- submetas entram juntas ou nenhuma entra.
create or replace function public.agent_execute_spending_goal_plan_confirmation_v1(
  p_confirmation_id uuid,
  p_source_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.pending_confirmations;
  p jsonb;
  g jsonb;
  t jsonb;
  v_goal_id uuid;
  v_category uuid;
  v_create jsonb;
  v_limit numeric;
  v_month_start date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_keys text[];
  v_target_id uuid;
  v_goal_ids uuid[] := '{}';
  v_target_ids uuid[] := '{}';
  v_kind text;
  v_target_limit numeric;
  r jsonb;
begin
  select * into c from public.pending_confirmations where id = p_confirmation_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if auth.uid() is not null and auth.uid() <> c.user_id then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if c.kind <> 'spending_goal_plan' then return jsonb_build_object('ok', false, 'error', 'wrong_confirmation_kind'); end if;
  if c.status = 'confirmed' and c.result_snapshot is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'result', c.result_snapshot);
  end if;
  if c.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if c.status = 'expired' or c.expires_at < now() then
    update public.pending_confirmations set status = 'expired' where id = c.id and status = 'pending';
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  p := coalesce(c.payload, '{}'::jsonb);
  if jsonb_typeof(p->'goals') <> 'array' or jsonb_array_length(p->'goals') = 0 then
    return jsonb_build_object('ok', false, 'error', 'plan_empty');
  end if;

  for g in select * from jsonb_array_elements(p->'goals') loop
    v_category := nullif(g->>'category_id', '')::uuid;
    if v_category is null then return jsonb_build_object('ok', false, 'error', 'category_required'); end if;
    if not exists (
      select 1 from public.categories k
       where k.id = v_category and (k.user_id = c.user_id or k.user_id is null)
    ) then
      return jsonb_build_object('ok', false, 'error', 'category_not_found');
    end if;

    v_goal_id := nullif(g->>'goal_id', '')::uuid;
    if v_goal_id is not null and not exists (
      select 1 from public.category_spending_goals s where s.id = v_goal_id and s.user_id = c.user_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'goal_not_found');
    end if;

    -- Reaproveita a meta ativa da categoria: nunca duas metas para o mesmo teto.
    if v_goal_id is null then
      select s.id into v_goal_id from public.category_spending_goals s
       where s.user_id = c.user_id and s.category_id = v_category and s.status = 'active'
       order by (s.period_type = 'monthly_recurring') desc, s.created_at desc
       limit 1;
    end if;

    v_create := g->'create';
    if v_goal_id is not null and v_create is not null and jsonb_typeof(v_create) = 'object'
       and coalesce((v_create->>'replace_limit')::boolean, false) then
      v_limit := nullif(v_create->>'computed_limit', '')::numeric;
      if v_limit is null or v_limit <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid_limit'); end if;
      update public.category_spending_goals
         set computed_limit = v_limit,
             mode = coalesce(nullif(v_create->>'mode', ''), mode),
             reduction_pct = nullif(v_create->>'reduction_pct', '')::numeric,
             fixed_limit = case when coalesce(nullif(v_create->>'mode', ''), mode) = 'fixed_limit' then v_limit else null end,
             updated_at = now()
       where id = v_goal_id;
    elsif v_goal_id is null then
      if v_create is null or jsonb_typeof(v_create) <> 'object' then
        return jsonb_build_object('ok', false, 'error', 'goal_definition_required');
      end if;
      v_limit := nullif(v_create->>'computed_limit', '')::numeric;
      if v_limit is null or v_limit <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid_limit'); end if;
      insert into public.category_spending_goals(
        user_id, category_id, mode, reduction_pct, fixed_limit, baseline_kind, baseline_value,
        computed_limit, frequency, start_date, end_date, status, period_type
      ) values (
        c.user_id, v_category,
        coalesce(nullif(v_create->>'mode', ''), 'fixed_limit'),
        nullif(v_create->>'reduction_pct', '')::numeric,
        case when coalesce(nullif(v_create->>'mode', ''), 'fixed_limit') = 'fixed_limit' then v_limit else null end,
        'custom',
        nullif(v_create->>'baseline_value', '')::numeric,
        v_limit, 'monthly', v_month_start, null, 'active', 'monthly_recurring'
      ) returning id into v_goal_id;
    end if;
    v_goal_ids := v_goal_ids || v_goal_id;

    if jsonb_typeof(g->'targets') = 'array' then
      for t in select * from jsonb_array_elements(g->'targets') loop
        v_kind := coalesce(nullif(t->>'limit_kind', ''), 'amount');
        v_keys := array(select distinct lower(btrim(value)) from jsonb_array_elements_text(coalesce(t->'merchant_keys', '[]'::jsonb)) where btrim(value) <> '');
        if cardinality(v_keys) = 0 then return jsonb_build_object('ok', false, 'error', 'merchant_required'); end if;
        v_target_limit := case
          when v_kind = 'track' then null
          when v_kind = 'zero' then 0
          else nullif(t->>'computed_limit', '')::numeric
        end;
        if v_kind in ('amount', 'percent_reduction') and (v_target_limit is null or v_target_limit < 0) then
          return jsonb_build_object('ok', false, 'error', 'invalid_target_limit');
        end if;

        select m.id into v_target_id from public.spending_goal_merchant_targets m
         where m.goal_id = v_goal_id and m.status <> 'cancelled' and m.merchant_keys && v_keys
         order by m.created_at desc limit 1;

        if v_target_id is null then
          insert into public.spending_goal_merchant_targets(
            user_id, goal_id, label, merchant_keys, limit_kind, limit_amount, reduction_pct,
            baseline_amount, computed_limit, created_via
          ) values (
            c.user_id, v_goal_id, left(coalesce(nullif(btrim(t->>'label'), ''), v_keys[1]), 80), v_keys, v_kind,
            case when v_kind = 'amount' then v_target_limit else null end,
            nullif(t->>'reduction_pct', '')::numeric,
            nullif(t->>'baseline_amount', '')::numeric,
            v_target_limit, 'nino'
          ) returning id into v_target_id;
        else
          update public.spending_goal_merchant_targets
             set label = left(coalesce(nullif(btrim(t->>'label'), ''), label), 80),
                 merchant_keys = array(select distinct unnest(merchant_keys || v_keys)),
                 limit_kind = v_kind,
                 limit_amount = case when v_kind = 'amount' then v_target_limit else null end,
                 reduction_pct = nullif(t->>'reduction_pct', '')::numeric,
                 baseline_amount = coalesce(nullif(t->>'baseline_amount', '')::numeric, baseline_amount),
                 computed_limit = v_target_limit,
                 status = 'active'
           where id = v_target_id;
        end if;
        v_target_ids := v_target_ids || v_target_id;
        v_target_id := null;
      end loop;
    end if;
    v_goal_id := null;
  end loop;

  r := jsonb_build_object(
    'kind', 'spending_goal_plan',
    'goal_id', v_goal_ids[1],
    'goal_ids', to_jsonb(v_goal_ids),
    'target_ids', to_jsonb(v_target_ids),
    'summary', c.summary_text,
    'receipt_text', p->>'receipt_text'
  );

  update public.pending_confirmations
     set status = 'confirmed', executed_at = now(), result_snapshot = r,
         confirmed_from_message_id = p_source_message_id
   where id = c.id;

  return jsonb_build_object('ok', true, 'idempotent', false, 'result', r);
end;
$$;

revoke all on function public.agent_execute_spending_goal_plan_confirmation_v1(uuid, uuid) from public;
grant execute on function public.agent_execute_spending_goal_plan_confirmation_v1(uuid, uuid) to authenticated, service_role;

-- Comunicação ativa das metas de gasto (`nino_spending_goals_comm.v1`).
insert into public.communication_catalog (
  kind, label, family, description, active, base_priority,
  allowed_channels, default_channels, cooldown_hours, dismiss_cooldown_days,
  not_useful_cooldown_days, max_per_day, requires_manual_approval, content_mode,
  sensitivity, fallback_policy, min_severity_for_whatsapp, stale_policy,
  default_window_hours, min_utility_score, escalation_channels,
  whatsapp_min_confidence, whatsapp_min_absolute_impact, same_pattern_cooldown_days
) values
(
  'spending_goal_pressure', 'Meta de gasto acima do ritmo', 'metas',
  'Meta da categoria acima do ritmo ou do limite, com o estabelecimento responsável e o valor disponível até o fechamento.',
  true, 110,
  array['app','whatsapp'], array['app','whatsapp'], 48, 7,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'attention', 'drop_after_window',
  14, 0.5, array[]::text[],
  0.7, 0, 3
),
(
  'spending_goal_zero_charge', 'Cobrança em submeta zerada', 'metas',
  'Nova cobrança em estabelecimento cuja submeta é zero: assinatura ativa ou renovação automática.',
  true, 180,
  array['app','whatsapp'], array['app','whatsapp'], 12, 7,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'attention', 'drop_after_window',
  14, 0.5, array[]::text[],
  0.7, 0, 1
),
(
  'spending_goal_threshold', 'Meta de gasto perto do limite', 'metas',
  'Já foram usados 75% da meta com boa parte do período pela frente; mostra o valor médio disponível por dia.',
  true, 100,
  array['app','whatsapp'], array['app','whatsapp'], 72, 7,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'attention', 'drop_after_window',
  14, 0.5, array[]::text[],
  0.7, 0, 14
),
(
  'spending_goal_weekend', 'Fim de semana e meta de gasto', 'metas',
  'Na quinta ou sexta: quanto da meta cabe no fim de semana quando ele costuma pesar mais na categoria.',
  true, 70,
  array['app','whatsapp'], array['app','whatsapp'], 72, 7,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'info', 'drop_after_window',
  12, 0.5, array[]::text[],
  0.7, 0, 5
),
(
  'spending_goal_weekly', 'Resumo semanal das metas', 'metas',
  'Segunda-feira: progresso da meta e das submetas, consumo x tempo, projeção, quem mais pesou e a recomendação da semana.',
  true, 60,
  array['app','whatsapp'], array['app','whatsapp'], 144, 7,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'info', 'drop_after_window',
  12, 0.5, array[]::text[],
  0.7, 0, 6
),
(
  'spending_goal_monthly', 'Fechamento mensal das metas', 'metas',
  'Dias 1 a 3: meta cumprida ou não, de onde veio a economia e para onde direcioná-la.',
  true, 80,
  array['app','whatsapp'], array['app','whatsapp'], 240, 7,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'info', 'drop_after_window',
  24, 0.5, array[]::text[],
  0.7, 0, 25
)
on conflict (kind) do nothing;
