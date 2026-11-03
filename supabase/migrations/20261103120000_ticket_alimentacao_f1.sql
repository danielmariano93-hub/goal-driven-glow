-- Ticket Alimentação — Fase 1. Aditivo e reversível (DROP das 3 tabelas e da função).
-- Contexto SEPARADO do livro-razão: benefício não é renda, não entra em caixa livre nem em patrimônio.
-- Ver docs/NINO_TICKET_ALIMENTACAO_PRODUTO_E_ARQUITETURA.md.
--
-- Liberação controlada por usuário (mesmo padrão de habits_v2_access / open_finance_access):
-- só quem está em benefit_wallet_access enxerga e escreve.

CREATE TABLE IF NOT EXISTS public.benefit_wallet_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  note text
);
ALTER TABLE public.benefit_wallet_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "benefit_wallet_access_select_own" ON public.benefit_wallet_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.benefit_wallet_access FROM anon, public;
GRANT SELECT ON public.benefit_wallet_access TO authenticated;

CREATE OR REPLACE FUNCTION public.benefit_wallet_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.benefit_wallet_access WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.benefit_wallet_enabled() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.benefit_wallet_enabled() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.benefit_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Ticket Alimentação' CHECK (char_length(name) BETWEEN 1 AND 60),
  kind text NOT NULL DEFAULT 'food' CHECK (kind IN ('food')),
  monthly_credit numeric(12,2) NOT NULL CHECK (monthly_credit > 0),
  credit_day smallint NOT NULL CHECK (credit_day BETWEEN 1 AND 31),
  carries_over boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Uma carteira ativa por usuário nesta fase.
CREATE UNIQUE INDEX IF NOT EXISTS benefit_wallets_one_active_per_user
  ON public.benefit_wallets (user_id) WHERE active;

CREATE TABLE IF NOT EXISTS public.benefit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.benefit_wallets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('credit', 'spend', 'balance_reading', 'adjustment')),
  amount numeric(12,2) NOT NULL,
  occurred_on date NOT NULL,
  merchant text CHECK (merchant IS NULL OR char_length(merchant) <= 80),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'whatsapp', 'document')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- crédito, gasto e leitura de saldo são positivos; só o ajuste pode ser negativo.
  CONSTRAINT benefit_entries_amount_sign CHECK (kind = 'adjustment' OR amount > 0)
);
CREATE INDEX IF NOT EXISTS benefit_entries_wallet_day_idx
  ON public.benefit_entries (wallet_id, occurred_on DESC);

ALTER TABLE public.benefit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benefit_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "benefit_wallets_select_own" ON public.benefit_wallets
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "benefit_wallets_insert_own" ON public.benefit_wallets
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.benefit_wallet_enabled());
CREATE POLICY "benefit_wallets_update_own" ON public.benefit_wallets
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "benefit_wallets_delete_own" ON public.benefit_wallets
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "benefit_entries_select_own" ON public.benefit_entries
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- A linha só pode apontar para uma carteira do próprio usuário.
CREATE POLICY "benefit_entries_insert_own" ON public.benefit_entries
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND public.benefit_wallet_enabled()
    AND EXISTS (SELECT 1 FROM public.benefit_wallets w WHERE w.id = wallet_id AND w.user_id = auth.uid())
  );
CREATE POLICY "benefit_entries_delete_own" ON public.benefit_entries
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.benefit_wallets, public.benefit_entries FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.benefit_wallets TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.benefit_entries TO authenticated;
