-- nino_insight_value.v1 — aprendizado por tipo, catálogo de canais alinhado ao
-- valor real do insight, texto real nos compromissos futuros e métrica de eficácia.

create table if not exists public.insight_kind_learning (
  user_id uuid not null,
  kind text not null,
  dismissals integer not null default 0,
  actions integer not null default 0,
  false_positives integer not null default 0,
  last_dismissed_at timestamptz,
  last_acted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

grant select on public.insight_kind_learning to authenticated;
grant all on public.insight_kind_learning to service_role;

alter table public.insight_kind_learning enable row level security;

drop policy if exists "own insight learning" on public.insight_kind_learning;
create policy "own insight learning"
on public.insight_kind_learning for select
to authenticated
using (user_id = auth.uid());

create or replace function public.insight_learning_bump(
  _user_id uuid,
  _kind text,
  _dismissals int default 0,
  _actions int default 0,
  _false_positives int default 0
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.insight_kind_learning as l
    (user_id, kind, dismissals, actions, false_positives, last_dismissed_at, last_acted_at, updated_at)
  values (
    _user_id, _kind, greatest(_dismissals,0), greatest(_actions,0), greatest(_false_positives,0),
    case when _dismissals > 0 then now() end,
    case when _actions > 0 then now() end,
    now()
  )
  on conflict (user_id, kind) do update
     set dismissals = l.dismissals + greatest(_dismissals,0),
         actions = l.actions + greatest(_actions,0),
         false_positives = l.false_positives + greatest(_false_positives,0),
         last_dismissed_at = case when _dismissals > 0 then now() else l.last_dismissed_at end,
         last_acted_at = case when _actions > 0 then now() else l.last_acted_at end,
         updated_at = now();
$$;

create or replace function public.insight_learning_from_feedback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind is null then return new; end if;
  if new.feedback = 'not_useful' then
    perform public.insight_learning_bump(new.user_id, new.kind, 0, 0, 1);
  elsif new.feedback in ('dismissed', 'dismiss') then
    perform public.insight_learning_bump(new.user_id, new.kind, 1, 0, 0);
  elsif new.feedback in ('useful', 'acted') then
    perform public.insight_learning_bump(new.user_id, new.kind, 0, 1, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_insight_learning_feedback on public.communication_feedback;
create trigger trg_insight_learning_feedback
after insert on public.communication_feedback
for each row execute function public.insight_learning_from_feedback();

create or replace function public.insight_learning_from_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then return new; end if;
  if new.status = 'acted' then
    perform public.insight_learning_bump(new.user_id, new.kind, 0, 1, 0);
  elsif new.status = 'dismissed' then
    perform public.insight_learning_bump(new.user_id, new.kind, 1, 0, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_insight_learning_delivery on public.communication_deliveries;
create trigger trg_insight_learning_delivery
after update of status on public.communication_deliveries
for each row execute function public.insight_learning_from_delivery();

create or replace function public.insight_learning_from_item_dismiss()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_kind text;
begin
  if new.dismissed_at is null or old.dismissed_at is not null then return new; end if;
  select s.kind into v_kind
    from public.pending_proactive_suggestions s
   where s.user_id = new.user_id and s.dedup_key = new.dedup_key
   order by s.created_at desc limit 1;
  if v_kind is not null then
    perform public.insight_learning_bump(new.user_id, v_kind, 1, 0, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_insight_learning_item_dismiss on public.nino_intelligence_items;
create trigger trg_insight_learning_item_dismiss
after update of dismissed_at on public.nino_intelligence_items
for each row execute function public.insight_learning_from_item_dismiss();

insert into public.communication_catalog
  (kind, label, family, description, active, base_priority, allowed_channels, default_channels,
   min_severity_for_whatsapp, sensitivity, cooldown_hours, max_per_day)
values
  ('spending_pace_change','Mudança no ritmo de gastos','financial',
   'O ritmo de consumo mudou de forma material no período.', true, 120,
   array['app','whatsapp'], array['app','whatsapp'], 'attention','normal', 48, 1),
  ('investment_drawdown','Resgate sustentando o caixa','financial',
   'Parte do caixa veio de resgate de investimento, não de renda nova.', true, 130,
   array['app','whatsapp'], array['app','whatsapp'], 'attention','normal', 72, 1),
  ('card_bill_pressure','Pressão de fatura','financial',
   'Fatura ou parcelas comprometem o caixa até o vencimento.', true, 200,
   array['app','whatsapp'], array['app','whatsapp'], 'attention','normal', 48, 1),
  ('debt_progress','Progresso de dívida','achievement',
   'Reforço positivo quando a dívida realmente cai.', true, 60,
   array['app'], array['app'], 'critical','normal', 168, 1),
  ('goal_progress','Progresso de meta','achievement',
   'Reforço positivo de meta.', true, 60,
   array['app'], array['app'], 'critical','normal', 168, 1),
  ('split_payment_pending','Pagamento da divisão aguardando','operational',
   'Pagamento informado aguardando confirmação.', true, 110,
   array['app','whatsapp'], array['app','whatsapp'], 'attention','normal', 24, 2)
on conflict (kind) do update
   set active = excluded.active,
       allowed_channels = excluded.allowed_channels,
       default_channels = excluded.default_channels,
       min_severity_for_whatsapp = excluded.min_severity_for_whatsapp,
       updated_at = now();

update public.communication_catalog
   set allowed_channels = array['app'],
       default_channels = array['app'],
       min_severity_for_whatsapp = 'critical',
       base_priority = least(base_priority, 60),
       updated_at = now()
 where kind in ('duplicate_expense','categorize_transaction','recurring_pattern');

create or replace function public.nino_evaluate_future_situations(
  _user_id uuid, _as_of date, _run_mode text, _run_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_count int:=0; v_eval jsonb; v_action jsonb; v_summary text; begin
 for r in
  select 'bill' kind,s.id source_id,s.credit_card_id context_id,s.due_date event_date,greatest(s.outstanding_amount,0) amount,'Fatura vence em breve' headline, coalesce(c.name,'seu cartão') label from public.credit_card_statements s left join public.credit_cards c on c.id=s.credit_card_id where s.user_id=_user_id and s.due_date between _as_of+1 and _as_of+15 and s.outstanding_amount>0
  union all select 'installment',(array_agg(i.id order by i.due_date))[1],i.credit_card_id,min(i.due_date),sum(i.amount),'Parcelas já comprometem os próximos dias', coalesce(max(c.name),'seu cartão') from public.credit_card_installments i left join public.credit_cards c on c.id=i.credit_card_id where i.user_id=_user_id and i.due_date between _as_of+1 and _as_of+30 and i.status not in ('paid','cancelled') group by i.credit_card_id
  union all select 'recurring',(array_agg(o.id order by o.due_date))[1],null,min(o.due_date),sum(rr.amount),'Compromissos recorrentes estão próximos', 'compromissos recorrentes' from public.recurring_occurrences o join public.recurring_rules rr on rr.id=o.recurring_rule_id where o.user_id=_user_id and o.due_date between _as_of+1 and _as_of+15 and o.status='planned' group by o.user_id
  union all select 'debt',d.id,null,make_date(extract(year from _as_of)::int,extract(month from _as_of)::int,least(d.due_day,28)),d.installment_amount,'Parcela de dívida se aproxima', coalesce(d.creditor,d.name,'sua dívida') from public.debts d where d.user_id=_user_id and d.status='active' and d.installment_amount>0 and make_date(extract(year from _as_of)::int,extract(month from _as_of)::int,least(d.due_day,28)) between _as_of+1 and _as_of+15
  union all select 'goal',g.id,null,least(g.target_date,_as_of+30),greatest(g.target_amount-coalesce((select sum(c.amount) from public.goal_contributions c where c.goal_id=g.id),0),0),'Sua meta pede um próximo aporte', coalesce(g.name,'sua meta') from public.goals g where g.user_id=_user_id and g.status='active' and g.target_date>=_as_of and g.target_amount>coalesce((select sum(c.amount) from public.goal_contributions c where c.goal_id=g.id),0)
 loop
  v_eval:=jsonb_build_object('future_kind',r.kind,'source_id',r.source_id,'card_id',r.context_id,'opportunity_date',r.event_date,'goal_id',case when r.kind='goal' then r.source_id else null end);
  v_action:=public.nino_diag_select_action(case when r.kind='goal' then 'goal_feasibility' else 'anticipation' end,'active',v_eval,r.amount);
  v_summary := case r.kind
    when 'bill' then 'A fatura de '||r.label||' fecha em R$ '||to_char(r.amount,'FM999G999G999D00')||' e vence em '||to_char(r.event_date,'DD/MM')||'.'
    when 'installment' then 'As parcelas de '||r.label||' somam R$ '||to_char(r.amount,'FM999G999G999D00')||' e a próxima cai em '||to_char(r.event_date,'DD/MM')||'.'
    when 'recurring' then 'Seus '||r.label||' somam R$ '||to_char(r.amount,'FM999G999G999D00')||' até '||to_char(r.event_date,'DD/MM')||'.'
    when 'debt' then 'A parcela de '||r.label||' é de R$ '||to_char(r.amount,'FM999G999G999D00')||' e vence em '||to_char(r.event_date,'DD/MM')||'.'
    else 'Para '||r.label||' faltam R$ '||to_char(r.amount,'FM999G999G999D00')||' até '||to_char(r.event_date,'DD/MM/YYYY')||'.'
  end;
  perform public.nino_diag_put_situation(_user_id,_run_mode,_run_id,_as_of,case when r.kind='goal' then 'goal_feasibility' else 'anticipation' end,'future:'||r.kind||':'||r.source_id::text,'active','future',case when r.amount>=1000 then 'attention' else 'info' end,.90,_as_of,r.event_date,r.amount,null,null,null,r.amount,r.headline,v_summary,'Esse valor pode reduzir o caixa disponível na data prevista.','Data prevista: '||to_char(r.event_date,'DD/MM/YYYY'),r.event_date::timestamptz+interval '1 day',v_eval,jsonb_build_object('evidence_type','future_commitment','value',r.amount,'event_date',r.event_date),v_action); v_count:=v_count+1;
 end loop;
 update public.financial_situations set status='expired',resolved_at=now(),updated_at=now() where user_id=_user_id and run_mode=_run_mode and temporal_scope='future' and valid_until<now() and status not in ('expired','resolved','suppressed'); return v_count; end $$;

create or replace function public.admin_v2_insight_effectiveness(_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_rows jsonb; begin
  perform public._require_perm('operations.read');
  select coalesce(jsonb_agg(x order by x->>'kind'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'kind', d.kind,
      'total', count(*),
      'delivered', count(*) filter (where d.status in ('delivered','sent','queued','acted')),
      'suppressed', count(*) filter (where d.status = 'suppressed'),
      'acted', count(*) filter (where d.status = 'acted'),
      'dismissed', count(*) filter (where d.status = 'dismissed'),
      'not_useful', coalesce(max(f.not_useful), 0),
      'action_rate', round(
        count(*) filter (where d.status = 'acted')::numeric
        / greatest(count(*) filter (where d.status in ('delivered','sent','acted')), 1), 4)
    ) x
      from public.communication_deliveries d
      left join lateral (
        select count(*) not_useful from public.communication_feedback cf
         where cf.kind = d.kind and cf.feedback = 'not_useful'
           and cf.created_at >= now() - make_interval(days => greatest(_days,1))
      ) f on true
     where d.created_at >= now() - make_interval(days => greatest(_days,1))
     group by d.kind
  ) t;
  return jsonb_build_object('ok', true, 'days', greatest(_days,1), 'by_kind', v_rows);
end;
$$;

grant execute on function public.admin_v2_insight_effectiveness(integer) to authenticated;