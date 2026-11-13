-- Hábitos: anotações de leitura. Ao registrar páginas (ou em outro momento) a pessoa pode escrever em 1 ou 2 frases
-- o que ficou da leitura. As anotações pertencem ao projeto (o livro) e, ao terminar, viram um resumo em tópicos
-- feito SÓ a partir do que a pessoa escreveu (a IA organiza, não acrescenta). Tudo só adiciona.

alter table public.hb_projects add column if not exists summary text;
alter table public.hb_projects drop constraint if exists hb_projects_summary_len;
alter table public.hb_projects add constraint hb_projects_summary_len check (summary is null or char_length(summary) <= 2000);

create table if not exists public.hb_project_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.hb_projects(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  page numeric check (page is null or page >= 0),
  noted_on date not null,
  created_at timestamptz not null default now()
);
create index if not exists hb_project_notes_project_idx on public.hb_project_notes (project_id, created_at);

alter table public.hb_project_notes enable row level security;
drop policy if exists hb_project_notes_select_own on public.hb_project_notes;
create policy hb_project_notes_select_own on public.hb_project_notes for select to authenticated using (user_id = auth.uid());
revoke all on public.hb_project_notes from anon, public;
grant select on public.hb_project_notes to authenticated;

-- Anotações e resumos dos projetos de um hábito (o aberto e os concluídos).
create or replace function public.hb_project_notes_data(p_habit uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if not exists (select 1 from public.hb_habits where id = p_habit and user_id = uid) then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'project_id', n.project_id, 'body', n.body, 'page', n.page, 'noted_on', n.noted_on) order by n.created_at)
      from public.hb_project_notes n join public.hb_projects pr on pr.id = n.project_id
      where pr.habit_id = p_habit and n.user_id = uid), '[]'::jsonb),
    'summaries', coalesce((
      select jsonb_agg(jsonb_build_object('project_id', pr.id, 'summary', pr.summary))
      from public.hb_projects pr where pr.habit_id = p_habit and pr.user_id = uid and pr.summary is not null), '[]'::jsonb)
  );
end $$;
revoke all on function public.hb_project_notes_data(uuid) from public, anon;
grant execute on function public.hb_project_notes_data(uuid) to authenticated;

create or replace function public.hb_project_note_add(p_project uuid, p_body text, p_page numeric default null, p_date date default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); pr public.hb_projects; v_id uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(btrim(p_body)) > 500 then raise exception 'invalid_note' using errcode = '22023'; end if;
  select * into pr from public.hb_projects where id = p_project and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select count(*) from public.hb_project_notes where project_id = p_project) >= 300 then raise exception 'note_limit_reached' using errcode = '54000'; end if;
  insert into public.hb_project_notes (user_id, project_id, body, page, noted_on)
  values (uid, p_project, btrim(p_body), case when p_page is null then null else least(greatest(p_page, 0), pr.total) end, coalesce(p_date, public.hb_local_today(uid)))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.hb_project_note_add(uuid, text, numeric, date) from public, anon;
grant execute on function public.hb_project_note_add(uuid, text, numeric, date) to authenticated;

create or replace function public.hb_project_note_delete(p_note uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from public.hb_project_notes where id = p_note and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.hb_project_note_delete(uuid) from public, anon;
grant execute on function public.hb_project_note_delete(uuid) to authenticated;

-- Guarda o resumo do livro (gerado a partir das anotações e editado pela pessoa). Texto vazio apaga.
create or replace function public.hb_project_summary_set(p_project uuid, p_summary text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); v text := nullif(btrim(coalesce(p_summary, '')), '');
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if v is not null and char_length(v) > 2000 then raise exception 'invalid_summary' using errcode = '22023'; end if;
  update public.hb_projects set summary = v where id = p_project and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.hb_project_summary_set(uuid, text) from public, anon;
grant execute on function public.hb_project_summary_set(uuid, text) to authenticated;
