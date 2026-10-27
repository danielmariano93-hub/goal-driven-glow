-- O aviso "rolê fechado" para todos os integrantes expunha quem pagou fora da data
-- (quando o último atrasado pagava, todos recebiam "todo mundo pagou"). Deixa de existir.
-- Ponto único: as duas funções que enfileiram mensagens recusam o tipo 'completed',
-- cobrindo todos os caminhos de baixa (parcela, pagamento direto, WhatsApp).
do $$
declare d text; fn text;
begin
  for fn in select unnest(array[
    'public.split_enqueue_message(uuid,uuid,text,timestamp with time zone)',
    'public.split_enqueue_installment_message(uuid,uuid,uuid,text,timestamp with time zone)'
  ]) loop
    d := pg_get_functiondef(fn::regprocedure);
    d := regexp_replace(d, '\mBEGIN\M', E'BEGIN\n  IF p_kind = ''completed'' THEN RETURN NULL; END IF;');
    if d not like '%IF p_kind = ''completed'' THEN RETURN NULL%' then raise exception 'patch_not_applied: %', fn; end if;
    execute d;
  end loop;
end $$;

update public.reminder_jobs
   set status = 'skipped', last_error = 'completed_disabled', lease_expires_at = null, updated_at = now()
 where kind = 'completed' and status in ('queued', 'processing');
