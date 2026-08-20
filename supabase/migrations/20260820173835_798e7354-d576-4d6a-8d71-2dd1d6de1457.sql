REVOKE ALL ON FUNCTION public.financial_truth_changed(UUID, TEXT, TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_financial_truth_changed() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.advisor_register_topic_signal_v2(TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_truth_changed(UUID, TEXT, TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advisor_register_topic_signal_v2(TEXT, TEXT, UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tg_financial_truth_changed() TO service_role;