ALTER VIEW public.v_card_double_counting SET (security_invoker = true);
ALTER VIEW public.v_outbound_sla_breach SET (security_invoker = true);

REVOKE ALL ON public.v_card_double_counting FROM anon, authenticated;
REVOKE ALL ON public.v_outbound_sla_breach FROM anon, authenticated;

GRANT SELECT ON public.v_card_double_counting TO service_role;
GRANT SELECT ON public.v_outbound_sla_breach TO service_role;