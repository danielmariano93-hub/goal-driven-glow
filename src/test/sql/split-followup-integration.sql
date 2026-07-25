-- Integration test: valida a trigger de segunda mensagem do rolê.
-- Delegado à função SECURITY DEFINER `public._test_split_followup()` que
-- cria o setup mínimo em auth.users/accounts/shared_expenses/participants,
-- executa as asserções e limpa depois.
--
-- Executar: psql -f src/test/sql/split-followup-integration.sql
-- Espera-se `passed = t` em TODAS as linhas.

SELECT * FROM public._test_split_followup();

DO $$
DECLARE
  v_failed int;
BEGIN
  SELECT count(*) INTO v_failed FROM public._test_split_followup() WHERE NOT passed;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'split followup test failures: %', v_failed;
  END IF;
  RAISE NOTICE 'PASS: split followup asserções verdes';
END $$;
