CREATE OR REPLACE FUNCTION public.create_phone_link_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
declare
  uid uuid := auth.uid();
  raw text; h text; lk text; recent int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select count(*) into recent from public.phone_link_codes
    where user_id = uid and created_at > now() - interval '30 minutes';
  if recent >= 5 then raise exception 'too many attempts, try again later'; end if;
  raw := lpad((floor(random() * 1000000))::int::text, 6, '0');
  h  := encode(extensions.digest(raw || uid::text, 'sha256'), 'hex');
  lk := encode(extensions.digest(raw, 'sha256'), 'hex');
  insert into public.phone_link_codes(user_id, code_hash, lookup_key, expires_at)
    values (uid, h, lk, now() + interval '10 minutes');
  return raw;
end
$function$;

REVOKE ALL ON FUNCTION public.create_phone_link_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_phone_link_code() TO authenticated;