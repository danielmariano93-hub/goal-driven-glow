-- O vigia contava eventos vazios do WAHA (corpo vazio, sem mídia) como "mensagem não processada":
-- 8 eventos de ontem gerariam um alerta crítico falso por 2 dias.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.ops_alerts_evaluate()'::regprocedure);
  d := replace(d, 'where from_phone is not null and processed_at is null and ignored_reason is null',
                  'where from_phone is not null and processed_at is null and ignored_reason is null and (coalesce(btrim(body), '''') <> '''' or coalesce(has_media, false))');
  if d not like '%coalesce(btrim(body)%' then raise exception 'patch_not_applied: ops_alerts_evaluate'; end if;
  execute d;
end $$;
