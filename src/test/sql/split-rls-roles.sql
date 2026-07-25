-- SQL test: RLS por papel no rolê (owner/participant/outsider).
-- Executar com: psql -f src/test/sql/split-rls-roles.sql
BEGIN;
SET LOCAL client_min_messages = WARNING;

-- Fixtures
DO $$
DECLARE v_owner uuid := gen_random_uuid(); v_part uuid := gen_random_uuid(); v_out uuid := gen_random_uuid();
        v_exp uuid;
BEGIN
  -- create three auth users
  INSERT INTO auth.users(id,email) VALUES (v_owner,'o@t.test'),(v_part,'p@t.test'),(v_out,'x@t.test');

  INSERT INTO public.shared_expenses(id,owner_user_id,title,total_amount,occurred_at,status)
  VALUES (gen_random_uuid(),v_owner,'RLS Test',100,current_date,'active')
  RETURNING id INTO v_exp;

  INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,phone_e164,amount_due,linked_user_id)
  VALUES (v_exp,v_owner,'Part',NULL,50,v_part);

  -- AS OWNER: sees the split
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_owner::text)::text, true);
  ASSERT (SELECT count(*) FROM public.shared_expenses WHERE id=v_exp) = 1, 'owner should see split';

  -- AS PARTICIPANT: sees the split
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_part::text)::text, true);
  ASSERT (SELECT count(*) FROM public.shared_expenses WHERE id=v_exp) = 1, 'participant should see split';
  ASSERT (SELECT count(*) FROM public.shared_expense_participants WHERE shared_expense_id=v_exp) = 1, 'participant sees own row';

  -- AS OUTSIDER: sees nothing
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_out::text)::text, true);
  ASSERT (SELECT count(*) FROM public.shared_expenses WHERE id=v_exp) = 0, 'outsider must not see split';
  ASSERT (SELECT count(*) FROM public.shared_expense_participants WHERE shared_expense_id=v_exp) = 0, 'outsider must not see participants';

  RAISE NOTICE 'ALL RLS ROLE ASSERTIONS PASSED for expense %', v_exp;
END $$;

ROLLBACK;
