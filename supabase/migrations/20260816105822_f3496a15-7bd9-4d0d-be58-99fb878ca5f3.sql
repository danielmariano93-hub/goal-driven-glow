create or replace function public.refund_merchant_key(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select public.category_alias_key(
    regexp_replace(
      coalesce(p_text, ''),
      '(?i)\y(estorno|estornos|estornado|reembolso|reembolsado|devolucao|cancelamento|cancelado|parcial|de)\y',
      ' ', 'g'
    )
  )
$$;

create or replace function public.match_refund_candidate(p_refund_id uuid)
returns uuid
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
     and t.movement_kind = 'refund'
     and t.refund_of_transaction_id is null;
  if not found then return null; end if;

  v_key := nullif(public.refund_merchant_key(v_refund.label), '');

  with candidates as (
    select e.id,
           (case when v_key is not null
                   and public.category_alias_key(coalesce(e.merchant_name, e.friendly_description, e.description))
                       like '%' || v_key || '%'
                 then 3 else 0 end)
           + (case when abs(e.amount - v_refund.amount) <= 0.02 then 2 else 0 end)
           + (case when e.account_id is not distinct from v_refund.account_id then 1 else 0 end)
           as score
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
    select max(score) as score from candidates
  )
  select b.score,
         (select count(*) from candidates c where c.score = b.score),
         (select min(c.id::text)::uuid from candidates c where c.score = b.score)
    into v_best_score, v_count, v_id
    from best b;

  if v_best_score is null or v_best_score < 3 then return null; end if;
  if v_count <> 1 then return null; end if;
  return v_id;
end;
$$;

grant execute on function public.match_refund_candidate(uuid) to authenticated, service_role;

create or replace function public.refund_matcher_run(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_match uuid;
  v_linked int := 0;
begin
  for r in
    select t.id
      from public.transactions t
     where t.movement_kind = 'refund'
       and t.refund_of_transaction_id is null
       and (p_user_id is null or t.user_id = p_user_id)
     order by t.occurred_at desc
  loop
    v_match := public.match_refund_candidate(r.id);
    if v_match is not null then
      update public.transactions
         set refund_of_transaction_id = v_match
       where id = r.id
         and refund_of_transaction_id is null;
      v_linked := v_linked + 1;
    end if;
  end loop;
  return v_linked;
end;
$$;

grant execute on function public.refund_matcher_run(uuid) to service_role;

create or replace function public.tg_refund_autolink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match uuid;
begin
  if new.movement_kind = 'refund' and new.refund_of_transaction_id is null then
    v_match := public.match_refund_candidate(new.id);
    if v_match is not null then
      update public.transactions
         set refund_of_transaction_id = v_match
       where id = new.id and refund_of_transaction_id is null;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_refund_autolink on public.transactions;
create trigger trg_refund_autolink
after insert on public.transactions
for each row
when (new.movement_kind = 'refund' and new.refund_of_transaction_id is null)
execute function public.tg_refund_autolink();

select public.refund_matcher_run(null);

delete from public.merchant_aliases
 where public.category_alias_key(coalesce(normalized_pattern, alias_key)) ~
       '^(pay|est|pix|ted|doc|compra|pagamento|pgto|debito|credito|cartao|boleto|transf|transferencia|pagseguro|picpay|mercado pago|mercpago|pagbank|stone|cielo|getnet|redecard)( |$)';

delete from public.user_merchant_preferences
 where public.category_alias_key(merchant_key) ~
       '^(pay|est|pix|ted|doc|compra|pagamento|pgto|debito|credito|cartao|boleto|transf|transferencia|pagseguro|picpay|mercado pago|mercpago|pagbank|stone|cielo|getnet|redecard)( |$)';

delete from public.merchant_aliases
 where coalesce(normalized_pattern, alias_key) ~* '99\s*foo'
    or coalesce(normalized_pattern, alias_key) ~* 'seguro\s+(do\s+)?cart';

update public.transactions t
   set category_id = c.id
  from public.categories c
 where c.type = 'expense'
   and c.archived_at is null
   and (c.user_id = t.user_id or c.user_id is null)
   and lower(c.name) like 'aliment%'
   and t.type = 'expense'
   and coalesce(t.movement_kind, 'transaction') = 'transaction'
   and coalesce(t.merchant_name, t.friendly_description, t.description) ~* '99\s*foo'
   and t.category_id is distinct from c.id;

update public.transactions t
   set category_id = c.id
  from public.categories c
 where c.type = 'expense'
   and c.archived_at is null
   and (c.user_id = t.user_id or c.user_id is null)
   and lower(c.name) like 'seguro%'
   and t.type = 'expense'
   and coalesce(t.movement_kind, 'transaction') = 'transaction'
   and coalesce(t.merchant_name, t.friendly_description, t.description) ~* 'seguro\s+(do\s+)?cart'
   and t.category_id is distinct from c.id;

update public.transactions t
   set merchant_name = 'Autopass',
       category_id = coalesce(
         (select c.id from public.categories c
           where c.type = 'expense' and c.archived_at is null
             and (c.user_id = t.user_id or c.user_id is null)
             and lower(c.name) like 'transporte%'
           order by (c.user_id = t.user_id) desc
           limit 1),
         t.category_id
       )
 where t.type = 'expense'
   and coalesce(t.movement_kind, 'transaction') = 'transaction'
   and coalesce(t.merchant_name, t.friendly_description, t.description) ~* '\yautopass|\yautop\y';