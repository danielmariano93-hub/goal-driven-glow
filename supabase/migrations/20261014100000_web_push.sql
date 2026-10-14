-- Notificações push (Web Push / PWA). Cada aparelho que ativa vira uma assinatura; toda notificação nova do app
-- (a mesma lista do sino: alertas, lembretes, relatórios, cobranças) pode virar um push no celular.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  failure_count integer not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions (user_id) where enabled;

create table if not exists public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid,
  subscription_id uuid references public.push_subscriptions(id) on delete cascade,
  status text not null,
  error text,
  created_at timestamptz not null default now(),
  unique (notification_id, subscription_id)
);
create index if not exists idx_push_deliveries_user_time on public.push_deliveries (user_id, created_at desc);

-- Chaves VAPID geradas pela própria função na primeira execução (ou vindas de segredos do ambiente). Só service role lê.
create table if not exists public.push_vapid_keys (
  id boolean primary key default true check (id),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
alter table public.push_vapid_keys enable row level security;
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions, public.push_deliveries, public.push_vapid_keys from anon, public, authenticated;
grant select (id, user_id, user_agent, enabled, last_success_at, created_at) on public.push_subscriptions to authenticated;

-- Gatilho: notificação nova → pede o envio do push. Nunca bloqueia a criação da notificação.
create or replace function public.notify_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  v_secret text;
begin
  if NEW.type::text in ('agent_confirmation', 'import_done') then return NEW; end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = NEW.user_id and s.enabled) then return NEW; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets
   where name in ('INTERNAL_CRON_SECRET', 'meunino_cron_secret', 'nocontrole_cron_secret')
   order by case name when 'INTERNAL_CRON_SECRET' then 0 when 'meunino_cron_secret' then 1 else 2 end, created_at desc
   limit 1;
  if v_secret is null then return NEW; end if;
  perform net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/push-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('notification_id', NEW.id)
  );
  return NEW;
exception when others then
  return NEW;
end;
$$;
revoke all on function public.notify_push_on_notification() from public, anon, authenticated;

drop trigger if exists trg_notify_push_on_notification on public.notifications;
create trigger trg_notify_push_on_notification
  after insert on public.notifications
  for each row execute function public.notify_push_on_notification();
