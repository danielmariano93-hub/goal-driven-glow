alter table public.transactions
  add column if not exists refund_match_status text;

alter table public.transactions
  drop constraint if exists transactions_refund_match_status_chk;
alter table public.transactions
  add constraint transactions_refund_match_status_chk
  check (refund_match_status is null or refund_match_status in
    ('linked', 'ambiguous', 'needs_review', 'no_candidate', 'manual'));

create index if not exists idx_transactions_refund_match_status
  on public.transactions (user_id, refund_match_status)
  where movement_kind = 'refund';

drop function if exists public.match_refund_candidate_v2(uuid);

create function public.match_refund_candidate_v2(p_refund_id uuid)
returns table (candidate_id uuid, match_status text, match_score numeric, candidate_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_refund record;
  v_key text;
  v_best_score numeric;
  v_count int;
  v_id uuid;
begin
  select t.id, t.user_id, t.account_id, t.amount, t.occurred_at,
         coalesce(t.merchant_name, t.friendly_description, t.description) as label
    into v_refund
    from public.transactions t
   where t.id = p_refund_id
     and t.movement_kind = 'refund';
  if not found then
    return query select null::uuid, 'no_candidate'::text, null::numeric, 0;
    return;
  end if;

  v_key := nullif(public.refund_merchant_key(v_refund.label), '');

  with candidates as (
    select e.id,
           (case when v_key is not null
                   and public.category_alias_key(coalesce(e.merchant_name, e.friendly_description, e.description))
                       like '%' || v_key || '%'
                 then 3 else 0 end)
           + (case when abs(e.amount - v_refund.amount) <= 0.02 then 2 else 0 end)
           + (case when e.account_id is not distinct from v_refund.account_id then 1 else 0 end)
           as cand_score
      from public.transactions e
     where e.user_id = v_refund.user_id
       and e.type = 'expense'
       and coalesce(e.movement_kind, 'transaction') = 'transaction'
       and e.status = 'confirmed'
       and e.id <> v_refund.id
       and e.amount >= v_refund.amount - 0.02
       and e.occurred_at between (v_refund.occurred_at - interval '90 days')::date
                             and (v_refund.occurred_at + interval '2 days')::date
       and (v_refund.account_id is null or e.account_id is null
            or e.account_id = v_refund.account_id)
       and not exists (
         select 1 from public.transactions r
          where r.refund_of_transaction_id = e.id
       )
  ), best as (
    select max(cand_score) as cand_score from candidates
  )
  select b.cand_score,
         (select count(*) from candidates c where c.cand_score = b.cand_score),
         (select min(c.id::text)::uuid from candidates c where c.cand_score = b.cand_score)
    into v_best_score, v_count, v_id
    from best b;

  if v_best_score is null then
    return query select null::uuid, 'no_candidate'::text, null::numeric, 0;
  elsif v_best_score < 3 then
    return query select null::uuid, 'needs_review'::text, v_best_score, coalesce(v_count, 0);
  elsif v_count <> 1 then
    return query select null::uuid, 'ambiguous'::text, v_best_score, v_count;
  else
    return query select v_id, 'linked'::text, v_best_score, 1;
  end if;
end;
$$;

grant execute on function public.match_refund_candidate_v2(uuid) to authenticated, service_role;

create or replace function public.match_refund_candidate(p_refund_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.candidate_id from public.match_refund_candidate_v2(p_refund_id) m where m.match_status = 'linked'
$$;

create or replace function public.refund_matcher_run(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v record;
  v_linked int := 0;
begin
  for r in
    select t.id
      from public.transactions t
     where t.movement_kind = 'refund'
       and t.refund_of_transaction_id is null
       and coalesce(t.refund_match_status, '') <> 'manual'
       and (p_user_id is null or t.user_id = p_user_id)
     order by t.occurred_at desc
  loop
    select * into v from public.match_refund_candidate_v2(r.id);
    if v.match_status = 'linked' and v.candidate_id is not null then
      update public.transactions
         set refund_of_transaction_id = v.candidate_id,
             refund_match_status = 'linked'
       where id = r.id
         and refund_of_transaction_id is null;
      v_linked := v_linked + 1;
    else
      update public.transactions
         set refund_match_status = v.match_status
       where id = r.id;
    end if;
  end loop;
  return v_linked;
end;
$$;

grant execute on function public.refund_matcher_run(uuid) to service_role;

update public.transactions t
   set refund_match_status = coalesce(
         (select m.match_status from public.match_refund_candidate_v2(t.id) m), 'no_candidate')
 where t.movement_kind = 'refund'
   and t.refund_of_transaction_id is null
   and t.refund_match_status is null;

update public.transactions
   set refund_match_status = 'linked'
 where movement_kind = 'refund'
   and refund_of_transaction_id is not null
   and refund_match_status is null;