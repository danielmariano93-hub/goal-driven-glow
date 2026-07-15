
-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public.split_mode AS ENUM ('equal','custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.split_status AS ENUM ('draft','active','settled','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.participant_status AS ENUM ('pending','notified','partial','paid','waived','opted_out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reminder_status AS ENUM ('queued','sent','failed','skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.recurring_frequency AS ENUM ('daily','weekly','monthly','yearly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.recurring_status AS ENUM ('active','paused','finished');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.occurrence_status AS ENUM ('planned','confirmed','skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.challenge_kind AS ENUM ('spending_log','goal_contribution','emotion_checkin','pre_spend_review','custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_challenge_status AS ENUM ('active','paused','completed','abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM ('agent_confirmation','recurrence_due','goal_reached','split_reminder','import_done','achievement','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.txn_origin AS ENUM ('manual','agent','import','recurring','split');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend transactions with origin
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS origin public.txn_origin NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS import_source_id text;

CREATE INDEX IF NOT EXISTS idx_transactions_import_source ON public.transactions(user_id, import_source_id) WHERE import_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emo_checkins_user_time ON public.emotional_checkins(user_id, occurred_at DESC);

-- Utility trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ============ SHARED EXPENSES ============
CREATE TABLE IF NOT EXISTS public.shared_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  occurred_at date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  split_mode public.split_mode NOT NULL DEFAULT 'equal',
  linked_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  reminder_enabled boolean NOT NULL DEFAULT false,
  status public.split_status NOT NULL DEFAULT 'draft',
  pix_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_expenses TO authenticated;
GRANT ALL ON public.shared_expenses TO service_role;
ALTER TABLE public.shared_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages splits" ON public.shared_expenses FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
DROP TRIGGER IF EXISTS trg_shared_expenses_updated ON public.shared_expenses;
CREATE TRIGGER trg_shared_expenses_updated BEFORE UPDATE ON public.shared_expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.shared_expense_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_expense_id uuid NOT NULL REFERENCES public.shared_expenses(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  name text NOT NULL,
  phone_e164 text,
  phone_masked text,
  amount_due numeric(14,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status public.participant_status NOT NULL DEFAULT 'pending',
  last_reminded_at timestamptz,
  reminder_count int NOT NULL DEFAULT 0,
  paid_at timestamptz,
  opt_out_token text UNIQUE,
  opt_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_expense_participants TO authenticated;
GRANT ALL ON public.shared_expense_participants TO service_role;
ALTER TABLE public.shared_expense_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages participants" ON public.shared_expense_participants FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
DROP TRIGGER IF EXISTS trg_sep_updated ON public.shared_expense_participants;
CREATE TRIGGER trg_sep_updated BEFORE UPDATE ON public.shared_expense_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_sep_owner ON public.shared_expense_participants(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_sep_expense ON public.shared_expense_participants(shared_expense_id);

CREATE TABLE IF NOT EXISTS public.shared_expense_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_expense_id uuid NOT NULL REFERENCES public.shared_expenses(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  participant_id uuid REFERENCES public.shared_expense_participants(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_expense_events TO authenticated;
GRANT ALL ON public.shared_expense_events TO service_role;
ALTER TABLE public.shared_expense_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads events" ON public.shared_expense_events FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
CREATE POLICY "owner writes events" ON public.shared_expense_events FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.reminder_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  shared_expense_id uuid NOT NULL REFERENCES public.shared_expenses(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.shared_expense_participants(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status public.reminder_status NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  outbound_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_jobs TO authenticated;
GRANT ALL ON public.reminder_jobs TO service_role;
ALTER TABLE public.reminder_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads jobs" ON public.reminder_jobs FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
DROP TRIGGER IF EXISTS trg_rj_updated ON public.reminder_jobs;
CREATE TRIGGER trg_rj_updated BEFORE UPDATE ON public.reminder_jobs FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============ RECURRING ============
CREATE TABLE IF NOT EXISTS public.recurring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.transaction_type NOT NULL,
  name text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  frequency public.recurring_frequency NOT NULL DEFAULT 'monthly',
  day_of_month smallint CHECK (day_of_month BETWEEN 1 AND 31),
  weekday smallint CHECK (weekday BETWEEN 0 AND 6),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  status public.recurring_status NOT NULL DEFAULT 'active',
  last_generated_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_rules TO authenticated;
GRANT ALL ON public.recurring_rules TO service_role;
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user manages rules" ON public.recurring_rules FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP TRIGGER IF EXISTS trg_rr_updated ON public.recurring_rules;
CREATE TRIGGER trg_rr_updated BEFORE UPDATE ON public.recurring_rules FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.recurring_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_rule_id uuid NOT NULL REFERENCES public.recurring_rules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  due_date date NOT NULL,
  status public.occurrence_status NOT NULL DEFAULT 'planned',
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recurring_rule_id, due_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_occurrences TO authenticated;
GRANT ALL ON public.recurring_occurrences TO service_role;
ALTER TABLE public.recurring_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user manages occurrences" ON public.recurring_occurrences FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP TRIGGER IF EXISTS trg_ro_updated ON public.recurring_occurrences;
CREATE TRIGGER trg_ro_updated BEFORE UPDATE ON public.recurring_occurrences FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_ro_user_due ON public.recurring_occurrences(user_id, due_date);

-- ============ CHALLENGES / GAMIFICATION ============
CREATE TABLE IF NOT EXISTS public.challenges_catalog (
  slug text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  kind public.challenge_kind NOT NULL,
  goal_value int NOT NULL DEFAULT 1,
  duration_days int NOT NULL DEFAULT 7,
  xp_reward int NOT NULL DEFAULT 50,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.challenges_catalog TO authenticated;
GRANT ALL ON public.challenges_catalog TO service_role;
ALTER TABLE public.challenges_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read active challenges" ON public.challenges_catalog FOR SELECT TO authenticated USING (active = true OR public.is_current_user_admin());
CREATE POLICY "admin manages challenges" ON public.challenges_catalog FOR ALL TO authenticated
  USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());

INSERT INTO public.challenges_catalog(slug,title,description,kind,goal_value,duration_days,xp_reward) VALUES
  ('registrar-7-dias','Registrar gastos por 7 dias','Anote pelo menos uma despesa por dia durante 7 dias.','spending_log',7,7,70),
  ('aportar-meta','Aportar em uma meta','Faça um aporte em qualquer meta esta semana.','goal_contribution',1,7,40),
  ('checkin-emocional','Check-in emocional diário','Registre como você se sentiu em 5 dias.','emotion_checkin',5,7,50),
  ('antes-de-gastar','Simular antes de gastar','Use o simulador Antes de Gastar 3 vezes.','pre_spend_review',3,14,60)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge_slug text NOT NULL REFERENCES public.challenges_catalog(slug) ON DELETE CASCADE,
  status public.user_challenge_status NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  current_progress int NOT NULL DEFAULT 0,
  streak_count int NOT NULL DEFAULT 0,
  last_progress_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, challenge_slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_challenges TO authenticated;
GRANT ALL ON public.user_challenges TO service_role;
ALTER TABLE public.user_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own challenges" ON public.user_challenges FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user joins own challenges" ON public.user_challenges FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "user updates own status only" ON public.user_challenges FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP TRIGGER IF EXISTS trg_uc_updated ON public.user_challenges;
CREATE TRIGGER trg_uc_updated BEFORE UPDATE ON public.user_challenges FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.xp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id text NOT NULL,
  xp_delta int NOT NULL,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, source_type, source_id)
);
GRANT SELECT ON public.xp_events TO authenticated;
GRANT ALL ON public.xp_events TO service_role;
ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own xp" ON public.xp_events FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.user_gamification (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_xp int NOT NULL DEFAULT 0,
  level int NOT NULL DEFAULT 1,
  current_streak int NOT NULL DEFAULT 0,
  longest_streak int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_gamification TO authenticated;
GRANT ALL ON public.user_gamification TO service_role;
ALTER TABLE public.user_gamification ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own gamification" ON public.user_gamification FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.notification_type NOT NULL,
  title text NOT NULL,
  body text,
  action_url text,
  dedup_key text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, dedup_key)
);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own notifications" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user marks own read" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_confirmation boolean NOT NULL DEFAULT true,
  recurrence_due boolean NOT NULL DEFAULT true,
  goal_reached boolean NOT NULL DEFAULT true,
  split_reminder boolean NOT NULL DEFAULT true,
  import_done boolean NOT NULL DEFAULT true,
  achievement boolean NOT NULL DEFAULT true,
  system boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user manages own prefs" ON public.notification_preferences FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============ USER REQUESTS ============
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
GRANT SELECT, INSERT ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user manages own deletion" ON public.account_deletion_requests FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============ FUNCTIONS ============
CREATE OR REPLACE FUNCTION public.split_create(
  p_title text, p_total numeric, p_occurred_at date, p_due_date date,
  p_split_mode public.split_mode, p_include_owner boolean,
  p_reminder_enabled boolean, p_pix_key text,
  p_participants jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
  n_participants int;
  base_cents bigint;
  total_cents bigint;
  remainder bigint;
  it jsonb;
  amt numeric;
  sum_custom numeric := 0;
  idx int := 0;
  extra_cent int;
  owner_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_total IS NULL OR p_total <= 0 THEN RAISE EXCEPTION 'invalid total'; END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'invalid title'; END IF;

  n_participants := jsonb_array_length(coalesce(p_participants,'[]'::jsonb)) + CASE WHEN p_include_owner THEN 1 ELSE 0 END;
  IF n_participants < 1 THEN RAISE EXCEPTION 'no participants'; END IF;

  IF p_split_mode = 'custom' THEN
    FOR it IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      sum_custom := sum_custom + coalesce((it->>'amount_due')::numeric,0);
    END LOOP;
    IF p_include_owner THEN
      sum_custom := sum_custom + coalesce((p_participants->0->>'owner_amount')::numeric, 0);
    END IF;
    IF round(sum_custom,2) <> round(p_total,2) THEN
      RAISE EXCEPTION 'custom sum mismatch: %', sum_custom;
    END IF;
  END IF;

  INSERT INTO public.shared_expenses(owner_user_id,title,description,total_amount,occurred_at,due_date,split_mode,reminder_enabled,status,pix_key)
    VALUES (uid,p_title,NULL,p_total,coalesce(p_occurred_at,CURRENT_DATE),p_due_date,p_split_mode,coalesce(p_reminder_enabled,false),'active',nullif(btrim(coalesce(p_pix_key,'')),''))
    RETURNING id INTO new_id;

  IF p_split_mode = 'equal' THEN
    total_cents := round(p_total * 100)::bigint;
    base_cents := total_cents / n_participants;
    remainder := total_cents - (base_cents * n_participants);
    IF p_include_owner THEN
      SELECT coalesce(display_name,'Você') INTO owner_name FROM public.profiles WHERE id = uid;
      extra_cent := CASE WHEN remainder > 0 THEN 1 ELSE 0 END;
      remainder := GREATEST(remainder - 1, 0);
      INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,amount_due,status,amount_paid,paid_at)
        VALUES (new_id, uid, coalesce(owner_name,'Você'), (base_cents + extra_cent)::numeric/100, 'paid', (base_cents + extra_cent)::numeric/100, now());
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      idx := idx + 1;
      extra_cent := CASE WHEN remainder > 0 THEN 1 ELSE 0 END;
      remainder := GREATEST(remainder - 1, 0);
      INSERT INTO public.shared_expense_participants(
        shared_expense_id,owner_user_id,name,phone_e164,phone_masked,amount_due,opt_out_token
      ) VALUES (
        new_id, uid,
        coalesce(it->>'name','Participante'),
        nullif(it->>'phone_e164',''),
        CASE WHEN it->>'phone_e164' IS NOT NULL THEN regexp_replace(it->>'phone_e164','^(\+\d{2})\d+(\d{4})$','\1****\2') END,
        (base_cents + extra_cent)::numeric/100,
        encode(gen_random_bytes(16),'hex')
      );
    END LOOP;
  ELSE -- custom
    IF p_include_owner THEN
      SELECT coalesce(display_name,'Você') INTO owner_name FROM public.profiles WHERE id = uid;
      amt := coalesce((p_participants->0->>'owner_amount')::numeric, 0);
      INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,amount_due,status,amount_paid,paid_at)
        VALUES (new_id, uid, coalesce(owner_name,'Você'), amt, 'paid', amt, now());
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      INSERT INTO public.shared_expense_participants(
        shared_expense_id,owner_user_id,name,phone_e164,phone_masked,amount_due,opt_out_token
      ) VALUES (
        new_id, uid,
        coalesce(it->>'name','Participante'),
        nullif(it->>'phone_e164',''),
        CASE WHEN it->>'phone_e164' IS NOT NULL THEN regexp_replace(it->>'phone_e164','^(\+\d{2})\d+(\d{4})$','\1****\2') END,
        coalesce((it->>'amount_due')::numeric,0),
        encode(gen_random_bytes(16),'hex')
      );
    END LOOP;
  END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,event_type,payload)
    VALUES (new_id, uid, 'created', jsonb_build_object('total',p_total,'mode',p_split_mode));

  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.split_add_payment(p_participant_id uuid, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; new_paid numeric; new_status public.participant_status;
BEGIN
  SELECT * INTO p FROM public.shared_expense_participants WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND OR p.owner_user_id <> auth.uid() THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  new_paid := p.amount_paid + p_amount;
  IF new_paid > p.amount_due + 0.005 THEN RAISE EXCEPTION 'exceeds_due'; END IF;
  new_status := CASE WHEN new_paid >= p.amount_due - 0.005 THEN 'paid'::public.participant_status ELSE 'partial'::public.participant_status END;
  UPDATE public.shared_expense_participants
    SET amount_paid = new_paid, status = new_status,
        paid_at = CASE WHEN new_status='paid' THEN now() ELSE paid_at END
    WHERE id = p_participant_id;
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,participant_id,event_type,payload)
    VALUES (p.shared_expense_id, auth.uid(), p.id, 'payment', jsonb_build_object('amount',p_amount,'total_paid',new_paid));
  -- settle if all paid
  IF NOT EXISTS (SELECT 1 FROM public.shared_expense_participants
                 WHERE shared_expense_id = p.shared_expense_id AND status NOT IN ('paid','waived','opted_out')) THEN
    UPDATE public.shared_expenses SET status='settled' WHERE id = p.shared_expense_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.split_reverse_payment(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM public.shared_expense_participants WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND OR p.owner_user_id <> auth.uid() THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.shared_expense_participants
    SET amount_paid = 0, status = 'pending', paid_at = NULL
    WHERE id = p_participant_id;
  UPDATE public.shared_expenses SET status='active' WHERE id = p.shared_expense_id AND status='settled';
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,participant_id,event_type,payload)
    VALUES (p.shared_expense_id, auth.uid(), p.id, 'reverse_payment', '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.split_send_reminders(p_shared_expense_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE se record; p record; n int := 0; cur_hour int;
BEGIN
  SELECT * INTO se FROM public.shared_expenses WHERE id = p_shared_expense_id;
  IF NOT FOUND OR se.owner_user_id <> auth.uid() THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT se.reminder_enabled THEN RAISE EXCEPTION 'reminders_disabled'; END IF;
  cur_hour := EXTRACT(hour FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  FOR p IN SELECT * FROM public.shared_expense_participants
           WHERE shared_expense_id = p_shared_expense_id
             AND status IN ('pending','partial','notified')
             AND phone_e164 IS NOT NULL
             AND (last_reminded_at IS NULL OR last_reminded_at < now() - interval '24 hours')
             AND reminder_count < 5
  LOOP
    INSERT INTO public.reminder_jobs(owner_user_id,shared_expense_id,participant_id,scheduled_for,status)
      VALUES (auth.uid(), p_shared_expense_id, p.id,
              CASE WHEN cur_hour BETWEEN 8 AND 21 THEN now() ELSE (date_trunc('day', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '8 hours') AT TIME ZONE 'America/Sao_Paulo' + CASE WHEN cur_hour>=22 THEN interval '1 day' ELSE interval '0' END END,
              'queued');
    UPDATE public.shared_expense_participants
      SET last_reminded_at = now(), reminder_count = reminder_count + 1, status = CASE WHEN status='pending' THEN 'notified' ELSE status END
      WHERE id = p.id;
    n := n + 1;
  END LOOP;
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,event_type,payload)
    VALUES (p_shared_expense_id, auth.uid(), 'reminders_scheduled', jsonb_build_object('count',n));
  RETURN n;
END $$;

-- Recurring generation
CREATE OR REPLACE FUNCTION public.recurring_generate_due(p_horizon_days int DEFAULT 30)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r record; d date; horizon date; last_day int; created int := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  horizon := (now() AT TIME ZONE 'America/Sao_Paulo')::date + p_horizon_days;
  FOR r IN SELECT * FROM public.recurring_rules WHERE user_id = uid AND status = 'active' LOOP
    d := GREATEST(r.start_date, coalesce(r.last_generated_at + 1, r.start_date));
    WHILE d <= horizon AND (r.end_date IS NULL OR d <= r.end_date) LOOP
      -- Snap to matching day for each frequency
      IF r.frequency = 'monthly' AND r.day_of_month IS NOT NULL THEN
        last_day := EXTRACT(day FROM (date_trunc('month',d) + interval '1 month - 1 day'))::int;
        d := date_trunc('month',d)::date + (LEAST(r.day_of_month, last_day) - 1);
      ELSIF r.frequency = 'weekly' AND r.weekday IS NOT NULL THEN
        d := d + ((r.weekday - EXTRACT(dow FROM d)::int + 7) % 7);
      END IF;
      IF d > horizon OR (r.end_date IS NOT NULL AND d > r.end_date) THEN EXIT; END IF;
      INSERT INTO public.recurring_occurrences(recurring_rule_id,user_id,due_date,status)
        VALUES (r.id, uid, d, 'planned')
        ON CONFLICT (recurring_rule_id, due_date) DO NOTHING;
      IF FOUND THEN created := created + 1; END IF;
      -- Advance
      d := CASE r.frequency
        WHEN 'daily' THEN d + 1
        WHEN 'weekly' THEN d + 7
        WHEN 'monthly' THEN (date_trunc('month',d) + interval '1 month')::date
        WHEN 'yearly' THEN (d + interval '1 year')::date
      END;
    END LOOP;
    UPDATE public.recurring_rules SET last_generated_at = horizon WHERE id = r.id;
  END LOOP;
  RETURN created;
END $$;

CREATE OR REPLACE FUNCTION public.recurring_confirm(p_occurrence_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; r record; new_txn uuid;
BEGIN
  SELECT * INTO o FROM public.recurring_occurrences WHERE id = p_occurrence_id FOR UPDATE;
  IF NOT FOUND OR o.user_id <> auth.uid() THEN RAISE EXCEPTION 'not_found'; END IF;
  IF o.status <> 'planned' THEN RAISE EXCEPTION 'not_planned'; END IF;
  SELECT * INTO r FROM public.recurring_rules WHERE id = o.recurring_rule_id;
  INSERT INTO public.transactions(user_id,account_id,category_id,type,status,amount,occurred_at,description,origin)
    VALUES (auth.uid(), r.account_id, r.category_id, r.kind, 'confirmed', r.amount, o.due_date, r.name, 'recurring')
    RETURNING id INTO new_txn;
  UPDATE public.recurring_occurrences SET status='confirmed', transaction_id=new_txn WHERE id = p_occurrence_id;
  RETURN new_txn;
END $$;

CREATE OR REPLACE FUNCTION public.recurring_skip(p_occurrence_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.recurring_occurrences SET status='skipped'
    WHERE id = p_occurrence_id AND user_id = auth.uid() AND status='planned';
END $$;

-- Gamification
CREATE OR REPLACE FUNCTION public.challenge_progress_add(
  p_slug text, p_delta int, p_source_type text, p_source_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  ch record; uc record; xp_awarded int := 0;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  SELECT * INTO ch FROM public.challenges_catalog WHERE slug = p_slug AND active = true;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO uc FROM public.user_challenges WHERE user_id = uid AND challenge_slug = p_slug FOR UPDATE;
  IF NOT FOUND OR uc.status <> 'active' THEN RETURN; END IF;
  -- Idempotent XP event
  BEGIN
    INSERT INTO public.xp_events(user_id, source_type, source_id, xp_delta, reason)
      VALUES (uid, p_source_type, p_source_id, 0, 'challenge_progress');
  EXCEPTION WHEN unique_violation THEN
    RETURN; -- already counted
  END;
  UPDATE public.user_challenges
    SET current_progress = LEAST(current_progress + p_delta, ch.goal_value),
        last_progress_at = now(),
        status = CASE WHEN current_progress + p_delta >= ch.goal_value THEN 'completed'::public.user_challenge_status ELSE status END,
        completed_at = CASE WHEN current_progress + p_delta >= ch.goal_value AND completed_at IS NULL THEN now() ELSE completed_at END
    WHERE id = uc.id;
  IF (uc.current_progress + p_delta) >= ch.goal_value AND uc.status = 'active' THEN
    xp_awarded := ch.xp_reward;
    UPDATE public.xp_events SET xp_delta = xp_awarded, reason = 'challenge_completed'
      WHERE user_id = uid AND source_type = p_source_type AND source_id = p_source_id;
    INSERT INTO public.notifications(user_id,type,title,body,action_url,dedup_key)
      VALUES (uid,'achievement','Desafio concluído!', ch.title, '/app/desafios', 'challenge:'||ch.slug)
      ON CONFLICT (user_id, dedup_key) DO NOTHING;
  END IF;
  INSERT INTO public.user_gamification(user_id, total_xp, level)
    VALUES (uid, xp_awarded, GREATEST(1, floor(sqrt(xp_awarded/100.0))::int))
    ON CONFLICT (user_id) DO UPDATE
      SET total_xp = public.user_gamification.total_xp + xp_awarded,
          level = GREATEST(1, floor(sqrt((public.user_gamification.total_xp + xp_awarded)/100.0))::int),
          updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.join_challenge(p_slug text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.user_challenges(user_id, challenge_slug)
    VALUES (auth.uid(), p_slug)
    ON CONFLICT (user_id, challenge_slug) DO UPDATE SET status='active', updated_at=now()
    RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- Notifications
CREATE OR REPLACE FUNCTION public.notify_upsert(
  p_user_id uuid, p_type public.notification_type, p_dedup_key text,
  p_title text, p_body text, p_action_url text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.notifications(user_id,type,title,body,action_url,dedup_key)
    VALUES (p_user_id,p_type,p_title,p_body,p_action_url,p_dedup_key)
    ON CONFLICT (user_id, dedup_key) DO NOTHING
    RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.notifications SET read_at = now() WHERE user_id = auth.uid() AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Data export & deletion
CREATE OR REPLACE FUNCTION public.user_export_data()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); result jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT jsonb_build_object(
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE id = uid),
    'settings', (SELECT to_jsonb(s) FROM public.user_financial_settings s WHERE user_id = uid),
    'accounts', (SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM public.accounts a WHERE user_id = uid),
    'categories', (SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.categories c WHERE user_id = uid),
    'transactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM public.transactions t WHERE user_id = uid),
    'goals', (SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.goals g WHERE user_id = uid),
    'goal_contributions', (SELECT coalesce(jsonb_agg(to_jsonb(gc)),'[]'::jsonb) FROM public.goal_contributions gc WHERE user_id = uid),
    'debts', (SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) FROM public.debts d WHERE user_id = uid),
    'investments', (SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.investments i WHERE user_id = uid),
    'emotional_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM public.emotional_checkins e WHERE user_id = uid),
    'recurring_rules', (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.recurring_rules r WHERE user_id = uid),
    'shared_expenses', (SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM public.shared_expenses s WHERE owner_user_id = uid),
    'notifications', (SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) FROM public.notifications n WHERE user_id = uid)
  ) INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.user_request_deletion(p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.account_deletion_requests(user_id, reason)
    VALUES (auth.uid(), p_reason) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- Import transactions batch (CSV/OFX)
CREATE OR REPLACE FUNCTION public.import_transactions_batch(p_account_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  it jsonb; ext text; inserted int := 0; skipped int := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = uid) THEN
    RAISE EXCEPTION 'invalid_account';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) LOOP
    ext := 'import:' || coalesce(it->>'external_id',
      md5(p_account_id::text || coalesce(it->>'occurred_at','') || coalesce(it->>'amount','') || coalesce(it->>'description','')));
    IF EXISTS (SELECT 1 FROM public.transactions WHERE user_id = uid AND import_source_id = ext) THEN
      skipped := skipped + 1; CONTINUE;
    END IF;
    INSERT INTO public.transactions(user_id,account_id,type,status,amount,occurred_at,description,origin,import_source_id)
      VALUES (uid, p_account_id,
              CASE WHEN (it->>'amount')::numeric >= 0 THEN 'income'::public.transaction_type ELSE 'expense'::public.transaction_type END,
              'confirmed',
              abs((it->>'amount')::numeric),
              (it->>'occurred_at')::date,
              nullif(it->>'description',''),
              'import', ext);
    inserted := inserted + 1;
  END LOOP;
  RETURN jsonb_build_object('inserted', inserted, 'skipped', skipped);
END $$;
