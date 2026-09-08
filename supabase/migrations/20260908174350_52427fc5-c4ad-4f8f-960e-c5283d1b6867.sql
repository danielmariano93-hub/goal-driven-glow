-- =====================================================================
-- Divisão do Rolê parcelada (split_receivables.v1)
-- Verdade canônica: DIVISÃO → PARTICIPANTE → PARCELA → PAGAMENTO.
-- Status de liquidação é persistido (pending/partial/paid/cancelled);
-- "overdue" é derivado da data civil na leitura única, para nunca ficar
-- obsoleto. Toda superfície (UI, Nino, lembretes, contabilidade) lê a view.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.shared_expense_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_expense_id uuid NOT NULL REFERENCES public.shared_expenses(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.shared_expense_participants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  installment_number integer NOT NULL CHECK (installment_number > 0),
  total_installments integer NOT NULL CHECK (total_installments > 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  due_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','cancelled')),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  paid_at timestamptz,
  payment_reference text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, installment_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_expense_installments TO authenticated;
GRANT ALL ON public.shared_expense_installments TO service_role;
ALTER TABLE public.shared_expense_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manages split installments" ON public.shared_expense_installments;
CREATE POLICY "owner manages split installments"
  ON public.shared_expense_installments FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "participant reads own installments" ON public.shared_expense_installments;
CREATE POLICY "participant reads own installments"
  ON public.shared_expense_installments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shared_expense_participants p
     WHERE p.id = shared_expense_installments.participant_id
       AND p.linked_user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS split_installments_expense_idx
  ON public.shared_expense_installments(shared_expense_id, participant_id, installment_number);
CREATE INDEX IF NOT EXISTS split_installments_due_idx
  ON public.shared_expense_installments(owner_user_id, due_date)
  WHERE status IN ('pending','partial');

CREATE TABLE IF NOT EXISTS public.shared_expense_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_expense_id uuid NOT NULL REFERENCES public.shared_expenses(id) ON DELETE CASCADE,
  installment_id uuid NOT NULL REFERENCES public.shared_expense_installments(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.shared_expense_participants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  transaction_id uuid,
  reference text,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_expense_payments TO authenticated;
GRANT ALL ON public.shared_expense_payments TO service_role;
ALTER TABLE public.shared_expense_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manages split payments" ON public.shared_expense_payments;
CREATE POLICY "owner manages split payments"
  ON public.shared_expense_payments FOR ALL TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "participant reads own payments" ON public.shared_expense_payments;
CREATE POLICY "participant reads own payments"
  ON public.shared_expense_payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shared_expense_participants p
     WHERE p.id = shared_expense_payments.participant_id
       AND p.linked_user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS split_payments_installment_idx
  ON public.shared_expense_payments(installment_id) WHERE reversed_at IS NULL;

CREATE TRIGGER split_installments_touch
  BEFORE UPDATE ON public.shared_expense_installments
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ---------------------------------------------------------------------
-- Estado derivado da parcela (única definição de "atrasada")
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.split_installment_state(
  p_status text, p_due_date date, p_amount numeric, p_paid numeric)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_status = 'cancelled' THEN 'cancelled'
    WHEN coalesce(p_paid,0) >= coalesce(p_amount,0) THEN 'paid'
    WHEN p_due_date IS NOT NULL AND p_due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'overdue'
    WHEN coalesce(p_paid,0) > 0 THEN 'partial'
    ELSE 'pending'
  END
$$;

-- ---------------------------------------------------------------------
-- Recálculo em cascata: pagamento → parcela → participante → divisão
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.split_recalc_installment(p_installment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inst record;
  v_paid numeric;
  v_last timestamptz;
  v_status text;
  p_total_due numeric;
  p_total_paid numeric;
  v_all_paid boolean;
BEGIN
  SELECT * INTO inst FROM public.shared_expense_installments WHERE id = p_installment_id FOR UPDATE;
  IF inst.id IS NULL THEN RETURN; END IF;

  SELECT coalesce(sum(amount),0), max(paid_at)
    INTO v_paid, v_last
    FROM public.shared_expense_payments
   WHERE installment_id = inst.id AND reversed_at IS NULL;

  v_paid := least(v_paid, inst.amount);
  v_status := CASE
    WHEN inst.status = 'cancelled' THEN 'cancelled'
    WHEN v_paid >= inst.amount AND inst.amount > 0 THEN 'paid'
    WHEN v_paid > 0 THEN 'partial'
    ELSE 'pending' END;

  UPDATE public.shared_expense_installments
     SET paid_amount = v_paid,
         status = v_status,
         paid_at = CASE WHEN v_status = 'paid' THEN coalesce(v_last, now()) ELSE NULL END,
         updated_at = now()
   WHERE id = inst.id;

  -- Participante: soma das parcelas não canceladas
  SELECT coalesce(sum(amount),0), coalesce(sum(paid_amount),0)
    INTO p_total_due, p_total_paid
    FROM public.shared_expense_installments
   WHERE participant_id = inst.participant_id AND status <> 'cancelled';

  UPDATE public.shared_expense_participants
     SET amount_paid = p_total_paid,
         status = (CASE
           WHEN p_total_due > 0 AND p_total_paid >= p_total_due THEN 'paid'
           WHEN p_total_paid > 0 THEN 'partial'
           ELSE (CASE WHEN status IN ('notified','opted_out','waived') THEN status::text ELSE 'pending' END)
         END)::participant_status,
         paid_at = CASE WHEN p_total_due > 0 AND p_total_paid >= p_total_due THEN coalesce(paid_at, now()) ELSE NULL END,
         updated_at = now()
   WHERE id = inst.participant_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.shared_expense_installments
     WHERE shared_expense_id = inst.shared_expense_id
       AND status IN ('pending','partial')
  ) INTO v_all_paid;

  UPDATE public.shared_expenses
     SET status = (CASE WHEN v_all_paid THEN 'settled' ELSE 'active' END)::split_status,
         updated_at = now()
   WHERE id = inst.shared_expense_id
     AND status IN ('active','settled');
END;
$$;

CREATE OR REPLACE FUNCTION public.split_payments_recalc_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.split_recalc_installment(coalesce(NEW.installment_id, OLD.installment_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS split_payments_recalc ON public.shared_expense_payments;
CREATE TRIGGER split_payments_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.shared_expense_payments
  FOR EACH ROW EXECUTE FUNCTION public.split_payments_recalc_trigger();

-- ---------------------------------------------------------------------
-- Leitura única de recebíveis
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.split_receivables_v1
WITH (security_invoker = true) AS
SELECT
  i.id                AS installment_id,
  i.shared_expense_id,
  i.participant_id,
  i.owner_user_id,
  se.title,
  se.status           AS split_status,
  se.deleted_at,
  se.reminder_enabled,
  se.pix_key,
  p.name              AS participant_name,
  p.phone_e164,
  p.linked_user_id,
  p.opt_out_at,
  i.installment_number,
  i.total_installments,
  i.amount,
  i.paid_amount,
  greatest(i.amount - i.paid_amount, 0) AS balance_due,
  i.due_date,
  i.status            AS settlement_status,
  public.split_installment_state(i.status, i.due_date, i.amount, i.paid_amount) AS state,
  i.paid_at,
  CASE WHEN i.status = 'cancelled' OR greatest(i.amount - i.paid_amount, 0) = 0 THEN 0
       ELSE greatest(i.amount - i.paid_amount, 0) END AS expected_receivable,
  i.paid_amount       AS received_receivable
FROM public.shared_expense_installments i
JOIN public.shared_expense_participants p ON p.id = i.participant_id
JOIN public.shared_expenses se ON se.id = i.shared_expense_id;

GRANT SELECT ON public.split_receivables_v1 TO authenticated;
GRANT SELECT ON public.split_receivables_v1 TO service_role;

-- ---------------------------------------------------------------------
-- Backfill idempotente: à vista = 1 parcela
-- ---------------------------------------------------------------------
INSERT INTO public.shared_expense_installments(
  shared_expense_id, participant_id, owner_user_id, installment_number,
  total_installments, amount, due_date, status, paid_amount, paid_at, created_at)
SELECT p.shared_expense_id, p.id, p.owner_user_id, 1, 1,
       coalesce(p.amount_due, 0), se.due_date,
       CASE WHEN coalesce(p.amount_paid,0) >= coalesce(p.amount_due,0) AND coalesce(p.amount_due,0) > 0 THEN 'paid'
            WHEN coalesce(p.amount_paid,0) > 0 THEN 'partial'
            ELSE 'pending' END,
       least(coalesce(p.amount_paid,0), coalesce(p.amount_due,0)),
       p.paid_at, coalesce(p.created_at, now())
  FROM public.shared_expense_participants p
  JOIN public.shared_expenses se ON se.id = p.shared_expense_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.shared_expense_installments i WHERE i.participant_id = p.id
 );

INSERT INTO public.shared_expense_payments(
  shared_expense_id, installment_id, participant_id, owner_user_id,
  amount, paid_at, reference, created_at)
SELECT i.shared_expense_id, i.id, i.participant_id, i.owner_user_id,
       i.paid_amount, coalesce(i.paid_at, i.created_at), 'backfill:legacy_participant_total', now()
  FROM public.shared_expense_installments i
 WHERE i.paid_amount > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.shared_expense_payments sp WHERE sp.installment_id = i.id
   );
