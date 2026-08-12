ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS merchant_name text;

CREATE OR REPLACE FUNCTION public.derive_merchant_name(p_friendly text, p_raw text, p_description text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    btrim(regexp_replace(
      COALESCE(NULLIF(btrim(p_friendly), ''), NULLIF(btrim(p_raw), ''), NULLIF(btrim(p_description), '')),
      '\s+', ' ', 'g')),
    '')
$$;

CREATE OR REPLACE FUNCTION public.transactions_fill_merchant_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.merchant_name IS NULL OR btrim(NEW.merchant_name) = '' THEN
    NEW.merchant_name := public.derive_merchant_name(NEW.friendly_description, NEW.raw_description, NEW.description);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_fill_merchant_name ON public.transactions;
CREATE TRIGGER trg_transactions_fill_merchant_name
BEFORE INSERT OR UPDATE OF friendly_description, raw_description, description, merchant_name
ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.transactions_fill_merchant_name();

UPDATE public.transactions
SET merchant_name = public.derive_merchant_name(friendly_description, raw_description, description)
WHERE merchant_name IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_merchant
  ON public.transactions (user_id, merchant_name)
  WHERE merchant_name IS NOT NULL;