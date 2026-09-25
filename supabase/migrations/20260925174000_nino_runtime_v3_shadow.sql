-- Nino Runtime V3 shadow telemetry + rollout controls.
-- Shadow is side-effect-free and starts disabled. Authority flag also starts off.

INSERT INTO public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
VALUES
  ('runtime_v3_shadow', false, 0, '{}'::uuid[]),
  ('runtime_v3_authority_v1', false, 0, '{}'::uuid[])
ON CONFLICT (flag_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.nino_runtime_v3_shadow_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  inbound_message_id text,
  channel text,
  created_at timestamptz NOT NULL DEFAULT now(),

  v2_status text NOT NULL DEFAULT 'observed',
  v2_kind text,
  v2_act text,
  v2_canonical_request text,
  v2_signature jsonb NOT NULL DEFAULT '{}'::jsonb,
  v2_run_id uuid,
  v2_path text,
  v2_reply_kind text,
  v2_tools text[] NOT NULL DEFAULT '{}'::text[],
  v2_error text,

  v3_status text NOT NULL,
  v3_kind text,
  v3_act text,
  v3_canonical_request text,
  v3_signature jsonb NOT NULL DEFAULT '{}'::jsonb,
  v3_task_families text[] NOT NULL DEFAULT '{}'::text[],
  v3_execution_subsystems text[] NOT NULL DEFAULT '{}'::text[],
  v3_model text,
  v3_provider text,
  v3_latency_ms integer NOT NULL DEFAULT 0,
  v3_tokens_in integer NOT NULL DEFAULT 0,
  v3_tokens_out integer NOT NULL DEFAULT 0,
  v3_error text,
  violations text[] NOT NULL DEFAULT '{}'::text[],

  same_kind boolean,
  same_act boolean,
  same_task_families boolean,
  same_entities boolean,
  same_periods boolean,
  semantic_match boolean,
  divergence_reasons text[] NOT NULL DEFAULT '{}'::text[],

  CONSTRAINT nino_runtime_v3_shadow_v3_status_check
    CHECK (v3_status IN ('ok', 'rejected', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS nino_runtime_v3_shadow_inbound_unique
  ON public.nino_runtime_v3_shadow_evaluations (user_id, conversation_id, inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS nino_runtime_v3_shadow_user_created_idx
  ON public.nino_runtime_v3_shadow_evaluations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS nino_runtime_v3_shadow_divergence_idx
  ON public.nino_runtime_v3_shadow_evaluations (semantic_match, created_at DESC);

ALTER TABLE public.nino_runtime_v3_shadow_evaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nino_runtime_v3_shadow_evaluations FROM anon, authenticated;

-- The table is service-role only. Keep that intent explicit both for humans and
-- for database advisors: client roles have a policy, but it is an unconditional
-- deny. Service-role bypasses RLS and is the only runtime writer/reader.
DROP POLICY IF EXISTS nino_runtime_v3_shadow_deny_all_clients
  ON public.nino_runtime_v3_shadow_evaluations;
CREATE POLICY nino_runtime_v3_shadow_deny_all_clients
  ON public.nino_runtime_v3_shadow_evaluations
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.nino_runtime_v3_shadow_evaluations IS
  'Internal-only V2 x V3 semantic shadow telemetry. Service-role runtime writes; end users have no Data API access.';