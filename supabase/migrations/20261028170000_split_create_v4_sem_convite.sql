-- Criar a divisão sem avisar as pessoas da inclusão: só os lembretes do vencimento e a cobrança de atraso.
-- Os jobs de convite (e o follow-up de 48h, que só nasce depois do convite) são descartados na MESMA transação
-- da criação, antes de qualquer despachante enxergá-los. Nada é enviado.
create or replace function public.split_create_v4(
  p_title text, p_total numeric, p_occurred_at date, p_due_date date, p_split_mode split_mode,
  p_include_owner boolean, p_reminder_enabled boolean, p_pix_key text, p_participants jsonb,
  p_owner_amount numeric default null, p_source_account_id uuid default null, p_source_credit_card_id uuid default null,
  p_reimbursement_account_id uuid default null, p_category_id uuid default null, p_register_transaction boolean default true,
  p_installments jsonb default null, p_send_invite boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then raise exception 'Sessão expirada'; end if;
  new_id := public.split_create_v3(
    p_title, p_total, p_occurred_at, p_due_date, p_split_mode, p_include_owner, p_reminder_enabled, p_pix_key, p_participants,
    p_owner_amount, p_source_account_id, p_source_credit_card_id, p_reimbursement_account_id, p_category_id, p_register_transaction,
    p_installments);

  if not coalesce(p_send_invite, true) then
    update public.reminder_jobs
       set status = 'skipped', cancel_reason = 'invite_suppressed', last_error = 'invite_suppressed',
           lease_expires_at = null, updated_at = now()
     where shared_expense_id = new_id
       and owner_user_id = uid
       and kind in ('invite', 'reminder')
       and status in ('queued', 'processing');

    insert into public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
    values (new_id, uid, 'invite_suppressed', jsonb_build_object('reason', 'owner_chose_no_invite'));

    -- Lembretes do vencimento e da cobrança de atraso já ficam agendados.
    if coalesce(p_reminder_enabled, false) then
      perform public.schedule_split_due_reminders(new_id);
    end if;
  end if;
  return new_id;
end;
$$;

revoke all on function public.split_create_v4(text, numeric, date, date, split_mode, boolean, boolean, text, jsonb, numeric, uuid, uuid, uuid, uuid, boolean, jsonb, boolean) from public, anon;
grant execute on function public.split_create_v4(text, numeric, date, date, split_mode, boolean, boolean, text, jsonb, numeric, uuid, uuid, uuid, uuid, boolean, jsonb, boolean) to authenticated;
