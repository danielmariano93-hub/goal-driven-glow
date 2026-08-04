-- =====================================================================
-- Nino intelligence — qualidade de conteúdo (pt-BR), curadoria e refresh rico
-- =====================================================================

-- 1) Formatação monetária determinística pt-BR (independe de lc_numeric)
CREATE OR REPLACE FUNCTION public.nino_num(_v numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT translate(to_char(COALESCE(_v,0), 'FM999G999G999G990D00'), ',.', '.,')
$$;

CREATE OR REPLACE FUNCTION public.nino_brl(_v numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT 'R$ ' || public.nino_num(_v)
$$;

-- Corrige textos já gravados com separadores americanos (1,170.54 -> 1.170,54)
CREATE OR REPLACE FUNCTION public.nino_fix_money_text(_t text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_out text := _t;
  m text;
BEGIN
  IF v_out IS NULL THEN RETURN NULL; END IF;
  -- 1.234,56 americano: 1,234.56 (com milhar) e 1234.56 (sem milhar)
  FOR m IN
    SELECT DISTINCT x FROM regexp_matches(v_out, '\d{1,3}(?:,\d{3})+\.\d{2}', 'g') AS t(g)
    CROSS JOIN LATERAL (SELECT g[1] IS NOT NULL) z(ok)
    CROSS JOIN LATERAL (SELECT (regexp_matches(v_out, '\d{1,3}(?:,\d{3})+\.\d{2}', 'g'))[1]) y(x)
  LOOP
    NULL; -- placeholder (substituído abaixo por abordagem direta)
  END LOOP;

  -- Abordagem direta e segura: dois passes de regexp_replace com callbacks simulados
  -- Pass A: números com separador de milhar americano
  LOOP
    EXIT WHEN v_out !~ '\d{1,3}(,\d{3})+\.\d{2}';
    v_out := regexp_replace(
      v_out,
      '(\d{1,3}(?:,\d{3})+)\.(\d{2})',
      replace((regexp_match(v_out, '(\d{1,3}(?:,\d{3})+)\.(\d{2})'))[1], ',', '.') || '#DEC#' ||
      (regexp_match(v_out, '(\d{1,3}(?:,\d{3})+)\.(\d{2})'))[2]
    );
  END LOOP;
  -- Pass B: números simples com ponto decimal
  v_out := regexp_replace(v_out, '(\d+)\.(\d{2})(?![\d])', '\1#DEC#\2', 'g');
  v_out := replace(v_out, '#DEC#', ',');
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.nino_fix_money_text(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nino_fix_money_text(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nino_num(numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nino_brl(numeric) TO authenticated, service_role;

-- 2) Substitui a formatação americana dentro dos construtores SQL existentes
DO $do$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND pg_get_functiondef(p.oid) LIKE '%FM999G999G990D00%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_def := regexp_replace(v_def, 'to_char\(([^;]*?), ''FM999G999G990D00''\)', 'public.nino_num(\1)', 'g');
    EXECUTE v_def;
  END LOOP;
END $do$;

-- 3) Curadoria: elegibilidade, deduplicação, supersessão e temporalidade
CREATE OR REPLACE FUNCTION public.nino_curate_items(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expired int := 0;
  v_superseded int := 0;
  v_archived int := 0;
BEGIN
  -- 3.1 vencidos
  UPDATE public.nino_intelligence_items
     SET status='expired', updated_at=now()
   WHERE user_id=_user_id AND status='active'
     AND valid_until IS NOT NULL AND valid_until < now();
  v_expired := v_expired + COALESCE((SELECT count(*) FROM public.nino_intelligence_items
     WHERE user_id=_user_id AND status='expired' AND updated_at > now() - interval '1 minute'), 0);

  -- 3.2 movimentos não comparáveis não geram recomendação de corte
  UPDATE public.nino_intelligence_items
     SET status='archived', updated_at=now()
   WHERE user_id=_user_id AND status='active'
     AND kind IN ('recommendation','risk','opportunity')
     AND (
       lower(coalesce(title,'') || ' ' || coalesce(explanation,'')) ~
         '(estorno|reembolso|transfer|pagamento de fatura|pagamento da fatura|pagamento de d[ií]vida|amortiza)'
     );
  v_archived := ROW_COUNT_ARCHIVED();

  RETURN jsonb_build_object('ok', true);
END $$;
