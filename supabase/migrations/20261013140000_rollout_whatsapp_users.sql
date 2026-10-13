-- Liberação, para todos os usuários com WhatsApp ATIVO, de recursos que estavam ligados só para uma conta:
--  1) relatório semanal "Gastos dia a dia" (monthly_partial, segunda 10h Brasília): inscrição automática a cada rodada
--     horária, só de quem tem WhatsApp ativo, lançamentos nos últimos 60 dias e relatório semanal ligado;
--  2) lembrete de vencimento no WhatsApp: ligado por padrão (desligável em Antecipações);
--  3) Hábitos v2: liberado para quem tem WhatsApp ativo.

create or replace function public.financial_report_schedules_enroll()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_added integer := 0;
begin
  insert into public.financial_report_schedules (user_id, schedule_key, report_type, local_weekday, local_hour, timezone, enabled)
  select p.id, 'monthly-current-monday-10-brasilia', 'monthly_partial', 1, 10, 'America/Sao_Paulo',
         coalesce(np.weekly_report_enabled, true)
    from public.profiles p
    left join public.notification_preferences np on np.user_id = p.id
   where exists (select 1 from public.whatsapp_links w where w.user_id = p.id and w.status = 'active')
     and exists (select 1 from public.transactions t
                  where t.user_id = p.id and t.status <> 'superseded' and t.occurred_at >= now() - interval '60 days')
  on conflict (user_id, schedule_key) do nothing;
  get diagnostics v_added = row_count;

  -- quem desligou o relatório semanal sai; quem religou volta
  update public.financial_report_schedules s
     set enabled = coalesce(np.weekly_report_enabled, true), updated_at = now()
    from public.profiles p
    left join public.notification_preferences np on np.user_id = p.id
   where s.user_id = p.id and s.schedule_key = 'monthly-current-monday-10-brasilia'
     and s.enabled is distinct from coalesce(np.weekly_report_enabled, true);
  return v_added;
end;
$$;
revoke all on function public.financial_report_schedules_enroll() from public, anon, authenticated;

create or replace function public.financial_report_schedules_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  s public.financial_report_schedules%rowtype;
  local_now timestamp without time zone;
  local_date date;
  request_id bigint;
  dispatched integer := 0;
  failed integer := 0;
  enrolled integer := 0;
begin
  begin
    enrolled := public.financial_report_schedules_enroll();
  exception when others then
    failed := failed + 1;
  end;

  for s in
    select * from public.financial_report_schedules where enabled = true order by id
  loop
    begin
      local_now := now() at time zone s.timezone;
      local_date := local_now::date;

      if extract(dow from local_now)::smallint <> s.local_weekday
         or extract(hour from local_now)::smallint <> s.local_hour
         or s.last_dispatched_local_date = local_date then
        continue;
      end if;

      request_id := public.financial_reports_targeted_tick(s.report_type, s.user_id);

      update public.financial_report_schedules
         set last_dispatched_local_date = local_date, last_dispatched_at = now(),
             last_request_id = request_id, last_error_code = null, updated_at = now()
       where id = s.id;
      dispatched := dispatched + 1;
    exception when others then
      failed := failed + 1;
      update public.financial_report_schedules
         set last_error_code = left(sqlstate || ':' || sqlerrm, 160), updated_at = now()
       where id = s.id;
    end;
  end loop;

  insert into public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed,updated_at)
  values ('financial-report-schedules', now(), failed = 0,
          case when failed > 0 then 'scheduled_dispatch_failures' else null end, dispatched, failed, now())
  on conflict (job_key) do update set
    last_run_at = excluded.last_run_at, last_ok = excluded.last_ok, last_error_code = excluded.last_error_code,
    processed = excluded.processed, failed = excluded.failed, updated_at = now();

  return jsonb_build_object('dispatched', dispatched, 'failed', failed, 'enrolled', enrolled);
end;
$function$;

alter table public.notification_preferences alter column due_reminders_enabled set default true;
update public.notification_preferences np
   set due_reminders_enabled = true
 where due_reminders_enabled = false
   and coalesce(np.whatsapp_proactive, true)
   and exists (select 1 from public.whatsapp_links w where w.user_id = np.user_id and w.status = 'active');

create or replace function public.habits_v2_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.whatsapp_links where user_id = auth.uid() and status = 'active');
$$;
