-- Lembretes de vencimento no WhatsApp (nino_due_reminders.v1).
-- Canal dedicado: quem liga recebe, no horário escolhido, uma mensagem com o que vence hoje/amanhã.
-- Opt-in explícito (consentimento registrado); nada é enviado para quem não ligou.

alter table public.notification_preferences
  add column if not exists due_reminders_enabled boolean not null default false,
  add column if not exists due_reminders_days smallint[] not null default '{1,0}',
  add column if not exists due_reminders_hour smallint not null default 9,
  add column if not exists due_reminders_consent_at timestamptz;

alter table public.notification_preferences
  drop constraint if exists notification_preferences_due_reminders_hour_check,
  add constraint notification_preferences_due_reminders_hour_check check (due_reminders_hour between 0 and 23),
  drop constraint if exists notification_preferences_due_reminders_days_check,
  add constraint notification_preferences_due_reminders_days_check
    check (due_reminders_days <@ array[0,1,2,3,5,7]::smallint[] and cardinality(due_reminders_days) between 1 and 4);

-- Registro do que já foi avisado: cada obrigação avisa uma vez por etapa (dias antes do vencimento).
create table if not exists public.due_reminder_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  obligation_key text not null,
  due_date date not null,
  days_before smallint not null,
  outbound_message_id uuid,
  sent_for_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, obligation_key, days_before)
);
create index if not exists idx_due_reminder_log_user_due on public.due_reminder_log (user_id, due_date);

alter table public.due_reminder_log enable row level security;
drop policy if exists "due_reminder_log_select_own" on public.due_reminder_log;
create policy "due_reminder_log_select_own" on public.due_reminder_log for select to authenticated using (user_id = auth.uid());
revoke all on public.due_reminder_log from anon, public;
grant select on public.due_reminder_log to authenticated;

-- Execução horária (minuto 5): a função só age para quem escolheu aquele horário.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'due-reminders-hourly') then
    perform cron.unschedule('due-reminders-hourly');
  end if;
  perform cron.schedule('due-reminders-hourly', '5 * * * *', $cmd$
      SELECT net.http_post(
        url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/due-reminders-tick',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || coalesce(current_setting('app.settings.anon_key', true), ''),
          'x-cron-secret', coalesce((
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
            ORDER BY CASE name
              WHEN 'INTERNAL_CRON_SECRET' THEN 0
              WHEN 'meunino_cron_secret' THEN 1
              ELSE 2
            END, created_at DESC
            LIMIT 1
          ), '')
        ),
        body := jsonb_build_object('source','cron','time',now())
      );
    $cmd$);
end $$;
