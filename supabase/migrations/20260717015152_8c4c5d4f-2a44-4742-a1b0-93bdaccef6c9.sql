-- 1) Restringe INSERT em pulse_snapshots ao service_role (edge function).
DROP POLICY IF EXISTS "own pulse snapshots insert" ON public.pulse_snapshots;
REVOKE INSERT, UPDATE, DELETE ON public.pulse_snapshots FROM authenticated;
GRANT SELECT ON public.pulse_snapshots TO authenticated;
GRANT ALL ON public.pulse_snapshots TO service_role;

-- 2) Índice único diário para upsert do Pulso (America/Sao_Paulo).
CREATE UNIQUE INDEX IF NOT EXISTS pulse_snapshots_one_per_day
  ON public.pulse_snapshots (user_id, ((computed_at AT TIME ZONE 'America/Sao_Paulo')::date));

-- 3) Coluna para vincular transação a um pagamento de fatura de cartão específico.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS settles_card_id UUID NULL REFERENCES public.credit_cards(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transactions_settles_card_idx
  ON public.transactions (settles_card_id) WHERE settles_card_id IS NOT NULL;
