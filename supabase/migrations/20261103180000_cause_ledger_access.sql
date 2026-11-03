-- F3 (livro de causas na Home): liberação por usuário. Aditivo e reversível (DROP TABLE).
-- Mesmo padrão de `benefit_wallet_access` / `habits_v2_access`: só quem está na tabela recebe o campo `causes`
-- no `home-snapshot`; os demais não pagam CPU nem veem o card.
CREATE TABLE IF NOT EXISTS public.cause_ledger_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  note text
);
ALTER TABLE public.cause_ledger_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cause_ledger_access_select_own" ON public.cause_ledger_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.cause_ledger_access FROM anon, public;
GRANT SELECT ON public.cause_ledger_access TO authenticated;
