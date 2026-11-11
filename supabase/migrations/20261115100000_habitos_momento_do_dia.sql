-- Hábitos: o "quando" passa a ser o momento do dia (Manhã, Tarde, Noite, Durante o dia), com um detalhe opcional.
-- Converte os textos antigos ("Depois do almoço") para o novo formato ("Tarde · depois do almoço"). Idempotente.
create or replace function pg_temp.hb_period_cue(t text) returns text language sql immutable as $$
  select case
    when t is null or btrim(t) = '' then t
    when t ~ '^(Manhã|Tarde|Noite|Durante o dia)( · |$)' then t
    when lower(t) ~ 'ao longo do dia|durante o dia|o dia todo' then 'Durante o dia'
    when lower(t) ~ 'acordar|café|cafe|manhã|manha|começar o dia|comecar o dia' then 'Manhã · ' || lower(left(t,1)) || substr(t,2)
    when lower(t) ~ 'almoço|almoco|tarde' then 'Tarde · ' || lower(left(t,1)) || substr(t,2)
    when lower(t) ~ 'trabalho|dormir|noite|jantar|escovar|deitar' then 'Noite · ' || lower(left(t,1)) || substr(t,2)
    else 'Durante o dia · ' || lower(left(t,1)) || substr(t,2)
  end
$$;

update public.hb_habits
   set cue_text = pg_temp.hb_period_cue(cue_text),
       cue_kind = case when pg_temp.hb_period_cue(cue_text) like '% · %' then 'after_event' else 'free' end
 where kind <> 'quit' and cue_text is not null and cue_text !~ '^(Manhã|Tarde|Noite|Durante o dia)( · |$)';

update public.hb_templates
   set cue_suggestion = pg_temp.hb_period_cue(cue_suggestion)
 where cue_suggestion is not null and cue_suggestion !~ '^(Manhã|Tarde|Noite|Durante o dia)( · |$)';
