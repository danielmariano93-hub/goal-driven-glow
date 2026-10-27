-- Antecipação de parcelas (`installment_anticipation.v1`).
--
-- Pagar uma parcela antes do vencimento é liquidação de dívida, não consumo do mês.
-- A fatura continua mostrando a parcela na competência em que foi COBRADA
-- (`competence_date`: reconciliação, exposição de cartão, fatura); os indicadores de
-- consumo passam a usar `economic_competence_date` = a competência em que a parcela
-- venceria no cronograma original. Nada de dinheiro some: o gasto fica no mês certo.
--
-- Detecção: dentro do grupo da compra, a parcela de menor número é a âncora e a
-- competência natural da parcela k é âncora + (k − k_âncora) meses. Se foi cobrada
-- antes disso, é antecipada.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS economic_competence_date date,
  ADD COLUMN IF NOT EXISTS installment_anticipated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.transactions.economic_competence_date IS
  'Competência econômica da parcela antecipada (mês em que venceria). NULL = igual a competence_date.';
COMMENT ON COLUMN public.transactions.installment_anticipated IS
  'Parcela cobrada antes da competência natural do cronograma (liquidação antecipada de dívida).';

CREATE OR REPLACE FUNCTION public.refresh_installment_anticipation(p_user uuid, p_group uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user IS NULL OR p_group IS NULL THEN RETURN; END IF;

  WITH g AS (
    SELECT id, installment_number AS k, competence_date AS c
      FROM public.transactions
     WHERE user_id = p_user AND purchase_group_id = p_group
       AND credit_card_id IS NOT NULL AND coalesce(installments_total, 0) > 1
       AND status = 'confirmed' AND superseded_by IS NULL
       AND installment_number IS NOT NULL AND competence_date IS NOT NULL
  ), anchor AS (
    SELECT k AS ak, c AS ac FROM g ORDER BY k, c LIMIT 1
  ), calc AS (
    SELECT g.id,
           (a.ac + make_interval(months => g.k - a.ak))::date AS natural_c,
           g.c AS actual_c
      FROM g CROSS JOIN anchor a
  )
  UPDATE public.transactions t
     SET installment_anticipated = (calc.actual_c < calc.natural_c),
         economic_competence_date = CASE WHEN calc.actual_c < calc.natural_c THEN calc.natural_c ELSE NULL END
    FROM calc
   WHERE t.id = calc.id
     AND (t.installment_anticipated IS DISTINCT FROM (calc.actual_c < calc.natural_c)
          OR t.economic_competence_date IS DISTINCT FROM
             (CASE WHEN calc.actual_c < calc.natural_c THEN calc.natural_c ELSE NULL END));
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_refresh_installment_anticipation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_installment_anticipation(OLD.user_id, OLD.purchase_group_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_installment_anticipation(NEW.user_id, NEW.purchase_group_id);
  IF TG_OP = 'UPDATE' AND OLD.purchase_group_id IS DISTINCT FROM NEW.purchase_group_id THEN
    PERFORM public.refresh_installment_anticipation(OLD.user_id, OLD.purchase_group_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_refresh_installment_anticipation ON public.transactions;
DROP TRIGGER IF EXISTS trg_refresh_installment_anticipation_ins ON public.transactions;
DROP TRIGGER IF EXISTS trg_refresh_installment_anticipation_upd ON public.transactions;
DROP TRIGGER IF EXISTS trg_refresh_installment_anticipation_del ON public.transactions;

CREATE TRIGGER trg_refresh_installment_anticipation_ins
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  WHEN (NEW.credit_card_id IS NOT NULL AND coalesce(NEW.installments_total, 0) > 1)
  EXECUTE FUNCTION public.tg_refresh_installment_anticipation();

CREATE TRIGGER trg_refresh_installment_anticipation_upd
  AFTER UPDATE OF competence_date, installment_number, installments_total,
    purchase_group_id, status, superseded_by, credit_card_id
  ON public.transactions
  FOR EACH ROW
  WHEN ((NEW.credit_card_id IS NOT NULL AND coalesce(NEW.installments_total, 0) > 1)
        OR (OLD.credit_card_id IS NOT NULL AND coalesce(OLD.installments_total, 0) > 1))
  EXECUTE FUNCTION public.tg_refresh_installment_anticipation();

CREATE TRIGGER trg_refresh_installment_anticipation_del
  AFTER DELETE ON public.transactions
  FOR EACH ROW
  WHEN (OLD.credit_card_id IS NOT NULL AND coalesce(OLD.installments_total, 0) > 1)
  EXECUTE FUNCTION public.tg_refresh_installment_anticipation();

-- Backfill de todos os grupos existentes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id, purchase_group_id
      FROM public.transactions
     WHERE credit_card_id IS NOT NULL AND coalesce(installments_total, 0) > 1 AND purchase_group_id IS NOT NULL
  LOOP
    PERFORM public.refresh_installment_anticipation(r.user_id, r.purchase_group_id);
  END LOOP;
END $$;
