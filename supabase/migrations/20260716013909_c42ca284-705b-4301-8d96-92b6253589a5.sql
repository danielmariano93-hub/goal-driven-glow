
-- ============================================================
-- Structured agent behavior editor (draft/publish/restore/history)
-- ============================================================

ALTER TABLE public.agent_prompt_versions
  ADD COLUMN IF NOT EXISTS structured_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS parent_version_id uuid REFERENCES public.agent_prompt_versions(id),
  ADD COLUMN IF NOT EXISTS restored_from_id uuid REFERENCES public.agent_prompt_versions(id);

-- Touch updated_at on any row change.
DROP TRIGGER IF EXISTS apv_touch_updated_at ON public.agent_prompt_versions;
CREATE TRIGGER apv_touch_updated_at BEFORE UPDATE ON public.agent_prompt_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Backfill structured_config for the currently active version.
UPDATE public.agent_prompt_versions
   SET structured_config = jsonb_build_object(
        'name', 'Assistente NoControle',
        'objective', 'Ajudar o usuário a organizar a vida financeira com respeito e clareza.',
        'tone', 'humano, encorajador, direto',
        'do', ARRAY[
          'Confirmar antes de gravar qualquer alteração financeira',
          'Explicar em linguagem simples',
          'Perguntar apenas o essencial'
        ],
        'dont', ARRAY[
          'Inventar valores, saldos ou datas',
          'Emitir julgamento moral sobre gastos',
          'Prometer enriquecimento'
        ],
        'welcome', 'Oi! Sou o assistente do NoControle.ia. Posso registrar um gasto, mostrar um resumo ou tirar dúvidas — como posso ajudar?',
        'fallback', 'Não entendi ainda. Pode reformular ou me dar um exemplo?',
        'proactive', false
      )
 WHERE structured_config = '{}'::jsonb OR structured_config IS NULL;

-- =============================================================
-- Compile a system_prompt from structured config + fixed safety.
-- =============================================================
CREATE OR REPLACE FUNCTION public.agent_compile_prompt(p_cfg jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  name text := coalesce(p_cfg->>'name', 'Assistente NoControle');
  objective text := coalesce(p_cfg->>'objective', '');
  tone text := coalesce(p_cfg->>'tone', 'humano e claro');
  welcome text := coalesce(p_cfg->>'welcome', '');
  fallback text := coalesce(p_cfg->>'fallback', '');
  do_list text;
  dont_list text;
  proactive boolean := coalesce((p_cfg->>'proactive')::boolean, false);
  safety text;
BEGIN
  SELECT string_agg('- ' || value, E'\n') INTO do_list
    FROM jsonb_array_elements_text(coalesce(p_cfg->'do','[]'::jsonb));
  SELECT string_agg('- ' || value, E'\n') INTO dont_list
    FROM jsonb_array_elements_text(coalesce(p_cfg->'dont','[]'::jsonb));

  safety := E'REGRAS DE SEGURANÇA (obrigatórias e não editáveis):\n'
         || E'- Nunca invente valores, saldos, datas ou identidades. Se não souber, pergunte.\n'
         || E'- Toda operação que altera dinheiro do usuário exige uma confirmação explícita antes de gravar.\n'
         || E'- Nunca revele credenciais, dados de outro usuário ou detalhes técnicos internos.\n'
         || E'- Respeite a LGPD: só use dados do próprio usuário autenticado.\n'
         || E'- Se detectar risco, ansiedade ou vulnerabilidade, responda com empatia e sem julgamento.';

  RETURN
    'Você é ' || name || E'.\n\n' ||
    'Objetivo: ' || objective || E'\n' ||
    'Tom de voz: ' || tone || E'\n\n' ||
    'O que você deve fazer:' || E'\n' || coalesce(do_list, '- (nenhuma diretriz explícita)') || E'\n\n' ||
    'O que você nunca deve fazer:' || E'\n' || coalesce(dont_list, '- (nenhuma restrição explícita)') || E'\n\n' ||
    'Mensagem de boas-vindas: ' || welcome || E'\n' ||
    'Quando não entender: ' || fallback || E'\n' ||
    'Proatividade: ' || CASE WHEN proactive THEN 'pode sugerir próximos passos.' ELSE 'só responde quando perguntado.' END || E'\n\n' ||
    safety;
END $$;

-- =============================================================
-- CRUD RPCs (admin gated).
-- =============================================================
CREATE OR REPLACE FUNCTION public.agent_prompt_list()
RETURNS TABLE (
  id uuid, version int, status prompt_status, notes text,
  structured_config jsonb, model text, temperature numeric, max_steps smallint,
  created_by uuid, created_at timestamptz, updated_at timestamptz,
  published_at timestamptz, published_by uuid,
  parent_version_id uuid, restored_from_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, version, status, notes, structured_config, model, temperature, max_steps,
         created_by, created_at, updated_at, published_at, published_by,
         parent_version_id, restored_from_id
    FROM public.agent_prompt_versions
   WHERE public.is_platform_admin()
   ORDER BY version DESC;
$$;
REVOKE ALL ON FUNCTION public.agent_prompt_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_prompt_list() TO authenticated;

-- Create a draft cloned from a source version (defaults to active).
CREATE OR REPLACE FUNCTION public.agent_prompt_create_draft(p_from_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  src public.agent_prompt_versions%ROWTYPE;
  next_ver int;
  new_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  -- Reuse an existing draft if the caller already has one open.
  SELECT id INTO new_id FROM public.agent_prompt_versions WHERE status = 'draft' LIMIT 1;
  IF new_id IS NOT NULL THEN RETURN new_id; END IF;

  IF p_from_id IS NULL THEN
    SELECT * INTO src FROM public.agent_prompt_versions WHERE status = 'active' LIMIT 1;
  ELSE
    SELECT * INTO src FROM public.agent_prompt_versions WHERE id = p_from_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'source_not_found'; END IF;
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO next_ver FROM public.agent_prompt_versions;
  INSERT INTO public.agent_prompt_versions
    (version, status, system_prompt, model, temperature, max_steps, notes,
     structured_config, created_by, parent_version_id)
    VALUES (
      next_ver, 'draft',
      coalesce(public.agent_compile_prompt(coalesce(src.structured_config, '{}'::jsonb)), 'draft'),
      coalesce(src.model, 'google/gemini-2.5-flash'),
      coalesce(src.temperature, 0.2),
      coalesce(src.max_steps, 8),
      'Rascunho a partir da v' || coalesce(src.version::text, '?'),
      coalesce(src.structured_config, '{}'::jsonb),
      auth.uid(), src.id
    ) RETURNING id INTO new_id;

  INSERT INTO public.platform_admin_audit(actor_user_id, action, meta)
    VALUES (auth.uid(), 'agent_prompt_draft_created', jsonb_build_object('id', new_id, 'from', src.id));
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.agent_prompt_create_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_prompt_create_draft(uuid) TO authenticated;

-- Update draft with optimistic locking.
CREATE OR REPLACE FUNCTION public.agent_prompt_update_draft(
  p_id uuid, p_cfg jsonb, p_notes text, p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE row public.agent_prompt_versions%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO row FROM public.agent_prompt_versions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF row.status <> 'draft' THEN RAISE EXCEPTION 'not_a_draft'; END IF;
  IF p_expected_updated_at IS NOT NULL AND row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'concurrent_update';
  END IF;
  IF p_cfg IS NULL OR jsonb_typeof(p_cfg) <> 'object' THEN RAISE EXCEPTION 'invalid_config'; END IF;

  UPDATE public.agent_prompt_versions
     SET structured_config = p_cfg,
         system_prompt = public.agent_compile_prompt(p_cfg),
         notes = coalesce(p_notes, notes)
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'updated_at', now());
END $$;
REVOKE ALL ON FUNCTION public.agent_prompt_update_draft(uuid, jsonb, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_prompt_update_draft(uuid, jsonb, text, timestamptz) TO authenticated;

-- Publish a draft: archive current active, promote draft to active.
CREATE OR REPLACE FUNCTION public.agent_prompt_publish(p_id uuid, p_expected_updated_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE row public.agent_prompt_versions%ROWTYPE;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO row FROM public.agent_prompt_versions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF row.status <> 'draft' THEN RAISE EXCEPTION 'not_a_draft'; END IF;
  IF p_expected_updated_at IS NOT NULL AND row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'concurrent_update';
  END IF;

  UPDATE public.agent_prompt_versions SET status = 'archived' WHERE status = 'active';
  UPDATE public.agent_prompt_versions
     SET status = 'active',
         published_at = now(),
         published_by = auth.uid()
   WHERE id = p_id;

  INSERT INTO public.platform_admin_audit(actor_user_id, action, meta)
    VALUES (auth.uid(), 'agent_prompt_published', jsonb_build_object('id', p_id));
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.agent_prompt_publish(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_prompt_publish(uuid, timestamptz) TO authenticated;

-- Restore an archived version: creates a new draft copy.
CREATE OR REPLACE FUNCTION public.agent_prompt_restore(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE src public.agent_prompt_versions%ROWTYPE; next_ver int; new_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  -- Delete any open draft first (single-draft policy).
  DELETE FROM public.agent_prompt_versions WHERE status = 'draft';

  SELECT * INTO src FROM public.agent_prompt_versions WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT coalesce(max(version), 0) + 1 INTO next_ver FROM public.agent_prompt_versions;
  INSERT INTO public.agent_prompt_versions
    (version, status, system_prompt, model, temperature, max_steps, notes,
     structured_config, created_by, restored_from_id)
  VALUES (
    next_ver, 'draft',
    public.agent_compile_prompt(coalesce(src.structured_config,'{}'::jsonb)),
    src.model, src.temperature, src.max_steps,
    'Restaurado da v' || src.version::text,
    coalesce(src.structured_config,'{}'::jsonb),
    auth.uid(), src.id
  ) RETURNING id INTO new_id;

  INSERT INTO public.platform_admin_audit(actor_user_id, action, meta)
    VALUES (auth.uid(), 'agent_prompt_restored', jsonb_build_object('from', p_id, 'draft', new_id));
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.agent_prompt_restore(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_prompt_restore(uuid) TO authenticated;

-- Recompile the currently active row's system_prompt to include the safety layer.
UPDATE public.agent_prompt_versions
   SET system_prompt = public.agent_compile_prompt(structured_config)
 WHERE status = 'active';
