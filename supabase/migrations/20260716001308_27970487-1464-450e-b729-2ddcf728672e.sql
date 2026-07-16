REVOKE ALL ON FUNCTION public.split_create(text,numeric,date,date,public.split_mode,boolean,boolean,text,jsonb) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.split_create(text,numeric,date,date,public.split_mode,boolean,boolean,text,jsonb);

REVOKE ALL ON FUNCTION public.split_create(text,numeric,date,date,public.split_mode,boolean,boolean,text,jsonb,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_create(text,numeric,date,date,public.split_mode,boolean,boolean,text,jsonb,numeric) TO authenticated;