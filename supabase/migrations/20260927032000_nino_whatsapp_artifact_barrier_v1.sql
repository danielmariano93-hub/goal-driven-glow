-- nino_whatsapp_artifact_barrier_v1
--
-- Two guarantees for WhatsApp artifact turns:
-- 1) an explicit chart request gets a short grace period before the outbound
--    worker may claim it, so AgentCoreV2Entry can attach the artifact first;
-- 2) once an artifact is attached, its deterministic fallback/summary becomes
--    the outbound body. If image rendering fails, the user still receives the
--    same financial truth in plain language instead of an internal failure text.

create or replace function public.nino_outbound_artifact_barrier_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inbound_body text;
  v_fallback text;
begin
  if new.channel = 'whatsapp'
     and new.inbound_message_id is not null
     and new.artifact_id is null then
    select i.body
      into v_inbound_body
      from public.inbound_messages i
     where i.id = new.inbound_message_id;

    -- Only explicit visual requests wait. Ordinary WhatsApp replies keep their
    -- current latency. Twenty seconds is a maximum grace period, not a sleep:
    -- attaching the artifact below releases the row immediately. This exceeds
    -- the semantic-interpreter deadline and closes the race even on a slow turn.
    if coalesce(v_inbound_body, '') ~* '(gr[aá]fico|\mchart\M)' then
      new.next_attempt_at := greatest(
        coalesce(new.next_attempt_at, now()),
        now() + interval '20 seconds'
      );
    end if;
  end if;

  if new.artifact_id is not null then
    if tg_op = 'INSERT'
       or new.artifact_id is distinct from old.artifact_id then
      select coalesce(nullif(a.fallback_text, ''), nullif(a.summary_text, ''))
        into v_fallback
        from public.agent_artifacts a
       where a.id = new.artifact_id
         and a.user_id = new.user_id;

      if v_fallback is not null then
        new.body := v_fallback;
      end if;

      new.media_status := 'pending';

      -- If the worker has not claimed the row yet, attaching the artifact ends
      -- the grace period immediately. The next worker tick can render/send it.
      if new.status = 'queued'::msg_status then
        new.next_attempt_at := now();
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.nino_outbound_artifact_barrier_v1() from public;

-- BEFORE is required because we intentionally rewrite body/next_attempt_at on
-- the row that is being inserted/updated.
drop trigger if exists trg_nino_outbound_artifact_barrier_v1 on public.outbound_messages;
create trigger trg_nino_outbound_artifact_barrier_v1
before insert or update of artifact_id on public.outbound_messages
for each row
execute function public.nino_outbound_artifact_barrier_v1();