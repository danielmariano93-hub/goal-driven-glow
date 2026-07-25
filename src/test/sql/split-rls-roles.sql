-- SQL test: RLS por papel no rolê (owner/participant/outsider).
-- RLS avalia auth.uid() a partir do JWT claim; usuários não precisam existir em auth.users.
-- Executar: psql -f src/test/sql/split-rls-roles.sql
BEGIN;
SET LOCAL role = authenticated;
DO $$
DECLARE v_owner uuid := gen_random_uuid(); v_part uuid := gen_random_uuid(); v_out uuid := gen_random_uuid();
        v_exp uuid := gen_random_uuid();
BEGIN
  -- Bypass RLS via superuser role for setup
  SET LOCAL role = postgres;
  INSERT INTO public.shared_expenses(id,owner_user_id,title,total_amount,occurred_at,status)
  VALUES (v_exp,v_owner,'RLS Test',100,current_date,'active');
  INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,amount_due,linked_user_id)
  VALUES (v_exp,v_owner,'Part',50,v_part);

  SET LOCAL role = authenticated;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text,'role','authenticated')::text, true);
  ASSERT (SELECT count(*) FROM public.shared_expenses WHERE id=v_exp)=1, 'owner must see split';

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_part::text,'role','authenticated')::text, true);
  ASSERT (SELECT count(*) FROM public.shared_expenses WHERE id=v_exp)=1, 'participant must see split';
  ASSERT (SELECT count(*) FROM public.shared_expense_participants WHERE shared_expense_id=v_exp)=1, 'participant sees own row';

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_out::text,'role','authenticated')::text, true);
  ASSERT (SELECT count(*) FROM public.shared_expenses WHERE id=v_exp)=0, 'outsider must NOT see split';
  ASSERT (SELECT count(*) FROM public.shared_expense_participants WHERE shared_expense_id=v_exp)=0, 'outsider must NOT see participants';

  RAISE NOTICE 'PASS: RLS role matrix ok (owner=1, participant=1, outsider=0) for %', v_exp;
END $$;
ROLLBACK;
