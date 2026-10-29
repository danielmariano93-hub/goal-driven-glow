-- Gabarito do conjunto dourado ao vivo: SQL independente do código do Nino.
-- Troque :user_id pelo id da conta de teste. Saída: (key, value) -> monte `truth.json` com elas.
-- Regras de competência da Home: compra no cartão pertence ao mês da fatura (economic_competence_date >
-- competence_date > occurred_at); estorno só abate quando type='income'; transferências, pagamento de
-- fatura e movimentos patrimoniais não são gasto.
with b as (
  select t.id, t.type,
    case when (t.credit_card_id is not null or t.payment_method = 'credit_card') and t.economic_competence_date is not null then t.economic_competence_date
         when (t.credit_card_id is not null or t.payment_method = 'credit_card') and t.competence_date is not null then t.competence_date
         else t.occurred_at::date end as comp,
    case when t.status <> 'confirmed' or t.type = 'transfer' then 0
         when coalesce(t.movement_kind, 'transaction') = 'refund' then (case when t.type = 'income' and t.transfer_group_id is null then -t.amount else 0 end)
         when t.type = 'expense' and t.transfer_group_id is null and coalesce(t.movement_kind, 'transaction') = 'transaction' and t.settles_card_id is null then t.amount else 0 end as exp_amt,
    case when t.status = 'confirmed' and t.type = 'income' and t.transfer_group_id is null and coalesce(t.movement_kind, 'transaction') = 'transaction' then t.amount else 0 end as inc_amt,
    coalesce(o.category_id, t.category_id) as cat_id
  from transactions t left join transactions o on o.id = t.refund_of_transaction_id
  where t.user_id = :'user_id'
), c as (select b.*, cat.name as cat_name from b left join categories cat on cat.id = b.cat_id)
select 'exp:' || to_char(comp, 'YYYY-MM') as key, round(sum(exp_amt)::numeric, 2) as value from c group by 1
union all select 'inc:' || to_char(comp, 'YYYY-MM'), round(sum(inc_amt)::numeric, 2) from c group by 1
union all select 'cat:' || to_char(comp, 'YYYY-MM') || ':' || coalesce(cat_name, 'Sem categoria'), round(sum(exp_amt)::numeric, 2) from c where exp_amt <> 0 group by 1
union all select 'debt:total', round(sum(outstanding_balance)::numeric, 2) from debts where user_id = :'user_id' and status = 'active'
union all select 'debt:installments', round(sum(installment_amount)::numeric, 2) from debts where user_id = :'user_id' and status = 'active'
order by 1;
