-- F1 (definições únicas) — modo SOMBRA. Aditivo, somente leitura, sem cron e sem gravação.
-- Veja docs/NINO_CAUSAS_E_ALERTAS_REFINAMENTO_TECNICO.md (§2.5 e §5).
--
-- Definição v2 de compromissos mensais:
--   recorrências de despesa (normalizadas ao mês) + parcelas de dívida
--   + parcelas de cartão do cronograma (status scheduled/billed; cancelled = antecipada/quitada fica de fora).
-- A fatura aberta NÃO entra como compromisso: é item de caixa/calendário (informativo no relatório).
-- Renda base: mesma janela do diagnóstico atual (90 dias terminando ontem), para isolar a diferença de definição.
-- Nenhuma mensagem, Home ou diagnóstico lê esta função: a troca é feita só depois do relatório aceito, por flag.
CREATE OR REPLACE FUNCTION public.nino_commitments_shadow(_user_id uuid, _as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH mes AS (
    SELECT date_trunc('month', _as_of)::date AS atual,
           (date_trunc('month', _as_of) + interval '1 month')::date AS proximo
  ),
  renda AS (
    SELECT coalesce(sum(CASE WHEN type='income' AND coalesce(movement_kind,'transaction')='transaction'
                             THEN amount ELSE 0 END), 0) / 3 AS media
      FROM public.transactions
     WHERE user_id=_user_id AND status='confirmed'
       AND occurred_at BETWEEN (_as_of - 90) AND (_as_of - 1)
  ),
  rec AS (
    SELECT coalesce(sum(CASE frequency::text
             WHEN 'weekly' THEN amount*4.345 WHEN 'biweekly' THEN amount*2.17
             WHEN 'quarterly' THEN amount/3 WHEN 'yearly' THEN amount/12 ELSE amount END), 0) AS v
      FROM public.recurring_rules
     WHERE user_id=_user_id AND status='active' AND kind::text='expense'
  ),
  div AS (
    SELECT coalesce(sum(installment_amount), 0) AS v
      FROM public.debts WHERE user_id=_user_id AND status='active'
  ),
  parc AS (
    SELECT coalesce(sum(i.amount) FILTER (WHERE i.competence_month=m.atual AND i.status IN ('scheduled','billed')), 0) AS atual_abertas,
           coalesce(sum(i.amount) FILTER (WHERE i.competence_month=m.proximo AND i.status IN ('scheduled','billed')), 0) AS proximo_agendadas,
           count(*) FILTER (WHERE i.competence_month=m.proximo AND i.status IN ('scheduled','billed')) AS proximo_n,
           coalesce(sum(i.amount) FILTER (WHERE i.competence_month=m.proximo AND i.status='cancelled'), 0) AS proximo_canceladas,
           count(*) FILTER (WHERE i.competence_month=m.proximo AND i.status='cancelled') AS proximo_canceladas_n
      FROM public.credit_card_installments i, mes m
     WHERE i.user_id=_user_id AND i.competence_month IN (m.atual, m.proximo)
  ),
  fatura AS (
    SELECT coalesce(sum(greatest(coalesce(s.outstanding_amount, s.reconciled_total, s.stated_total, 0), 0)), 0) AS aberta
      FROM public.credit_card_statements s
      JOIN public.credit_cards c ON c.id=s.credit_card_id, mes m
     WHERE s.user_id=_user_id AND c.active=true AND s.status NOT IN ('deleted','void')
       AND (s.competence_month=m.atual OR s.due_date BETWEEN (_as_of-7) AND (_as_of+20))
  )
  SELECT jsonb_build_object(
    'contract', 'commitments_shadow.v1',
    'as_of', _as_of,
    'income_baseline_90d', round(renda.media, 2),
    'recurring', round(rec.v, 2),
    'debts', round(div.v, 2),
    'card_installments_current_open', round(parc.atual_abertas, 2),
    'card_installments_next_scheduled', round(parc.proximo_agendadas, 2),
    'card_installments_next_count', parc.proximo_n,
    'card_installments_next_cancelled', round(parc.proximo_canceladas, 2),
    'card_installments_next_cancelled_count', parc.proximo_canceladas_n,
    'open_card_bill_info_only', round(fatura.aberta, 2),
    'commitments_v1', round(rec.v + div.v + fatura.aberta, 2),
    'commitments_v2_current', round(rec.v + div.v + parc.atual_abertas, 2),
    'commitments_v2_next', round(rec.v + div.v + parc.proximo_agendadas, 2),
    'ratio_v1_pct', CASE WHEN renda.media > 0 THEN round(100 * (rec.v + div.v + fatura.aberta) / renda.media, 1) END,
    'ratio_v2_current_pct', CASE WHEN renda.media > 0 THEN round(100 * (rec.v + div.v + parc.atual_abertas) / renda.media, 1) END,
    'ratio_v2_next_pct', CASE WHEN renda.media > 0 THEN round(100 * (rec.v + div.v + parc.proximo_agendadas) / renda.media, 1) END,
    'schedule_coverage', CASE WHEN parc.proximo_n + parc.proximo_canceladas_n = 0 THEN 'none' ELSE 'from_uploaded_statements' END
  )
  FROM renda, rec, div, parc, fatura;
$function$;

REVOKE ALL ON FUNCTION public.nino_commitments_shadow(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_commitments_shadow(uuid, date) TO service_role;
