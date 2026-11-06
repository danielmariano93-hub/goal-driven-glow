-- Tráfego de teste (harness e usuários sintéticos) nunca entra nas métricas nem nos alertas de clientes reais.
-- Causa: o harness gravava cada mensagem simulada em inbound_messages sem marcar como processada; o alerta
-- "mensagens recebidas não estão sendo processadas" passou a contar 500+ mensagens de teste como se fossem de clientes.

-- 1) Visão das mensagens recebidas de verdade (provider_message_id de teste começa com e2e- ou syn-).
create or replace view public.v_real_inbound as
select i.* from public.inbound_messages i where coalesce(i.provider_message_id, '') !~ '^(e2e|syn)-';
revoke all on public.v_real_inbound from public, anon, authenticated;
grant select on public.v_real_inbound to service_role;
comment on view public.v_real_inbound is 'Mensagens recebidas de clientes reais, sem harness de teste (provider_message_id e2e-/syn-). Para fila e reprocesso use inbound_messages.';

-- 2) Qualquer mensagem de teste já nasce resolvida: nunca fica "esperando processamento".
create or replace function public.tg_inbound_synthetic_resolved()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(new.provider_message_id, '') ~ '^(e2e|syn)-' then
    new.processed_at := coalesce(new.processed_at, now());
    new.ignored_reason := coalesce(new.ignored_reason, 'synthetic_test');
  end if;
  return new;
end $$;
drop trigger if exists trg_inbound_synthetic_resolved on public.inbound_messages;
create trigger trg_inbound_synthetic_resolved before insert on public.inbound_messages
  for each row execute function public.tg_inbound_synthetic_resolved();

-- 3) Limpeza única: mensagens de teste antigas que ficaram pendentes.
update public.inbound_messages
   set processed_at = coalesce(processed_at, now()), ignored_reason = coalesce(ignored_reason, 'synthetic_test')
 where provider_message_id ~ '^(e2e|syn)-' and processed_at is null and ignored_reason is null;

-- 4) Alertas e painéis de WhatsApp leem a visão real. Substituição textual com a definição original guardada.
create table if not exists public.admin_function_backups (
  id bigint generated always as identity primary key,
  fn_name text not null,
  definition text not null,
  reason text not null,
  saved_at timestamptz not null default now()
);
alter table public.admin_function_backups enable row level security;
revoke all on public.admin_function_backups from public, anon, authenticated;
grant all on public.admin_function_backups to service_role;

do $do$
declare fn record; def text; patched text; n int := 0;
begin
  for fn in
    select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public'
       and p.proname in ('ops_alerts_evaluate', 'feature_health_snapshot', 'admin_v2_whatsapp_monitor', 'admin_whatsapp_inbound_health')
  loop
    def := pg_get_functiondef(fn.oid);
    patched := replace(def, 'public.inbound_messages', 'public.v_real_inbound');
    if patched <> def then
      insert into public.admin_function_backups(fn_name, definition, reason) values (fn.proname, def, 'sinteticos_fora_das_metricas.v1');
      execute patched; n := n + 1;
    end if;
  end loop;
  raise notice 'funções ajustadas: %', n;
end
$do$;
