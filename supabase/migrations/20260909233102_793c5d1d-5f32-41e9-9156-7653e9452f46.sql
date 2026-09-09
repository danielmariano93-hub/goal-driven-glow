alter table public.communication_deliveries
  add column if not exists narrative_mode text,
  add column if not exists narrative_model text,
  add column if not exists narrative_body text,
  add column if not exists guard_status text,
  add column if not exists fallback_reason text,
  add column if not exists narrative_latency_ms integer,
  add column if not exists evidence_pack_version text;

create index if not exists idx_comm_deliveries_guard_status
  on public.communication_deliveries (guard_status, created_at desc)
  where guard_status is not null;

insert into public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
values ('narrative_layer_v1', false, 0, '{}')
on conflict (flag_name) do nothing;