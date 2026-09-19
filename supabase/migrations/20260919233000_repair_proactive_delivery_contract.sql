-- Repair proactive communication schema drift after Supabase cutover.
-- Production Edge Functions read/write these columns in the delivery ledger.
-- Missing columns make the dispatcher fail and silently disable learning/timing.

begin;

alter table public.communication_deliveries
  add column if not exists interacted_at timestamptz,
  add column if not exists action_taken text,
  add column if not exists block_context jsonb not null default '{}'::jsonb,
  add column if not exists false_positive boolean,
  add column if not exists user_feedback text;

create index if not exists communication_deliveries_user_dedup_created_idx
  on public.communication_deliveries(user_id, dedup_key, created_at desc);

comment on column public.communication_deliveries.block_context is
  'Dispatch policy context: priority score, cap override, pilot mode and related decision metadata.';
comment on column public.communication_deliveries.interacted_at is
  'Timestamp of user interaction with the proactive communication, used by learning/timing.';
comment on column public.communication_deliveries.false_positive is
  'Optional user/feedback signal that the proactive communication was a false positive.';
comment on column public.communication_deliveries.user_feedback is
  'Normalized feedback used by proactive learning and ranking.';

-- PostgREST normally reloads after DDL, but the explicit notification removes
-- ambiguity after a cutover and prevents stale schema-cache failures.
notify pgrst, 'reload schema';

commit;
