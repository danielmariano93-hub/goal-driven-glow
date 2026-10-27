-- Previdência via folha: aporte do usuário debitado direto do salário + contrapartida do empregador.
--
-- O aporte vira uma transação `investment_application` (sai da conta; o gatilho de investimentos
-- atualiza a posição). A contrapartida NÃO passa pela conta: soma ao valor atual da posição e é
-- guardada à parte (`employer_match_total`), para não contar como poupança do usuário.
-- `employer_vested_pct` = fatia da contrapartida que o usuário tem direito em resgate antecipado.

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS payroll_contribution_amount numeric(14,2) CHECK (payroll_contribution_amount IS NULL OR payroll_contribution_amount > 0),
  ADD COLUMN IF NOT EXISTS payroll_day smallint CHECK (payroll_day IS NULL OR payroll_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS payroll_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employer_match_ratio numeric(6,4) NOT NULL DEFAULT 0 CHECK (employer_match_ratio >= 0),
  ADD COLUMN IF NOT EXISTS employer_vested_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK (employer_vested_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS employer_match_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (employer_match_total >= 0);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS payroll_income_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.transactions.payroll_income_transaction_id IS
  'Aporte descontado em folha: entrada de salário da qual o valor foi descontado.';

-- Contrapartida automática: cada aplicação efetivamente aplicada à posição gera ratio × valor.
CREATE OR REPLACE FUNCTION public.tf_investment_employer_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ratio numeric;
  v_match numeric;
  v_row public.investment_movements%ROWTYPE;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF v_row.kind <> 'application' OR v_row.applied IS NOT TRUE THEN RETURN v_row; END IF;
  SELECT employer_match_ratio INTO v_ratio FROM public.investments WHERE id = v_row.investment_id;
  IF coalesce(v_ratio, 0) <= 0 THEN RETURN v_row; END IF;
  v_match := round(v_row.amount * v_ratio, 2);
  IF TG_OP = 'DELETE' THEN
    UPDATE public.investments
       SET current_value = GREATEST(0, current_value - v_match),
           employer_match_total = GREATEST(0, employer_match_total - v_match)
     WHERE id = v_row.investment_id;
  ELSE
    UPDATE public.investments
       SET current_value = current_value + v_match,
           employer_match_total = employer_match_total + v_match
     WHERE id = v_row.investment_id;
  END IF;
  RETURN v_row;
END $function$;

DROP TRIGGER IF EXISTS trg_investment_employer_match_ins ON public.investment_movements;
DROP TRIGGER IF EXISTS trg_investment_employer_match_del ON public.investment_movements;
CREATE TRIGGER trg_investment_employer_match_ins
  AFTER INSERT ON public.investment_movements
  FOR EACH ROW EXECUTE FUNCTION public.tf_investment_employer_match();
CREATE TRIGGER trg_investment_employer_match_del
  AFTER DELETE ON public.investment_movements
  FOR EACH ROW EXECUTE FUNCTION public.tf_investment_employer_match();

-- Geração mensal do aporte: idempotente por (investimento, mês) via external_id.
CREATE OR REPLACE FUNCTION public.generate_payroll_contributions(p_today date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_due date;
  v_ext text;
  v_cat uuid;
  v_income uuid;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT i.id, i.user_id, i.name, i.payroll_contribution_amount AS amt, i.payroll_day AS d, i.payroll_account_id AS acc
      FROM public.investments i
     WHERE i.payroll_contribution_amount > 0 AND i.payroll_day IS NOT NULL AND i.payroll_account_id IS NOT NULL
  LOOP
    v_due := make_date(extract(year FROM p_today)::int, extract(month FROM p_today)::int, 1)
             + (LEAST(r.d, extract(day FROM (date_trunc('month', p_today) + interval '1 month - 1 day'))::int) - 1);
    IF v_due > p_today THEN CONTINUE; END IF;
    v_ext := 'payroll:' || r.id || ':' || to_char(v_due, 'YYYY-MM');
    IF EXISTS (SELECT 1 FROM public.transactions WHERE user_id = r.user_id AND external_id = v_ext) THEN CONTINUE; END IF;
    SELECT id INTO v_cat FROM public.categories
     WHERE type = 'expense' AND archived_at IS NULL AND (user_id = r.user_id OR user_id IS NULL)
       AND lower(name) = 'aplicações'
     ORDER BY (user_id IS NULL) LIMIT 1;
    SELECT t.id INTO v_income FROM public.transactions t
     WHERE t.user_id = r.user_id AND t.type = 'income' AND t.status = 'confirmed'
       AND coalesce(t.movement_kind, 'transaction') = 'transaction'
       AND t.occurred_at BETWEEN v_due - 5 AND v_due + 5
     ORDER BY t.amount DESC LIMIT 1;
    INSERT INTO public.transactions
      (user_id, type, status, amount, occurred_at, origin, payment_method, movement_kind,
       account_id, category_id, description, notes, external_id, investment_id, payroll_income_transaction_id)
    VALUES
      (r.user_id, 'expense', 'confirmed', r.amt, v_due, 'recurring', 'account', 'investment_application',
       r.acc, v_cat, 'Aporte ' || r.name || ' (folha)', 'Descontado direto da folha de pagamento', v_ext, r.id, v_income);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE ALL ON FUNCTION public.generate_payroll_contributions(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_payroll_contributions(date) TO service_role;
REVOKE ALL ON FUNCTION public.tf_investment_employer_match() FROM public, anon, authenticated;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payroll-contributions') THEN
    PERFORM cron.unschedule('payroll-contributions');
  END IF;
  PERFORM cron.schedule('payroll-contributions', '10 9 * * *', 'select public.generate_payroll_contributions();');
END
$do$;
