-- Parcela que vence HOJE não está em atraso (atraso = vencimento antes de hoje).
-- Remenda debt_obligation_state sobre a definição aplicada, de forma idempotente.
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.debt_obligation_state(uuid,date,integer)'::regprocedure);
  IF position('v_expected - v_covered - case when v_expected > 0' IN d) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  n := replace(d,
    'v_overdue := greatest(0, v_expected - v_covered);',
    'v_overdue := greatest(0, v_expected - v_covered - case when v_expected > 0 and public.civil_add_months(v_anchor, v_expected - 1) = _as_of then 1 else 0 end);');
  n := replace(n,
    'if public.civil_add_months(v_anchor, v_covered) <= _as_of and v_ovr_due > _as_of then',
    'if public.civil_add_months(v_anchor, v_covered) < _as_of and v_ovr_due >= _as_of then');
  n := replace(n,
    'elsif public.civil_add_months(v_anchor, v_covered) > _as_of and v_ovr_due <= _as_of then',
    'elsif public.civil_add_months(v_anchor, v_covered) >= _as_of and v_ovr_due < _as_of then');
  n := replace(n,
    'when v_overdue > 0 and v_ovr_due is not null and v_ovr_due <= _as_of then v_ovr_due',
    'when v_overdue > 0 and v_ovr_due is not null and v_ovr_due < _as_of then v_ovr_due');
  IF n = d THEN
    RAISE EXCEPTION 'debt_obligation_state: trechos nao encontrados';
  END IF;
  EXECUTE n;
END $$;
