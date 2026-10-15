-- Mensagens do diagnóstico saíam com "R$ 1,316.16" (to_char em locale inglês) e a dívida atrasada vinha sem nome
-- e com "1 dias". Usa o formatador pt-BR do próprio diagnóstico, nomeia a dívida e acerta o plural.
DO $$
DECLARE
  d1 text; n1 text; d2 text; n2 text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d1 FROM pg_proc p WHERE p.proname = 'nino_evaluate_future_situations';
  n1 := replace(d1, 'R$ ''||to_char(r.amount,''FM999G999G999D00'')', '''||public.nino_diag_brl(r.amount)');
  IF n1 = d1 THEN RAISE EXCEPTION 'sem alteracao em nino_evaluate_future_situations'; END IF;
  EXECUTE n1;

  SELECT pg_get_functiondef(p.oid) INTO d2 FROM pg_proc p WHERE p.proname = 'nino_diag_detect_debt_alerts';
  n2 := replace(d2, '''A parcela de '' || public.nino_diag_brl(r.installment_amount) ||', '''A parcela de '' || r.name || '' ('' || public.nino_diag_brl(r.installment_amount) || '')'' ||');
  n2 := replace(n2, ''' e nenhum pagamento foi registrado ('' || v_days || '' dias).''', ''' e não há pagamento registrado ('' || v_days || case when v_days = 1 then '' dia'' else '' dias'' end || '' de atraso).''');
  IF n2 = d2 THEN RAISE EXCEPTION 'sem alteracao em nino_diag_detect_debt_alerts'; END IF;
  EXECUTE n2;
END $$;
