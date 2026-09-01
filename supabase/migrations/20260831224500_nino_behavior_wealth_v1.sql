-- nino_behavior_wealth.v1
-- Corrige fila herdada onde hipótese comportamental não confirmada podia virar
-- mensagem proativa. Preserva a hipótese para revisão; apenas impede que ela
-- continue sendo tratada como comunicação pronta.

BEGIN;

UPDATE public.pending_proactive_suggestions p
SET
  status = 'dismissed',
  dismissed_at = COALESCE(p.dismissed_at, now()),
  defer_reason = 'behavior_hypothesis_not_confirmed'
WHERE p.status IN ('pending', 'dispatched')
  AND EXISTS (
    SELECT 1
    FROM public.behavior_hypotheses h
    WHERE h.user_id = p.user_id
      AND h.dedup_key = p.dedup_key
      AND h.status IN ('pending', 'rejected', 'expired')
  );

COMMIT;
