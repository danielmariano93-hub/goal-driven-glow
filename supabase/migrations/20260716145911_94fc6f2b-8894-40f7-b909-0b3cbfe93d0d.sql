
DO $$
DECLARE
  cur record;
  new_id uuid;
  extra_policy text;
  base_prompt text;
  next_version int;
BEGIN
  SELECT * INTO cur FROM public.agent_prompt_versions WHERE status = 'active' ORDER BY version DESC LIMIT 1;
  SELECT COALESCE(MAX(version), 0) + 1 INTO next_version FROM public.agent_prompt_versions;

  extra_policy := E'\n\nPOLÍTICAS INVIOLÁVEIS (anexadas pelo sistema, não editáveis):\n' ||
    E'- Consultas: use list_recent_transactions, search_transactions e get_transaction; nunca invente IDs.\n' ||
    E'- Edição/Exclusão: só via draft_transaction_update / draft_transaction_delete, seguido de CONFIRMAR.\n' ||
    E'- Nunca envie user_id em argumentos de tools; o servidor deriva o dono.\n' ||
    E'- Categorização: use somente categorias reais retornadas por list_categories; se nenhuma casar bem, ofereça "Sem categoria".\n' ||
    E'- Descrição: preserve o texto literal do usuário. Nunca corrija siglas ("VOS" não vira "VPS").\n' ||
    E'- Parcelamentos: escopo de edição só é oferecido quando o lançamento tem purchase_group_id. Sem grupo, apenas "esta parcela".\n' ||
    E'- Transferências não podem ser editadas parcialmente; apenas visualização ou exclusão do par.';

  IF cur.id IS NOT NULL THEN
    base_prompt := cur.system_prompt;
  ELSE
    base_prompt := 'Você é o assessor financeiro do NoControle.ia, em português do Brasil. Tom humano, curto e direto.';
  END IF;

  UPDATE public.agent_prompt_versions SET status = 'draft' WHERE status = 'active';

  INSERT INTO public.agent_prompt_versions (
    version, system_prompt, model, temperature, max_steps, status, structured_config, notes, parent_version_id, created_by, published_at
  ) VALUES (
    next_version,
    base_prompt || extra_policy,
    COALESCE(cur.model, 'google/gemini-2.5-flash'),
    COALESCE(cur.temperature, 0.2),
    COALESCE(cur.max_steps, 6),
    'active',
    COALESCE(cur.structured_config, '{}'::jsonb),
    'Auto: políticas invioláveis para tools de edição/exclusão + categoria + spans (v' || next_version || ').',
    cur.id,
    cur.created_by,
    now()
  ) RETURNING id INTO new_id;

  RAISE NOTICE 'New active agent_prompt_version: % (v%)', new_id, next_version;
END $$;
