
-- Add 'processing' status to msg_status enum
ALTER TYPE public.msg_status ADD VALUE IF NOT EXISTS 'processing' BEFORE 'sent';

-- agent_runs telemetry
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS path text CHECK (path IN ('llm','deterministic_fallback')),
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS error_sanitized text;

-- agent_tool_calls
CREATE TABLE IF NOT EXISTS public.agent_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_index smallint NOT NULL,
  tool_name text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  ok boolean NOT NULL DEFAULT false,
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON public.agent_tool_calls(run_id);
GRANT ALL ON public.agent_tool_calls TO service_role;
GRANT SELECT ON public.agent_tool_calls TO authenticated;
ALTER TABLE public.agent_tool_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_read_tool_calls" ON public.agent_tool_calls;
CREATE POLICY "admin_read_tool_calls" ON public.agent_tool_calls FOR SELECT TO authenticated
  USING (public.is_current_user_admin());

-- outbound lease fields
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- New claim RPC: mark processing (with lease), never sent
CREATE OR REPLACE FUNCTION public.claim_outbound_batch(p_limit integer DEFAULT 10)
 RETURNS SETOF public.outbound_messages
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  return query
    update public.outbound_messages o
       set status = 'processing'::msg_status,
           attempts = o.attempts + 1,
           claimed_at = now(),
           lease_expires_at = now() + interval '2 minutes'
     where o.id in (
       select id from public.outbound_messages
        where (status = 'queued'::msg_status
               or (status = 'processing'::msg_status and lease_expires_at < now()))
          and next_attempt_at <= now()
          and channel = 'whatsapp'
        order by created_at asc
        for update skip locked
        limit p_limit
     )
    returning o.*;
end $$;

-- Mark sent after provider confirms
CREATE OR REPLACE FUNCTION public.mark_outbound_sent(p_id uuid, p_provider_message_id text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  update public.outbound_messages
    set status = 'sent'::msg_status,
        provider_message_id = coalesce(p_provider_message_id, provider_message_id),
        sent_at = now(),
        claimed_at = null,
        lease_expires_at = null,
        last_error = null
    where id = p_id;
$$;

-- Recover expired leases (idempotent, safe to call periodically)
CREATE OR REPLACE FUNCTION public.recover_expired_outbound_leases()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n integer;
begin
  update public.outbound_messages
    set status = 'queued'::msg_status,
        claimed_at = null,
        lease_expires_at = null
    where status = 'processing'::msg_status
      and lease_expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- phone_link_codes indexable lookup key (HMAC-like: sha256(code + user_id) already used; add lookup for fast match without user_id)
-- We keep the existing code_hash (irreversible), add a second index-friendly hash of just the code with a server pepper
-- Since pepper lives in code, we can't compute in SQL. Alternative: index the raw code_hash-space is impossible without user_id.
-- Simpler & safe: add a short-lived per-phone binding on generation so lookup finds it in O(1).
-- However, the current code uses code + user_id, which requires scanning per user. Best fix: store lookup_key = sha256(code) alone (still one-way),
-- and require exp/tries/cooldown. This is acceptable because the code has TTL, attempts, and cooldown.
ALTER TABLE public.phone_link_codes
  ADD COLUMN IF NOT EXISTS lookup_key text,
  ADD COLUMN IF NOT EXISTS attempts smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_phone_link_codes_lookup
  ON public.phone_link_codes(lookup_key)
  WHERE used_at IS NULL;

-- Update code creation to also populate lookup_key = sha256(code) (no user salt)
CREATE OR REPLACE FUNCTION public.create_phone_link_code()
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare
  uid uuid := auth.uid();
  raw text; h text; lk text; recent int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select count(*) into recent from public.phone_link_codes
    where user_id = uid and created_at > now() - interval '30 minutes';
  if recent >= 5 then raise exception 'too many attempts, try again later'; end if;
  raw := lpad((floor(random() * 1000000))::int::text, 6, '0');
  h := encode(digest(raw || uid::text, 'sha256'), 'hex');
  lk := encode(digest(raw, 'sha256'), 'hex');
  insert into public.phone_link_codes(user_id, code_hash, lookup_key, expires_at)
    values (uid, h, lk, now() + interval '10 minutes');
  return raw;
end $$;

-- conversations.pending_slots for follow-up state
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS pending_slots jsonb;
