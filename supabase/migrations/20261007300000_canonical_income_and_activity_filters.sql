-- Regra contábil única: renda e "gasto registrado" só contam lançamentos de rotina
-- (movement_kind = 'transaction', sem transferência entre contas nem pagamento de fatura).
-- Resgate, estorno, Pix de terceiros, empréstimo e aplicação NÃO são renda nem gasto.
-- Os corpos são reescritos a partir da definição vigente (falha se o trecho não for encontrado).
do $$
declare
  v_def text;
  v_new text;
begin
  -- 1) taxa de aporte: a renda dos últimos 90 dias era a soma de TODA entrada.
  v_def := pg_get_functiondef('public.behavior_observed_backfill_v2'::regproc);
  v_new := replace(v_def,
    E'and type::text = ''income'' and occurred_at::date between v_as_of - 89 and v_as_of;',
    E'and type::text = ''income'' and coalesce(movement_kind::text,''transaction'') = ''transaction''\n       and transfer_group_id is null and settles_card_id is null\n       and occurred_at::date between v_as_of - 89 and v_as_of;');
  if v_new = v_def then raise exception 'behavior_observed_backfill_v2: trecho nao encontrado'; end if;
  execute v_new;

  -- 2) desafio "registrar gastos": dia com pagamento de fatura/aplicação não é dia de gasto registrado.
  v_def := pg_get_functiondef('public.challenge_sync_activity'::regproc);
  v_new := replace(v_def,
    E'and t.type = ''expense''\n         and t.status = ''confirmed''',
    E'and t.type = ''expense''\n         and t.status = ''confirmed''\n         and coalesce(t.movement_kind::text, ''transaction'') = ''transaction''\n         and t.transfer_group_id is null and t.settles_card_id is null');
  if v_new = v_def then raise exception 'challenge_sync_activity: trecho nao encontrado'; end if;
  execute v_new;
end
$$;
