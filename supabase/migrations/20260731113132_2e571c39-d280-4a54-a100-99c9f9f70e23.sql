-- Contratos administrativos de IA, conhecimento oficial e régua da divisão.
-- Toda mutação é SECURITY DEFINER, validada por permissão e auditável.

CREATE TABLE IF NOT EXISTS public.agent_knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_:-]{3,80}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  category text NOT NULL DEFAULT 'produto',
  content text NOT NULL CHECK (char_length(content) BETWEEN 3 AND 4000),
  source_url text,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_knowledge_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_knowledge_entries FROM anon, authenticated;
GRANT ALL ON public.agent_knowledge_entries TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_configuration_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_configuration_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_configuration_audit FROM anon, authenticated;
GRANT ALL ON public.admin_configuration_audit TO service_role;

INSERT INTO public.agent_knowledge_entries(key,title,category,content,source_url)
VALUES
 ('site_oficial','Site oficial','produto','O site oficial do MeuNino é https://meunino.com.br.','https://meunino.com.br'),
 ('divisao_role','Como funciona a divisão do rolê','produto','Quem criou o rolê informa participantes, valores e vencimento. O Nino envia os lembretes configurados; o pagamento só é reconhecido quando o responsável confirma ou quando houver uma conciliação válida.','https://meunino.com.br'),
 ('seguranca_participante','Privacidade do participante','seguranca','Para participantes não vinculados, responda somente sobre o rolê do próprio telefone: nome do rolê, valor individual, vencimento e instrução de pagamento. Nunca exponha saldo, patrimônio ou outros dados do responsável.',NULL)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.split_reminder_policy (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  due_soon_days_before smallint NOT NULL DEFAULT 1 CHECK (due_soon_days_before BETWEEN 0 AND 30),
  due_today_enabled boolean NOT NULL DEFAULT true,
  first_overdue_days smallint NOT NULL DEFAULT 1 CHECK (first_overdue_days BETWEEN 1 AND 30),
  repeat_every_days smallint NOT NULL DEFAULT 3 CHECK (repeat_every_days BETWEEN 1 AND 30),
  max_overdue_reminders smallint NOT NULL DEFAULT 3 CHECK (max_overdue_reminders BETWEEN 0 AND 10),
  send_hour smallint NOT NULL DEFAULT 9 CHECK (send_hour BETWEEN 0 AND 23),
  pause_on_reply boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.split_reminder_policy(id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.split_reminder_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.split_reminder_policy FROM anon, authenticated;
GRANT ALL ON public.split_reminder_policy TO service_role;

CREATE OR REPLACE FUNCTION public.schedule_split_due_reminders(p_expense_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  cfg public.split_reminder_policy%ROWTYPE;
  v_added integer := 0;
  v_rows integer := 0;
  v_policy_version text;
BEGIN
  SELECT * INTO cfg FROM public.split_reminder_policy WHERE id=1;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN 0; END IF;
  v_policy_version := to_char(cfg.updated_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISS');

  IF cfg.due_soon_days_before > 0 THEN
    INSERT INTO public.reminder_jobs(owner_user_id,shared_expense_id,participant_id,scheduled_for,status,kind,idempotency_key)
    SELECT se.owner_user_id,se.id,p.id,public.split_due_timestamp(se.due_date-cfg.due_soon_days_before,cfg.send_hour),
      'queued'::public.reminder_status,'due_soon',
      format('split:policy:%s:due_soon:%s:%s:%s',v_policy_version,se.id,p.id,se.due_date)
    FROM public.shared_expenses se JOIN public.shared_expense_participants p ON p.shared_expense_id=se.id
    WHERE (p_expense_id IS NULL OR se.id=p_expense_id) AND se.status='active' AND se.deleted_at IS NULL
      AND se.reminder_enabled AND se.due_date IS NOT NULL AND p.status IN ('pending','partial','notified')
      AND p.opt_out_at IS NULL AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
      AND public.split_due_timestamp(se.due_date-cfg.due_soon_days_before,cfg.send_hour)>now()
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows=ROW_COUNT; v_added:=v_added+v_rows;
  END IF;

  IF cfg.due_today_enabled THEN
    INSERT INTO public.reminder_jobs(owner_user_id,shared_expense_id,participant_id,scheduled_for,status,kind,idempotency_key)
    SELECT se.owner_user_id,se.id,p.id,public.split_due_timestamp(se.due_date,cfg.send_hour),
      'queued'::public.reminder_status,'due_today',
      format('split:policy:%s:due_today:%s:%s:%s',v_policy_version,se.id,p.id,se.due_date)
    FROM public.shared_expenses se JOIN public.shared_expense_participants p ON p.shared_expense_id=se.id
    WHERE (p_expense_id IS NULL OR se.id=p_expense_id) AND se.status='active' AND se.deleted_at IS NULL
      AND se.reminder_enabled AND se.due_date IS NOT NULL AND p.status IN ('pending','partial','notified')
      AND p.opt_out_at IS NULL AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
      AND public.split_due_timestamp(se.due_date,cfg.send_hour)>now()
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows=ROW_COUNT; v_added:=v_added+v_rows;
  END IF;

  IF cfg.max_overdue_reminders > 0 THEN
    INSERT INTO public.reminder_jobs(owner_user_id,shared_expense_id,participant_id,scheduled_for,status,kind,idempotency_key)
    SELECT se.owner_user_id,se.id,p.id,
      public.split_due_timestamp(se.due_date+cfg.first_overdue_days+((stage.n-1)*cfg.repeat_every_days),cfg.send_hour),
      'queued'::public.reminder_status,'overdue',
      format('split:policy:%s:overdue:%s:%s:%s:%s',v_policy_version,se.id,p.id,se.due_date,stage.n)
    FROM public.shared_expenses se JOIN public.shared_expense_participants p ON p.shared_expense_id=se.id
    CROSS JOIN generate_series(1,cfg.max_overdue_reminders) AS stage(n)
    WHERE (p_expense_id IS NULL OR se.id=p_expense_id) AND se.status='active' AND se.deleted_at IS NULL
      AND se.reminder_enabled AND se.due_date IS NOT NULL AND p.status IN ('pending','partial','notified')
      AND p.opt_out_at IS NULL AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
      AND public.split_due_timestamp(se.due_date+cfg.first_overdue_days+((stage.n-1)*cfg.repeat_every_days),cfg.send_hour)>now()
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_rows=ROW_COUNT; v_added:=v_added+v_rows;
  END IF;
  RETURN v_added;
END $$;
REVOKE ALL ON FUNCTION public.schedule_split_due_reminders(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_split_due_reminders(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ai_model_routes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_platform_permission('operations.read') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.task) FROM public.ai_model_routes r),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_ai_model_route_update(
  _task text, _primary_model text, _fallback_model text, _max_latency_ms integer, _max_steps integer, _active boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.has_platform_permission('operations.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(trim(_primary_model)) < 3 OR _max_latency_ms NOT BETWEEN 1000 AND 120000 OR _max_steps NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid_contract'; END IF;
  SELECT to_jsonb(r) INTO v_before FROM public.ai_model_routes r WHERE task=_task;
  UPDATE public.ai_model_routes SET primary_model=trim(_primary_model), fallback_model=nullif(trim(_fallback_model),''),
    max_latency_ms=_max_latency_ms, max_steps=_max_steps, active=_active, updated_at=now() WHERE task=_task
  RETURNING to_jsonb(ai_model_routes.*) INTO v_after;
  IF v_after IS NULL THEN RAISE EXCEPTION 'unknown_task'; END IF;
  INSERT INTO public.admin_configuration_audit(actor_id, action, entity_type, entity_id, before_json, after_json)
  VALUES(auth.uid(),'ai.model_route.update','ai_model_route',_task,v_before,v_after);
  RETURN v_after;
END $$;

CREATE OR REPLACE FUNCTION public.admin_agent_knowledge_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_platform_permission('operations.read') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.category,k.title) FROM public.agent_knowledge_entries k),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.admin_agent_knowledge_upsert(
  _id uuid, _key text, _title text, _category text, _content text, _source_url text, _active boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_row jsonb;
BEGIN
  IF NOT public.has_platform_permission('operations.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF trim(_key) !~ '^[a-z0-9_:-]{3,80}$' OR char_length(trim(_content)) NOT BETWEEN 3 AND 4000 THEN RAISE EXCEPTION 'invalid_contract'; END IF;
  INSERT INTO public.agent_knowledge_entries(id,key,title,category,content,source_url,active,updated_by)
  VALUES(coalesce(_id,gen_random_uuid()),trim(_key),trim(_title),coalesce(nullif(trim(_category),''),'produto'),trim(_content),nullif(trim(_source_url),''),_active,auth.uid())
  ON CONFLICT (id) DO UPDATE SET key=excluded.key,title=excluded.title,category=excluded.category,content=excluded.content,
    source_url=excluded.source_url,active=excluded.active,version=agent_knowledge_entries.version+1,updated_by=auth.uid(),updated_at=now()
  RETURNING id,to_jsonb(agent_knowledge_entries.*) INTO v_id,v_row;
  INSERT INTO public.admin_configuration_audit(actor_id,action,entity_type,entity_id,after_json)
  VALUES(auth.uid(),'ai.knowledge.upsert','agent_knowledge',v_id::text,v_row);
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.admin_split_reminder_policy()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_platform_permission('messaging.read') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN (SELECT to_jsonb(p)-'id'-'updated_by'-'updated_at' FROM public.split_reminder_policy p WHERE id=1);
END $$;

CREATE OR REPLACE FUNCTION public.admin_split_reminder_policy_update(
  _enabled boolean,_due_soon_days_before integer,_due_today_enabled boolean,_first_overdue_days integer,
  _repeat_every_days integer,_max_overdue_reminders integer,_send_hour integer,_pause_on_reply boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_platform_permission('messaging.write') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.split_reminder_policy SET enabled=_enabled,due_soon_days_before=_due_soon_days_before,
    due_today_enabled=_due_today_enabled,first_overdue_days=_first_overdue_days,repeat_every_days=_repeat_every_days,
    max_overdue_reminders=_max_overdue_reminders,send_hour=_send_hour,pause_on_reply=_pause_on_reply,
    updated_by=auth.uid(),updated_at=now() WHERE id=1
  RETURNING to_jsonb(split_reminder_policy.*)-'id'-'updated_by' INTO v_result;
  UPDATE public.reminder_jobs SET status='skipped'::public.reminder_status,last_error='policy_changed',updated_at=now()
    WHERE kind IN ('due_soon','due_today','overdue') AND status='queued'::public.reminder_status;
  PERFORM public.schedule_split_due_reminders(NULL);
  INSERT INTO public.admin_configuration_audit(actor_id,action,entity_type,entity_id,after_json)
  VALUES(auth.uid(),'messaging.split_policy.update','split_reminder_policy','1',v_result);
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.admin_ai_model_routes() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_ai_model_route_update(text,text,text,integer,integer,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_agent_knowledge_list() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_agent_knowledge_upsert(uuid,text,text,text,text,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_split_reminder_policy() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.admin_split_reminder_policy_update(boolean,integer,boolean,integer,integer,integer,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_model_routes(),public.admin_ai_model_route_update(text,text,text,integer,integer,boolean),
 public.admin_agent_knowledge_list(),public.admin_agent_knowledge_upsert(uuid,text,text,text,text,text,boolean),
 public.admin_split_reminder_policy(),public.admin_split_reminder_policy_update(boolean,integer,boolean,integer,integer,integer,integer,boolean) TO authenticated;