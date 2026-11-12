-- Hábitos: ritmo do dia. Cada inclusão de uma quantidade (ex.: +500 ml de água) passa a guardar sua hora,
-- sem mudar nenhum caminho de gravação: um gatilho em hb_logs deriva as entradas a partir da variação do total do dia.
-- Dias antigos (ou registrados depois, via "dia anterior") ficam sem hora ("at" nulo): entram no total, não no gráfico por hora.

create table if not exists public.hb_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  local_date date not null,
  amount numeric not null check (amount > 0),
  at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hb_entries_habit_date_idx on public.hb_entries (user_id, habit_id, local_date);
alter table public.hb_entries enable row level security;
drop policy if exists hb_entries_select_own on public.hb_entries;
create policy hb_entries_select_own on public.hb_entries for select to authenticated using (user_id = auth.uid());
revoke all on public.hb_entries from anon, public;
grant select on public.hb_entries to authenticated;

create or replace function public.hb_entries_sync() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  old_q numeric := 0;
  new_q numeric := 0;
  delta numeric;
  stamp timestamptz;
  r record;
  left_over numeric;
begin
  if tg_op = 'DELETE' then
    delete from public.hb_entries where habit_id = old.habit_id and local_date = old.local_date;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'quantity' then old_q := coalesce(old.quantity, 0); end if;
  if new.status = 'quantity' then new_q := coalesce(new.quantity, 0); end if;
  delta := new_q - old_q;
  if delta = 0 then return new; end if;
  if delta > 0 then
    -- Só o dia de hoje (e fora de "dia anterior") tem hora real; o resto entra sem hora.
    stamp := case when new.local_date = public.hb_local_today(new.user_id) and new.source <> 'backfill' then now() else null end;
    insert into public.hb_entries (user_id, habit_id, local_date, amount, at) values (new.user_id, new.habit_id, new.local_date, delta, stamp);
  else
    -- Total diminuiu (correção): tira das inclusões mais recentes; as sem hora saem por último.
    left_over := -delta;
    for r in select id, amount from public.hb_entries
              where habit_id = new.habit_id and local_date = new.local_date
              order by at desc nulls last, created_at desc loop
      exit when left_over <= 0;
      if r.amount <= left_over then
        delete from public.hb_entries where id = r.id;
        left_over := left_over - r.amount;
      else
        update public.hb_entries set amount = amount - left_over where id = r.id;
        left_over := 0;
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.hb_entries_sync() from public, anon, authenticated;

drop trigger if exists hb_logs_entries_sync on public.hb_logs;
create trigger hb_logs_entries_sync after insert or update of status, quantity or delete on public.hb_logs
  for each row execute function public.hb_entries_sync();

-- Dados do ritmo de um hábito: inclusões com hora (últimos p_days dias) + vontades (hábitos de largar) + fuso da pessoa.
create or replace function public.hb_rhythm_data(p_habit uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  today date;
  tz text;
  days int := greatest(1, least(coalesce(p_days, 30), 120));
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.hb_habits where id = p_habit and user_id = uid) then raise exception 'not_found' using errcode = 'P0002'; end if;
  today := public.hb_local_today(uid);
  select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into tz from public.notification_preferences where user_id = uid;
  return jsonb_build_object(
    'timezone', coalesce(tz, 'America/Sao_Paulo'),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('local_date', e.local_date, 'amount', e.amount, 'at', e.at) order by e.local_date, e.created_at)
                         from public.hb_entries e where e.user_id = uid and e.habit_id = p_habit and e.local_date >= today - days), '[]'::jsonb),
    'cravings', coalesce((select jsonb_agg(jsonb_build_object('occurred_at', c.occurred_at, 'handled', c.handled) order by c.occurred_at)
                          from public.hb_cravings c where c.user_id = uid and c.habit_id = p_habit and c.local_date >= today - days), '[]'::jsonb)
  );
end $$;
revoke all on function public.hb_rhythm_data(uuid, int) from public, anon;
grant execute on function public.hb_rhythm_data(uuid, int) to authenticated;
