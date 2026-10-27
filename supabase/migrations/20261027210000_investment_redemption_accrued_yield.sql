-- Resgate que inclui rendimento acumulado.
--
-- A posição guarda o valor aplicado/estimado; o banco devolve principal + rendimento.
-- Um resgate até 10% acima da posição é o resgate total com rendimento (o principal inteiro sai e
-- a posição zera). Acima disso continua em `pending_reconciliation` (âncora desatualizada, ativo
-- errado etc.), sem zerar patrimônio em silêncio.
DO $$
DECLARE
  d text;
  n text;
BEGIN
  d := pg_get_functiondef('public.tf_transactions_investment_link'::regproc);
  IF position('NOT (COALESCE(v_current, 0) > 0 AND v_row.amount <= v_current * 1.10)' IN d) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  n := replace(d,
    'IF v_row.amount > COALESCE(v_current, 0) + 0.01 THEN',
    'IF v_row.amount > COALESCE(v_current, 0) + 0.01 AND NOT (COALESCE(v_current, 0) > 0 AND v_row.amount <= v_current * 1.10) THEN');
  IF n = d THEN
    RAISE EXCEPTION 'tf_transactions_investment_link: trecho nao encontrado';
  END IF;
  EXECUTE n;
END $$;
