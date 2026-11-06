-- Usuários sintéticos do Nino: contas sandbox com dados semeados de forma determinística, rodadas de
-- teste e resultados por cenário. Nada aqui toca contas reais: o semeador só opera em perfis
-- `is_test` + `is_sandbox` e só é chamável pelo service_role.

create table if not exists public.synthetic_users (
  persona_id text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  spec_hash text,
  reference_date date,
  seeded_at timestamptz not null default now()
);

create table if not exists public.synthetic_runs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  suite text not null default 'synthetic',          -- synthetic | golden
  git_sha text,
  config jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists synthetic_runs_started_idx on public.synthetic_runs (started_at desc);

create table if not exists public.synthetic_results (
  id bigserial primary key,
  run_id uuid not null references public.synthetic_runs(id) on delete cascade,
  scenario_id text not null,
  persona_id text,
  style text,
  rep int not null default 1,
  area text,
  verdict text not null,                             -- CORRECT | CORRECT_REFUSAL | MISS | WRONG | INFRA | UNVERIFIED
  layers jsonb not null default '{}'::jsonb,         -- nota por camada: fato, estado, regra, naturalidade
  why text,
  turns jsonb not null default '[]'::jsonb,
  replies jsonb not null default '[]'::jsonb,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists synthetic_results_run_idx on public.synthetic_results (run_id);
create index if not exists synthetic_results_scn_idx on public.synthetic_results (scenario_id, created_at desc);

alter table public.synthetic_users enable row level security;
alter table public.synthetic_runs enable row level security;
alter table public.synthetic_results enable row level security;

drop policy if exists synthetic_users_admin_read on public.synthetic_users;
create policy synthetic_users_admin_read on public.synthetic_users for select to authenticated using (public.is_current_user_admin());
drop policy if exists synthetic_runs_admin_read on public.synthetic_runs;
create policy synthetic_runs_admin_read on public.synthetic_runs for select to authenticated using (public.is_current_user_admin());
drop policy if exists synthetic_results_admin_read on public.synthetic_results;
create policy synthetic_results_admin_read on public.synthetic_results for select to authenticated using (public.is_current_user_admin());

-- Semeador: cria (ou recria) a conta sandbox de uma persona com os dados do `p_spec`.
-- p_spec = { display_name, reference_date, accounts:[{name,type,opening_balance,institution}],
--            transactions:[{date,type,amount,category,description,account,status}],
--            debts:[{name,creditor,original_amount,outstanding_balance,installment_amount,installments_total,installments_paid,due_day,interest_rate_pct}],
--            goals:[{name,target_amount,target_date,kind}] }
create or replace function public.synthetic_seed(p_persona text, p_spec jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_email text := 'sintetico-' || lower(regexp_replace(p_persona, '[^a-zA-Z0-9]+', '-', 'g')) || '@sintetico.nino.test';
  v_acc jsonb;
  v_tx jsonb;
  v_d jsonb;
  v_g jsonb;
  v_acc_ids jsonb := '{}'::jsonb;
  v_acc_id uuid;
  v_cat_id uuid;
  v_ctype text;
  n_tx int := 0;
  n_acc int := 0;
begin
  if p_persona is null or p_persona !~ '^[a-z0-9_]{2,40}$' then raise exception 'persona_invalid'; end if;

  select user_id into v_uid from public.synthetic_users where persona_id = p_persona;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email, '',
            now(), '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('display_name', coalesce(p_spec->>'display_name', p_persona)), now(), now());
    insert into public.synthetic_users (persona_id, user_id) values (p_persona, v_uid);
  end if;

  update public.profiles
     set is_test = true, is_sandbox = true,
         display_name = coalesce(p_spec->>'display_name', display_name),
         onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = v_uid;

  -- Limpa só esta conta sandbox (nunca outra): dados financeiros e histórico de conversa.
  if not exists (select 1 from public.profiles where id = v_uid and is_sandbox and is_test) then
    raise exception 'not_a_sandbox_user';
  end if;
  delete from public.transactions where user_id = v_uid;
  delete from public.goal_contributions where user_id = v_uid;
  delete from public.goals where user_id = v_uid;
  delete from public.debts where user_id = v_uid;
  delete from public.pending_confirmations where user_id = v_uid;
  delete from public.conversation_messages where user_id = v_uid;
  delete from public.conversations where user_id = v_uid;
  delete from public.agent_memory where user_id = v_uid;
  delete from public.accounts where user_id = v_uid;

  for v_acc in select * from jsonb_array_elements(coalesce(p_spec->'accounts', '[]'::jsonb)) loop
    insert into public.accounts (user_id, name, type, institution, opening_balance)
    values (v_uid, v_acc->>'name', coalesce(v_acc->>'type', 'checking')::public.account_type,
            v_acc->>'institution', coalesce((v_acc->>'opening_balance')::numeric, 0))
    returning id into v_acc_id;
    v_acc_ids := v_acc_ids || jsonb_build_object(v_acc->>'name', v_acc_id);
    n_acc := n_acc + 1;
  end loop;

  for v_tx in select * from jsonb_array_elements(coalesce(p_spec->'transactions', '[]'::jsonb)) loop
    v_ctype := v_tx->>'type';
    select id into v_cat_id from public.categories
     where user_id is null and name = v_tx->>'category' and type::text = v_ctype limit 1;
    if v_cat_id is null then raise exception 'category_unknown:%', v_tx->>'category'; end if;
    insert into public.transactions (user_id, account_id, category_id, type, status, amount, occurred_at,
                                     description, payment_method, origin)
    values (v_uid, nullif(v_acc_ids->>(v_tx->>'account'), '')::uuid, v_cat_id, v_ctype::public.transaction_type,
            coalesce(v_tx->>'status', 'confirmed')::public.transaction_status,
            (v_tx->>'amount')::numeric, (v_tx->>'date')::date, v_tx->>'description', 'account', 'manual');
    n_tx := n_tx + 1;
  end loop;

  for v_d in select * from jsonb_array_elements(coalesce(p_spec->'debts', '[]'::jsonb)) loop
    insert into public.debts (user_id, name, creditor, original_amount, outstanding_balance, installment_amount,
                              installments_total, installments_paid, due_day, interest_rate_pct,
                              contract_total_amount, principal_amount, status)
    values (v_uid, v_d->>'name', v_d->>'creditor', (v_d->>'original_amount')::numeric,
            (v_d->>'outstanding_balance')::numeric, (v_d->>'installment_amount')::numeric,
            (v_d->>'installments_total')::int, coalesce((v_d->>'installments_paid')::int, 0),
            (v_d->>'due_day')::smallint, (v_d->>'interest_rate_pct')::numeric,
            (v_d->>'original_amount')::numeric, (v_d->>'original_amount')::numeric, 'active');
  end loop;

  for v_g in select * from jsonb_array_elements(coalesce(p_spec->'goals', '[]'::jsonb)) loop
    insert into public.goals (user_id, name, target_amount, target_date, kind, status)
    values (v_uid, v_g->>'name', (v_g->>'target_amount')::numeric, (v_g->>'target_date')::date,
            coalesce(v_g->>'kind', 'savings'), 'active');
  end loop;

  update public.synthetic_users
     set spec_hash = md5(p_spec::text), reference_date = nullif(p_spec->>'reference_date', '')::date, seeded_at = now()
   where persona_id = p_persona;

  return jsonb_build_object('user_id', v_uid, 'accounts', n_acc, 'transactions', n_tx);
end $$;
revoke all on function public.synthetic_seed(text, jsonb) from public, anon, authenticated;
grant execute on function public.synthetic_seed(text, jsonb) to service_role;

-- Visão do admin: últimas rodadas com resumo e a taxa de acerto de cada uma.
create or replace function public.admin_synthetic_overview(p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(x order by x.started_at desc), '[]'::jsonb) into r from (
    select id, label, suite, git_sha, started_at, finished_at, summary, config
      from public.synthetic_runs order by started_at desc limit greatest(1, least(p_limit, 100))
  ) x;
  return r;
end $$;
revoke all on function public.admin_synthetic_overview(int) from public, anon;
grant execute on function public.admin_synthetic_overview(int) to authenticated;

-- Resultados de uma rodada (sem as conversas inteiras; o detalhe vem sob demanda).
create or replace function public.admin_synthetic_results(p_run uuid, p_only_failures boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.scenario_id, x.rep), '[]'::jsonb) into r from (
    select scenario_id, persona_id, style, rep, area, verdict, layers, why, turns, replies, latency_ms
      from public.synthetic_results
     where run_id = p_run and (not p_only_failures or verdict not in ('CORRECT', 'CORRECT_REFUSAL'))
     limit 2000
  ) x;
  return r;
end $$;
revoke all on function public.admin_synthetic_results(uuid, boolean) from public, anon;
grant execute on function public.admin_synthetic_results(uuid, boolean) to authenticated;

-- Tráfego real, por semana: sinais de falha visíveis nas respostas enviadas (não é "acerto": não há gabarito
-- no tráfego real). Contas de teste/sandbox ficam de fora; só contagens, nunca o texto.
create or replace function public.admin_real_quality_weekly(p_weeks int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(x order by x.semana), '[]'::jsonb) into r from (
    select date_trunc('week', o.created_at)::date as semana,
           count(*)::int as respostas,
           count(*) filter (where o.body ~* 'não consegui concluir|tente novamente|ocorreu um erro|falha t[eé]cnica')::int as falhas,
           count(*) filter (where o.body ~* 'ainda não consigo|não consigo montar|não consegui (fechar|montar|confirmar|encontrar)|não encontrei|prefiro não|não posso')::int as recusas,
           count(*) filter (where o.body ~* 'qual período ou item|quero confirmar só um ponto|não ficou claro|pode me dizer qual')::int as esclarecimentos
      from public.outbound_messages o
      join public.profiles p on p.id = o.user_id and not p.is_test and not p.is_sandbox
     where o.inbound_message_id is not null
       and o.created_at >= now() - (greatest(1, least(p_weeks, 52)) || ' weeks')::interval
     group by 1
  ) x;
  return r;
end $$;
revoke all on function public.admin_real_quality_weekly(int) from public, anon;
grant execute on function public.admin_real_quality_weekly(int) to authenticated;
