REVOKE ALL ON FUNCTION public.nino_tx_behavioral_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nino_statement_behavioral_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nino_goal_contribution_behavioral_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nino_debt_payment_behavioral_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nino_investment_movement_behavioral_event() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';