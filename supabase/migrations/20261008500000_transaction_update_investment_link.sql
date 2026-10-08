-- A tela "Detalhes do lançamento" passa a poder indicar (ou trocar) o investimento de um resgate/aplicação já
-- registrado. O gatilho de investimentos desfaz o vínculo antigo e aplica o novo à posição.
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.transaction_update_direct'::regproc);
  v_new := replace(v_def,
    E'  update public.transactions t set\n',
    E'  -- Investimento: só em aplicação/resgate e só do próprio usuário.\n  if p_patch ? ''investment_id'' and nullif(p_patch->>''investment_id'','''') is not null then\n    if not exists (select 1 from public.investments where id = (p_patch->>''investment_id'')::uuid and user_id = auth.uid()) then\n      return jsonb_build_object(''ok'', false, ''error'', ''investment_not_found'');\n    end if;\n    if exists (select 1 from public.transactions x where x.id = any(affected_ids) and coalesce(x.movement_kind, ''transaction'') not in (''investment_application'', ''investment_redemption'')) then\n      return jsonb_build_object(''ok'', false, ''error'', ''investment_only_for_investment_movements'');\n    end if;\n  end if;\n\n  update public.transactions t set\n');
  v_new := replace(v_new,
    E'                   else t.credit_card_id end\n  where t.id = any(affected_ids)',
    E'                   else t.credit_card_id end,\n    investment_id = case when p_patch ? ''investment_id'' then nullif(p_patch->>''investment_id'','''')::uuid else t.investment_id end\n  where t.id = any(affected_ids)');
  if v_new = v_def or position('investment_not_found' in v_new) = 0 or position('investment_id = case' in v_new) = 0 then
    raise exception 'transaction_update_direct: trechos nao encontrados';
  end if;
  execute v_new;
end
$$;
