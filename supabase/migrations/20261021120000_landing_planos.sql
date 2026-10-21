-- Planos da landing, editáveis pelo admin, com fake door ("Em breve" + lista de espera) e métricas de interesse.
-- Nada aqui cobra ou libera/bloqueia funcionalidade: é vitrine e medição. Quem já usa o app continua com tudo liberado.

create table if not exists public.landing_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,30}$'),
  name text not null check (char_length(name) between 1 and 40),
  tagline text check (tagline is null or char_length(tagline) <= 160),
  price_monthly numeric(8,2) check (price_monthly is null or price_monthly >= 0),
  price_yearly numeric(8,2) check (price_yearly is null or price_yearly >= 0),
  availability text not null default 'available' check (availability in ('available', 'coming_soon')),
  cta_label text not null default 'Começar' check (char_length(cta_label) between 1 and 40),
  badge text check (badge is null or char_length(badge) <= 24),
  highlighted boolean not null default false,
  active boolean not null default true,
  position int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.landing_plan_features (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (char_length(label) between 1 and 80),
  description text check (description is null or char_length(description) <= 160),
  position int not null default 0
);

create table if not exists public.landing_plan_feature_values (
  plan_id uuid not null references public.landing_plans(id) on delete cascade,
  feature_id uuid not null references public.landing_plan_features(id) on delete cascade,
  value text not null check (value in ('yes', 'limited', 'no')),
  note text check (note is null or char_length(note) <= 60),
  primary key (plan_id, feature_id)
);

create table if not exists public.plan_waitlist (
  id uuid primary key default gen_random_uuid(),
  plan_slug text not null,
  email text not null check (char_length(email) <= 160),
  price_intent text check (price_intent is null or price_intent in ('ate_20', '20_30', '30_50', 'mais_50', 'nao_sei')),
  consent boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_plan_waitlist_email on public.plan_waitlist (plan_slug, lower(email));

create table if not exists public.plan_interest_events (
  id bigserial primary key,
  plan_slug text not null,
  event text not null check (event in ('view', 'click_cta', 'waitlist_open', 'waitlist_join')),
  session_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_plan_interest_created on public.plan_interest_events (created_at desc);

alter table public.landing_plans enable row level security;
alter table public.landing_plan_features enable row level security;
alter table public.landing_plan_feature_values enable row level security;
alter table public.plan_waitlist enable row level security;
alter table public.plan_interest_events enable row level security;
revoke all on public.landing_plans, public.landing_plan_features, public.landing_plan_feature_values, public.plan_waitlist, public.plan_interest_events from anon, authenticated;
grant all on public.landing_plans, public.landing_plan_features, public.landing_plan_feature_values, public.plan_waitlist, public.plan_interest_events to service_role;

-- Leitura pública da vitrine.
create or replace function public.landing_plans_public()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('plans', coalesce(jsonb_agg(x.p order by x.position), '[]'::jsonb))
  from (
    select pl.position, jsonb_build_object(
      'slug', pl.slug, 'name', pl.name, 'tagline', pl.tagline,
      'price_monthly', pl.price_monthly, 'price_yearly', pl.price_yearly,
      'availability', pl.availability, 'cta_label', pl.cta_label, 'badge', pl.badge, 'highlighted', pl.highlighted,
      'features', coalesce((
        select jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label, 'description', f.description, 'value', v.value, 'note', v.note) order by f.position)
        from public.landing_plan_features f
        join public.landing_plan_feature_values v on v.feature_id = f.id and v.plan_id = pl.id
      ), '[]'::jsonb)
    ) as p
    from public.landing_plans pl where pl.active
  ) x
$$;
revoke all on function public.landing_plans_public() from public;
grant execute on function public.landing_plans_public() to anon, authenticated;

-- Entrada na lista de espera (pública, validada, com teto por hora).
create or replace function public.plan_waitlist_join(p_plan text, p_email text, p_intent text default null, p_consent boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 160 then return jsonb_build_object('ok', false, 'error', 'invalid_email'); end if;
  if not coalesce(p_consent, false) then return jsonb_build_object('ok', false, 'error', 'consent_required'); end if;
  if not exists (select 1 from public.landing_plans where slug = p_plan and active) then return jsonb_build_object('ok', false, 'error', 'invalid_plan'); end if;
  if (select count(*) from public.plan_waitlist where created_at > now() - interval '1 hour') >= 300 then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  insert into public.plan_waitlist(plan_slug, email, price_intent, consent)
  values (p_plan, v_email, case when p_intent in ('ate_20', '20_30', '30_50', 'mais_50', 'nao_sei') then p_intent end, true)
  on conflict (plan_slug, lower(email)) do nothing
  returning id into v_id;
  if v_id is not null then insert into public.plan_interest_events(plan_slug, event) values (p_plan, 'waitlist_join'); end if;
  return jsonb_build_object('ok', true, 'already', v_id is null);
end $$;
revoke all on function public.plan_waitlist_join(text, text, text, boolean) from public;
grant execute on function public.plan_waitlist_join(text, text, text, boolean) to anon, authenticated;

-- Eventos de interesse (visualização, clique, abertura do formulário).
create or replace function public.plan_interest_track(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare it jsonb; n int := 0;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return 0; end if;
  if (select count(*) from public.plan_interest_events where created_at > now() - interval '1 hour') >= 5000 then return 0; end if;
  for it in select * from jsonb_array_elements(p_events) limit 10 loop
    continue when coalesce(it->>'event', '') not in ('view', 'click_cta', 'waitlist_open');
    continue when not exists (select 1 from public.landing_plans where slug = it->>'plan');
    insert into public.plan_interest_events(plan_slug, event, session_id) values (it->>'plan', it->>'event', left(it->>'session', 40));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.plan_interest_track(jsonb) from public;
grant execute on function public.plan_interest_track(jsonb) to anon, authenticated;

-- Admin: ler tudo (planos, catálogo, valores, métricas e lista de espera).
create or replace function public.admin_landing_plans_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'plans', coalesce((select jsonb_agg(to_jsonb(p) - 'id' - 'updated_at' order by p.position) from public.landing_plans p), '[]'::jsonb),
    'features', coalesce((select jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label, 'description', f.description) order by f.position) from public.landing_plan_features f), '[]'::jsonb),
    'values', coalesce((select jsonb_agg(jsonb_build_object('plan', p.slug, 'feature', f.key, 'value', v.value, 'note', v.note))
        from public.landing_plan_feature_values v join public.landing_plans p on p.id = v.plan_id join public.landing_plan_features f on f.id = v.feature_id), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(m order by m.plan_slug) from (
        select pl.slug as plan_slug,
               count(*) filter (where e.event = 'view') as views,
               count(distinct e.session_id) filter (where e.event = 'view') as viewers,
               count(*) filter (where e.event = 'click_cta') as clicks,
               count(*) filter (where e.event = 'waitlist_open') as opens,
               (select count(*) from public.plan_waitlist w where w.plan_slug = pl.slug) as joins
          from public.landing_plans pl
          left join public.plan_interest_events e on e.plan_slug = pl.slug and e.created_at > now() - interval '30 days'
         group by pl.slug) m), '[]'::jsonb),
    'intent', coalesce((select jsonb_agg(jsonb_build_object('plan', plan_slug, 'intent', coalesce(price_intent, 'nao_informou'), 'n', n))
        from (select plan_slug, price_intent, count(*) n from public.plan_waitlist group by 1, 2) i), '[]'::jsonb),
    'waitlist', coalesce((select jsonb_agg(jsonb_build_object('plan', plan_slug, 'email', email, 'intent', price_intent, 'at', created_at) order by created_at desc)
        from (select * from public.plan_waitlist order by created_at desc limit 200) w), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_landing_plans_get() from public, anon;
grant execute on function public.admin_landing_plans_get() to authenticated;

-- Admin: salvar a configuração inteira de uma vez (planos, catálogo e valores).
-- Dividido em duas partes internas (sem acesso direto) para manter cada função pequena.
create or replace function public.landing_save_plans_part(_doc jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare pl jsonb; i int := 0;
begin
  for pl in select * from jsonb_array_elements(_doc->'plans') loop
    insert into public.landing_plans(slug, name, tagline, price_monthly, price_yearly, availability, cta_label, badge, highlighted, active, position, updated_at)
    values (pl->>'slug', pl->>'name', nullif(pl->>'tagline', ''),
            nullif(pl->>'price_monthly', '')::numeric, nullif(pl->>'price_yearly', '')::numeric,
            coalesce(nullif(pl->>'availability', ''), 'available'), coalesce(nullif(pl->>'cta_label', ''), 'Começar'),
            nullif(pl->>'badge', ''), coalesce((pl->>'highlighted')::boolean, false), coalesce((pl->>'active')::boolean, true), i, now())
    on conflict (slug) do update set name = excluded.name, tagline = excluded.tagline, price_monthly = excluded.price_monthly,
      price_yearly = excluded.price_yearly, availability = excluded.availability, cta_label = excluded.cta_label, badge = excluded.badge,
      highlighted = excluded.highlighted, active = excluded.active, position = excluded.position, updated_at = now();
    i := i + 1;
  end loop;
end $$;

create or replace function public.landing_save_features_part(_doc jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare ft jsonb; vl jsonb; j int := 0; v_plan uuid; v_feat uuid;
begin
  delete from public.landing_plans where slug <> all(array(select x->>'slug' from jsonb_array_elements(_doc->'plans') x));
  for ft in select * from jsonb_array_elements(_doc->'features') loop
    insert into public.landing_plan_features(key, label, description, position)
    values (ft->>'key', ft->>'label', nullif(ft->>'description', ''), j)
    on conflict (key) do update set label = excluded.label, description = excluded.description, position = excluded.position;
    j := j + 1;
  end loop;
  delete from public.landing_plan_features where key <> all(array(select x->>'key' from jsonb_array_elements(_doc->'features') x));
  delete from public.landing_plan_feature_values where true;
  for vl in select * from jsonb_array_elements(_doc->'values') loop
    select id into v_plan from public.landing_plans where slug = vl->>'plan';
    select id into v_feat from public.landing_plan_features where key = vl->>'feature';
    continue when v_plan is null or v_feat is null;
    insert into public.landing_plan_feature_values(plan_id, feature_id, value, note)
    values (v_plan, v_feat, coalesce(nullif(vl->>'value', ''), 'no'), nullif(vl->>'note', ''));
  end loop;
end $$;
revoke all on function public.landing_save_plans_part(jsonb) from public, anon, authenticated;
revoke all on function public.landing_save_features_part(jsonb) from public, anon, authenticated;

create or replace function public.admin_landing_plans_save(_doc jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_current_user_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(_doc->'plans') <> 'array' or jsonb_typeof(_doc->'features') <> 'array' or jsonb_typeof(_doc->'values') <> 'array' then
    raise exception 'invalid_doc' using errcode = '22023';
  end if;
  if jsonb_array_length(_doc->'plans') > 6 or jsonb_array_length(_doc->'features') > 30 then raise exception 'too_large' using errcode = '22023'; end if;
  perform public.landing_save_plans_part(_doc);
  perform public.landing_save_features_part(_doc);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_landing_plans_save(jsonb) from public, anon;
grant execute on function public.admin_landing_plans_save(jsonb) to authenticated;

-- Conteúdo inicial (editável pelo admin).
insert into public.landing_plans(slug,name,tagline,price_monthly,price_yearly,availability,cta_label,badge,highlighted,position) values
('gratis','Grátis','Para começar a organizar',0.00,null,'available','Quero meu Nino grátis',null,false,0),
('nino','Nino','O Nino cuidando do seu dinheiro com você',19.90,179.90,'available','Quero o Nino','Recomendado',true,1),
('conecta','Nino Conecta','Tudo automático: conecte os bancos e esqueça',null,null,'coming_soon','Entrar na lista de espera','Em breve',false,2)
on conflict (slug) do nothing;
insert into public.landing_plan_features(key,label,description,position) values
('lancamentos','Lançamentos, contas e cartões','Registre e organize tudo à mão',0),
('categorias','Categorias e relatórios','Veja para onde o dinheiro vai',1),
('metas','Metas de gasto por categoria','Teto por categoria com ritmo do mês',2),
('nino_app','Nino no app','Converse e tire dúvidas sobre o seu mês',3),
('whatsapp','Nino no WhatsApp','Registre por texto, áudio ou foto',4),
('assessor','Importar extrato e fatura','PDF, OFX e foto, com revisão antes de lançar',5),
('proativo','Alertas e insights do Nino','Avisos antes de o mês apertar',6),
('mapa','Mapa Financeiro','Leitura completa da sua saúde financeira',7),
('habitos','Hábitos e ajuste de metas avaliado','O Nino diz se o ajuste valeu a pena',8),
('role','Divisão do rolê','Divida contas e cobre com lembretes',9),
('open_finance','Bancos conectados (Open Finance)','Conecte seus bancos direto',10),
('sync_auto','Sincronização automática','Atualiza sozinho, todo dia',11)
on conflict (key) do nothing;
insert into public.landing_plan_feature_values(plan_id,feature_id,value,note)
select p.id,f.id,v.value,v.note from (values
('gratis','lancamentos','yes',null),
('nino','lancamentos','yes',null),
('conecta','lancamentos','yes',null),
('gratis','categorias','yes',null),
('nino','categorias','yes',null),
('conecta','categorias','yes',null),
('gratis','metas','limited','até 3 metas'),
('nino','metas','yes',null),
('conecta','metas','yes',null),
('gratis','nino_app','limited','limite diário'),
('nino','nino_app','yes',null),
('conecta','nino_app','yes',null),
('gratis','whatsapp','no',null),
('nino','whatsapp','yes',null),
('conecta','whatsapp','yes',null),
('gratis','assessor','no',null),
('nino','assessor','yes',null),
('conecta','assessor','yes',null),
('gratis','proativo','limited','resumo básico'),
('nino','proativo','yes',null),
('conecta','proativo','yes',null),
('gratis','mapa','limited','resumo'),
('nino','mapa','yes',null),
('conecta','mapa','yes',null),
('gratis','habitos','no',null),
('nino','habitos','yes',null),
('conecta','habitos','yes',null),
('gratis','role','limited','1 rolê por mês'),
('nino','role','yes',null),
('conecta','role','yes',null),
('gratis','open_finance','no',null),
('nino','open_finance','no',null),
('conecta','open_finance','yes',null),
('gratis','sync_auto','no',null),
('nino','sync_auto','no',null),
('conecta','sync_auto','yes',null)
) as v(plan,feature,value,note)
join public.landing_plans p on p.slug=v.plan join public.landing_plan_features f on f.key=v.feature
on conflict do nothing;
