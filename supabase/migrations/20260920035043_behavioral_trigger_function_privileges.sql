-- behavioral_evolution.v1.3 — trigger-only SECURITY DEFINER functions.
-- These functions are invoked by PostgreSQL triggers and must not be exposed
-- as direct RPC surfaces to anon or authenticated users.

begin;

revoke execute on function public.queue_declared_money_mood_highlight() from public, anon, authenticated;
revoke execute on function public.queue_behavior_experiment_completion() from public, anon, authenticated;

commit;
