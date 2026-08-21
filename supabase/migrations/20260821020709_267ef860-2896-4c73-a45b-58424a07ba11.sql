ALTER TABLE public.user_financial_settings DROP CONSTRAINT IF EXISTS user_financial_settings_doc_max_items_check;
ALTER TABLE public.user_financial_settings ADD CONSTRAINT user_financial_settings_doc_max_items_check CHECK (doc_max_items IS NULL OR (doc_max_items >= 50 AND doc_max_items <= 4000));
ALTER TABLE public.user_financial_settings ALTER COLUMN doc_max_items SET DEFAULT 1500;
UPDATE public.user_financial_settings SET doc_max_items = 1500 WHERE doc_max_items IS NULL OR doc_max_items <= 240;