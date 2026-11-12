-- Hábitos: horários dos registros, para a regularidade do horário. Só leitura: devolve quando cada dia foi marcado (a hora
-- já é guardada em hb_logs.logged_at desde o início) e o fuso da pessoa. Não altera nada.
create or replace function public.hb_log_times(p_days int default 90)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  today date;
  tz text;
  days int := greatest(7, least(coalesce(p_days, 90), 400));
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  today := public.hb_local_today(uid);
  select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into tz from public.notification_preferences where user_id = uid;
  return jsonb_build_object(
    'timezone', coalesce(tz, 'America/Sao_Paulo'),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('habit_id', l.habit_id, 'local_date', l.local_date, 'status', l.status, 'source', l.source, 'logged_at', l.logged_at) order by l.local_date)
                      from public.hb_logs l where l.user_id = uid and l.local_date >= today - days and l.status in ('done', 'minimum', 'quantity')), '[]'::jsonb)
  );
end $$;
revoke all on function public.hb_log_times(int) from public, anon;
grant execute on function public.hb_log_times(int) to authenticated;
