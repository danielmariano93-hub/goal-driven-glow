-- Rebranding NoControle -> MeuNino: atualiza apenas configurações ativas.
-- Idempotente: uma segunda execução não encontra mais ocorrências e é no-op.

-- 1) Versões de prompt do assistente (apenas draft/active).
UPDATE public.agent_prompt_versions
SET
  system_prompt = regexp_replace(
                    regexp_replace(system_prompt, 'NoControle\.ia', 'MeuNino', 'g'),
                    'NoControle', 'MeuNino', 'g'
                  ),
  notes = CASE
    WHEN notes IS NULL THEN NULL
    ELSE regexp_replace(
           regexp_replace(notes, 'NoControle\.ia', 'MeuNino', 'g'),
           'NoControle', 'MeuNino', 'g'
         )
  END,
  updated_at = now()
WHERE status IN ('draft', 'active')
  AND (
        system_prompt ~ 'NoControle'
    OR (notes IS NOT NULL AND notes ~ 'NoControle')
  );

-- 2) Campos textuais dentro do structured_config, quando presentes.
-- Só toca em chaves conhecidas e preserva ausências (jsonb_set com create_missing=false).
UPDATE public.agent_prompt_versions AS v
SET structured_config = sub.cfg,
    updated_at = now()
FROM (
  SELECT
    id,
    (
      SELECT jsonb_object_agg(
        k,
        CASE
          WHEN k IN ('name','signature','welcome','fallback','greeting','goodbye','sign_off','signoff')
               AND jsonb_typeof(val) = 'string'
            THEN to_jsonb(
                   regexp_replace(
                     regexp_replace(val #>> '{}', 'NoControle\.ia', 'MeuNino', 'g'),
                     'NoControle', 'MeuNino', 'g'
                   )
                 )
          ELSE val
        END
      )
      FROM jsonb_each(structured_config) AS e(k, val)
    ) AS cfg
  FROM public.agent_prompt_versions
  WHERE status IN ('draft','active')
    AND structured_config::text ~ 'NoControle'
) AS sub
WHERE v.id = sub.id
  AND sub.cfg IS NOT NULL
  AND sub.cfg::text <> v.structured_config::text;
