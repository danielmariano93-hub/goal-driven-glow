-- Patch defensivo posterior — NÃO aplicado automaticamente.
-- Aplicar manualmente via supabase--migration quando aprovado.
--
-- Objetivos:
--   1) Qualificar explicitamente `extensions.gen_random_bytes(16)` na função
--      `public.split_create`, blindando-a contra falhas de resolução de nome
--      quando o `search_path` estiver estreitado por outro fluxo (ex.:
--      SECURITY DEFINER encadeado, roles com search_path próprio). O
--      `SET search_path` da própria função continua definido para blindar
--      todas as demais referências não qualificadas.
--   2) Introduzir `extracted_items.user_edited_at`, usada como guarda
--      anti-destrutiva: qualquer reprocessamento posterior (regras ou LLM)
--      deve pular linhas com esta marca — categoria, descrição, valor e
--      conta escolhidos manualmente têm precedência absoluta.

BEGIN;

CREATE OR REPLACE FUNCTION public.split_create(
  p_title text, p_total numeric, p_occurred_at date, p_due_date date,
  p_split_mode public.split_mode, p_include_owner boolean,
  p_reminder_enabled boolean, p_pix_key text, p_participants jsonb,
  p_owner_amount numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
  n_participants int;
  base_cents bigint;
  total_cents bigint;
  remainder bigint;
  it jsonb;
  sum_cents bigint := 0;
  owner_cents bigint := 0;
  extra_cent int;
  owner_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_total IS NULL OR p_total <= 0 THEN RAISE EXCEPTION 'invalid total'; END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'invalid title'; END IF;

  n_participants := jsonb_array_length(coalesce(p_participants,'[]'::jsonb))
                    + CASE WHEN p_include_owner THEN 1 ELSE 0 END;
  IF n_participants < 1 THEN RAISE EXCEPTION 'no participants'; END IF;

  total_cents := round(p_total * 100)::bigint;

  IF p_split_mode = 'custom' THEN
    FOR it IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      sum_cents := sum_cents + round(coalesce((it->>'amount_due')::numeric, 0) * 100)::bigint;
    END LOOP;
    IF p_include_owner THEN
      owner_cents := round(coalesce(p_owner_amount, 0) * 100)::bigint;
      sum_cents := sum_cents + owner_cents;
    END IF;
    IF sum_cents <> total_cents THEN
      RAISE EXCEPTION 'custom_sum_mismatch: expected %, got %', total_cents, sum_cents;
    END IF;
  END IF;

  INSERT INTO public.shared_expenses(owner_user_id,title,description,total_amount,occurred_at,due_date,split_mode,reminder_enabled,status,pix_key)
    VALUES (uid,p_title,NULL,p_total,coalesce(p_occurred_at,CURRENT_DATE),p_due_date,p_split_mode,coalesce(p_reminder_enabled,false),'active',nullif(btrim(coalesce(p_pix_key,'')),''))
    RETURNING id INTO new_id;

  IF p_split_mode = 'equal' THEN
    base_cents := total_cents / n_participants;
    remainder := total_cents - (base_cents * n_participants);
    IF p_include_owner THEN
      SELECT coalesce(display_name,'Você') INTO owner_name FROM public.profiles WHERE id = uid;
      extra_cent := CASE WHEN remainder > 0 THEN 1 ELSE 0 END;
      remainder := GREATEST(remainder - 1, 0);
      INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,amount_due,status,amount_paid,paid_at)
        VALUES (new_id, uid, coalesce(owner_name,'Você'), (base_cents + extra_cent)::numeric/100, 'paid', (base_cents + extra_cent)::numeric/100, now());
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      extra_cent := CASE WHEN remainder > 0 THEN 1 ELSE 0 END;
      remainder := GREATEST(remainder - 1, 0);
      INSERT INTO public.shared_expense_participants(
        shared_expense_id,owner_user_id,name,phone_e164,phone_masked,amount_due,opt_out_token
      ) VALUES (
        new_id, uid,
        coalesce(it->>'name','Participante'),
        nullif(it->>'phone_e164',''),
        CASE WHEN it->>'phone_e164' IS NOT NULL THEN regexp_replace(it->>'phone_e164','^(\+\d{2})\d+(\d{4})$','\1****\2') END,
        (base_cents + extra_cent)::numeric/100,
        -- Chamada qualificada: pgcrypto vive em `extensions`. Protege contra
        -- qualquer role/sessão com search_path estreitado.
        encode(extensions.gen_random_bytes(16),'hex')
      );
    END LOOP;
  ELSE -- custom
    IF p_include_owner THEN
      SELECT coalesce(display_name,'Você') INTO owner_name FROM public.profiles WHERE id = uid;
      INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,amount_due,status,amount_paid,paid_at)
        VALUES (new_id, uid, coalesce(owner_name,'Você'), owner_cents::numeric/100, 'paid', owner_cents::numeric/100, now());
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      INSERT INTO public.shared_expense_participants(
        shared_expense_id,owner_user_id,name,phone_e164,phone_masked,amount_due,opt_out_token
      ) VALUES (
        new_id, uid,
        coalesce(it->>'name','Participante'),
        nullif(it->>'phone_e164',''),
        CASE WHEN it->>'phone_e164' IS NOT NULL THEN regexp_replace(it->>'phone_e164','^(\+\d{2})\d+(\d{4})$','\1****\2') END,
        coalesce((it->>'amount_due')::numeric,0),
        encode(extensions.gen_random_bytes(16),'hex')
      );
    END LOOP;
  END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,event_type,payload)
    VALUES (new_id, uid, 'created', jsonb_build_object('total',p_total,'mode',p_split_mode));

  RETURN new_id;
END $function$;

REVOKE EXECUTE ON FUNCTION public.split_create(text,numeric,date,date,public.split_mode,boolean,boolean,text,jsonb,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_create(text,numeric,date,date,public.split_mode,boolean,boolean,text,jsonb,numeric) TO authenticated;

ALTER TABLE public.extracted_items
  ADD COLUMN IF NOT EXISTS user_edited_at timestamptz;

CREATE INDEX IF NOT EXISTS extracted_items_user_edited_idx
  ON public.extracted_items(document_id) WHERE user_edited_at IS NOT NULL;

COMMENT ON COLUMN public.extracted_items.user_edited_at IS
  'Marcado sempre que o usuário editar o item na revisão. Reprocessamentos e reenriquecimento por regras/LLM devem preservar categoria, descrição, valor e conta escolhidos manualmente.';

COMMIT;
