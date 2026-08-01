-- v_card_double_counting v2 — o "plug" de conciliação deixa de esconder e de
-- inventar divergência: ele aparece como número próprio e o resíduo é medido
-- contra o total oficial já limpo de ajustes manuais.
DROP VIEW IF EXISTS public.v_card_double_counting;
CREATE VIEW public.v_card_double_counting AS
WITH statement_totals AS (
  SELECT s.id AS statement_id,
         s.user_id,
         s.credit_card_id,
         date_trunc('month', s.competence_month::timestamptz)::date AS competence_month,
         s.status,
         COALESCE(s.stated_total, 0::numeric) AS official_total
  FROM public.credit_card_statements s
), adj_totals AS (
  SELECT i.statement_id,
         sum(i.amount) AS adjustments_total,
         count(*) FILTER (WHERE i.legacy_transaction_id IS NULL) AS unjustified_adjustments
  FROM public.credit_card_statement_items i
  WHERE i.item_kind = 'adjustment'
  GROUP BY i.statement_id
), tx_totals AS (
  SELECT t.user_id,
         t.credit_card_id,
         date_trunc('month', t.competence_date::timestamptz)::date AS competence_month,
         sum(CASE WHEN t.type = 'income'::transaction_type THEN -t.amount ELSE t.amount END) AS tx_total
  FROM public.transactions t
  WHERE t.credit_card_id IS NOT NULL
    AND t.settles_card_id IS NULL
    AND t.competence_date IS NOT NULL
    AND t.status = 'confirmed'::transaction_status
  GROUP BY t.user_id, t.credit_card_id, date_trunc('month', t.competence_date::timestamptz)::date
), inst_totals AS (
  SELECT i.user_id,
         i.credit_card_id,
         date_trunc('month', i.competence_month::timestamptz)::date AS competence_month,
         sum(i.amount) AS installment_total,
         sum(CASE WHEN i.absorbed_by_statement_id IS NOT NULL THEN i.amount ELSE 0::numeric END) AS absorbed_total
  FROM public.credit_card_installments i
  WHERE COALESCE(i.status, '') <> ALL (ARRAY['refunded','cancelled','reversed'])
  GROUP BY i.user_id, i.credit_card_id, date_trunc('month', i.competence_month::timestamptz)::date
)
SELECT st.user_id,
       st.credit_card_id,
       st.competence_month,
       st.status AS statement_status,
       round(st.official_total, 2) AS official_total,
       round(COALESCE(tx.tx_total, 0::numeric), 2) AS transactions_total,
       round(COALESCE(inst.installment_total, 0::numeric), 2) AS installments_total,
       round(COALESCE(inst.absorbed_total, 0::numeric), 2) AS installments_absorbed_total,
       round(COALESCE(tx.tx_total, 0::numeric) - st.official_total, 2) AS transactions_vs_official,
       round(COALESCE(adj.adjustments_total, 0::numeric), 2) AS adjustments_total,
       COALESCE(adj.unjustified_adjustments, 0)::int AS unjustified_adjustments,
       round(COALESCE(tx.tx_total, 0::numeric)
             - (st.official_total - COALESCE(adj.adjustments_total, 0::numeric)), 2) AS residual_vs_official,
       CASE
         WHEN abs(COALESCE(tx.tx_total, 0::numeric)
                  - (st.official_total - COALESCE(adj.adjustments_total, 0::numeric))) > 0.05
           THEN 'transactions_diverge'
         WHEN COALESCE(adj.unjustified_adjustments, 0) > 0
           THEN 'reconciled_by_adjustment'
         WHEN (COALESCE(inst.installment_total, 0::numeric) - COALESCE(inst.absorbed_total, 0::numeric)) > 0.05
              AND st.status = ANY (ARRAY['paid','settled','closed','closed_paid','approved'])
           THEN 'installments_not_absorbed'
         ELSE 'ok'
       END AS issue
FROM statement_totals st
LEFT JOIN adj_totals adj ON adj.statement_id = st.statement_id
LEFT JOIN tx_totals tx ON tx.user_id = st.user_id AND tx.credit_card_id = st.credit_card_id AND tx.competence_month = st.competence_month
LEFT JOIN inst_totals inst ON inst.user_id = st.user_id AND inst.credit_card_id = st.credit_card_id AND inst.competence_month = st.competence_month;

GRANT SELECT ON public.v_card_double_counting TO authenticated, service_role;
