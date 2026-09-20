-- behavioral_evolution.v1.2 — one canonical mutation path.
-- Reads remain RLS-protected. Assessment/experiment writes must go through the
-- validated RPCs so progress cannot diverge from measured evidence.

begin;

-- Remove direct mutation policies introduced by v1. The SECURITY DEFINER RPCs
-- below are the only supported write surface and validate auth.uid/ownership.
drop policy if exists behavioral_assessments_insert_own on public.behavioral_assessments;
drop policy if exists behavior_experiments_insert_own on public.behavior_experiments;
drop policy if exists behavior_experiments_update_own on public.behavior_experiments;
drop policy if exists behavior_experiment_events_insert_own on public.behavior_experiment_events;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoke that
-- implicit access and explicitly allow only the roles the product needs.
revoke execute on function public.behavioral_assessment_save(jsonb) from public, anon;
revoke execute on function public.behavior_experiment_start(text) from public, anon;
revoke execute on function public.behavior_experiment_log(uuid, numeric, text) from public, anon;
revoke execute on function public.behavior_experiment_refresh(uuid) from public, anon;

grant execute on function public.behavioral_assessment_save(jsonb) to authenticated;
grant execute on function public.behavior_experiment_start(text) to authenticated;
grant execute on function public.behavior_experiment_log(uuid, numeric, text) to authenticated;
grant execute on function public.behavior_experiment_refresh(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;