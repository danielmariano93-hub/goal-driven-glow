REVOKE EXECUTE ON FUNCTION public.split_summary() FROM anon;
REVOKE EXECUTE ON FUNCTION public.split_participant_is_eligible(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.schedule_split_due_reminders(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.split_add_payment_v2(uuid,numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.split_reverse_payment_v2(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.split_enqueue_message(uuid,uuid,text,timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.split_installment_state(text,date,numeric,numeric) FROM anon;