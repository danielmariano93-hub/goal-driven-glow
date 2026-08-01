-- E6 — Integridade de dados de cartão: detecção de dupla contagem + backfill de parcelas absorvidas.
alter table public.credit_card_installments
  add column if not exists absorbed_by_statement_id uuid references public.credit_card_statements(id) on delete set null,
  add column if not exists absorbed_at timestamptz;

create index if not exists idx_cc_installments_absorbed
  on public.credit_card_installments (absorbed_by_statement_id);

-- Backfill idempotente: parcela cuja competência é coberta por fatura fechada/paga.
update public.credit_card_installments i
set absorbed_by_statement_id = s.id,
    absorbed_at = coalesce(i.absorbed_at, now())
from public.credit_card_statements s
where s.user_id = i.user_id
  and s.credit_card_id = i.credit_card_id
  and date_trunc('month', s.competence_month) >= date_trunc('month', i.competence_month)
  and s.status in ('paid','settled','closed','closed_paid','approved')
  and i.absorbed_by_statement_id is null
  and coalesce(i.status,'') not in ('paid','refunded','cancelled','reversed','anticipated');

create or replace view public.v_card_double_counting
with (security_invoker = true) as
with statement_totals as (
  select s.user_id, s.credit_card_id, date_trunc('month', s.competence_month)::date as competence_month,
         s.status, coalesce(s.stated_total, 0) as official_total
  from public.credit_card_statements s
),
tx_totals as (
  select t.user_id, t.credit_card_id, date_trunc('month', t.competence_date)::date as competence_month,
         sum(case when t.type = 'income' then -t.amount else t.amount end) as tx_total
  from public.transactions t
  where t.credit_card_id is not null
    and t.settles_card_id is null
    and t.competence_date is not null
    and t.status = 'confirmed'
  group by 1,2,3
),
inst_totals as (
  select i.user_id, i.credit_card_id, date_trunc('month', i.competence_month)::date as competence_month,
         sum(i.amount) as installment_total,
         sum(case when i.absorbed_by_statement_id is not null then i.amount else 0 end) as absorbed_total
  from public.credit_card_installments i
  where coalesce(i.status,'') not in ('refunded','cancelled','reversed')
  group by 1,2,3
)
select
  st.user_id,
  st.credit_card_id,
  st.competence_month,
  st.status as statement_status,
  round(st.official_total, 2) as official_total,
  round(coalesce(tx.tx_total, 0), 2) as transactions_total,
  round(coalesce(inst.installment_total, 0), 2) as installments_total,
  round(coalesce(inst.absorbed_total, 0), 2) as installments_absorbed_total,
  round(coalesce(tx.tx_total, 0) - st.official_total, 2) as transactions_vs_official,
  case
    when abs(coalesce(tx.tx_total, 0) - st.official_total) > 0.05 then 'transactions_diverge'
    when coalesce(inst.installment_total, 0) - coalesce(inst.absorbed_total, 0) > 0.05
         and st.status in ('paid','settled','closed','closed_paid','approved') then 'installments_not_absorbed'
    else 'ok'
  end as issue
from statement_totals st
left join tx_totals tx
  on tx.user_id = st.user_id and tx.credit_card_id = st.credit_card_id and tx.competence_month = st.competence_month
left join inst_totals inst
  on inst.user_id = st.user_id and inst.credit_card_id = st.credit_card_id and inst.competence_month = st.competence_month;

grant select on public.v_card_double_counting to authenticated;
grant select on public.v_card_double_counting to service_role;