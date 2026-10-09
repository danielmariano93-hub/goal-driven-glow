-- Combinados do fim de semana (nino_weekend_commitments.v1).
-- A previsão de sexta oferece um limite para o fim de semana ("topo"); a pessoa
-- aceita pelo WhatsApp e o fechamento de segunda mede o combinado contra o gasto
-- real. Escrita só pelo backend (service role); a pessoa só lê o que é dela.
CREATE TABLE IF NOT EXISTS public.weekend_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  friday date NOT NULL,
  category text NOT NULL,
  -- offered: limite proposto | accepted: a pessoa topou | info: mensagem sem limite (só "detalhes")
  -- kept / missed: resultado medido no fechamento de segunda | expired: ninguém respondeu
  status text NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered', 'accepted', 'info', 'kept', 'missed', 'expired')),
  target_amount numeric(12, 2) CHECK (target_amount IS NULL OR target_amount >= 0),
  expected_amount numeric(12, 2),
  projected_before numeric(12, 2),
  projected_if_met numeric(12, 2),
  anchor_kind text CHECK (anchor_kind IS NULL OR anchor_kind IN ('goal', 'average')),
  anchor_amount numeric(12, 2),
  detail text,
  offered_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  evaluated_at timestamptz,
  realized_amount numeric(12, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, friday, category)
);

CREATE INDEX IF NOT EXISTS weekend_commitments_user_friday_idx
  ON public.weekend_commitments (user_id, friday DESC);

GRANT SELECT ON public.weekend_commitments TO authenticated;
GRANT ALL ON public.weekend_commitments TO service_role;
ALTER TABLE public.weekend_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "weekend_commitments_own_read" ON public.weekend_commitments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER weekend_commitments_touch BEFORE UPDATE ON public.weekend_commitments
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
