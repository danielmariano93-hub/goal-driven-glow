-- Hábitos: anotação de leitura passa a aceitar até 3.000 caracteres (antes 500), para caber um resumo de capítulo colado.
alter table public.hb_project_notes drop constraint if exists hb_project_notes_body_check;
alter table public.hb_project_notes add constraint hb_project_notes_body_check check (char_length(btrim(body)) between 1 and 3000);

create or replace function public.hb_project_note_add(p_project uuid, p_body text, p_page numeric default null, p_date date default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); pr public.hb_projects; v_id uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(btrim(p_body)) > 3000 then raise exception 'invalid_note' using errcode = '22023'; end if;
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
