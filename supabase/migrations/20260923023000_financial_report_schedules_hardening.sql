-- Supabase may keep direct EXECUTE grants for API roles even after PUBLIC is
-- revoked. These scheduler RPCs are backend-only and must never be callable by
-- anonymous or signed-in clients.

REVOKE EXECUTE ON FUNCTION public.financial_reports_targeted_tick(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.financial_report_schedules_tick() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.financial_reports_targeted_tick(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_report_schedules_tick() TO service_role;
