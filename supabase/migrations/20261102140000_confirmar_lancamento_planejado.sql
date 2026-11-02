-- Confirmar um lançamento planejado (ex.: aluguel do dia 30). Aditivo e reversível (DROP FUNCTION).
-- Só o dono, só de 'planned' para 'confirmed', com controle de versão (mesma regra de transaction_update_direct).
-- Data e valor opcionais: a pessoa pode confirmar com a data/valor reais do pagamento.
CREATE OR REPLACE FUNCTION public.transaction_confirm_planned(
  p_id uuid,
  p_expected_version integer,
  p_occurred_at date DEFAULT NULL,
  p_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE target record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  SELECT * INTO target FROM public.transactions WHERE id = p_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owned'); END IF;
  IF target.version <> p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'current_version', target.version);
  END IF;
  IF target.status::text <> 'planned' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_planned'); END IF;
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount'); END IF;

  UPDATE public.transactions
     SET status = 'confirmed',
         occurred_at = coalesce(p_occurred_at, occurred_at),
         amount = coalesce(p_amount, amount)
   WHERE id = target.id AND user_id = auth.uid();

  RETURN jsonb_build_object('ok', true, 'id', target.id);
END
$function$;

REVOKE ALL ON FUNCTION public.transaction_confirm_planned(uuid, integer, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transaction_confirm_planned(uuid, integer, date, numeric) TO authenticated, service_role;
