-- Corrige funções SECURITY DEFINER que usam gen_random_bytes instalado em extensions.

ALTER FUNCTION public.split_create(text,numeric,date,date,public.split_mode,boolean,boolean,text,jsonb,numeric)
  SET search_path = public, extensions;

ALTER FUNCTION public.admin_waha_save_config(text,text,text,text)
  SET search_path = public, vault, extensions;

NOTIFY pgrst, 'reload schema';
