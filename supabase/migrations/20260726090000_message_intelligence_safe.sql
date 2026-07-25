-- MESSAGE INTELLIGENCE — SAFE ADMIN CONTRACTS
-- Audited against the live schema on 2026-07-25.
-- Reuses outbound_messages and the existing platform permission model.
-- No duplicate feature-flag, notification, referral or deep-link tables are created.

begin;

create or replace function public.admin_v2_message_intelligence(_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(_days, 30), 180));
  v_cutoff timestamptz;
begin
  perform public._require_perm('messaging.read');
  v_cutoff := now() - make_interval(days => v_days);

  return (
    with base as (
      select
        coalesce(nullif(kind, ''), 'unknown') as kind,
        coalesce(nullif(context_type, ''), 'unknown') as context_type,
        status::text as status_text,
        created_at,
        sent_at,
        delivered_at,
        read_at,
        last_error
      from public.outbound_messages
      where created_at >= v_cutoff
        and channel = 'whatsapp'
        and provider::text = 'waha'
    ),
    dimensions_kind as (
      select
        kind as key,
        count(*)::integer as attempts,
        count(*) filter (
          where status_text in ('sent','delivered','read') or sent_at is not null
        )::integer as sent,
        count(*) filter (
          where status_text in ('delivered','read') or delivered_at is not null
        )::integer as delivered,
        count(*) filter (
          where status_text = 'read' or read_at is not null
        )::integer as read,
        count(*) filter (
          where status_text in ('failed','dead')
        )::integer as failed,
        count(*) filter (
          where status_text in ('queued','processing')
        )::integer as backlog
      from base
      group by kind
    ),
    dimensions_context as (
      select
        context_type as key,
        count(*)::integer as attempts,
        count(*) filter (
          where status_text in ('sent','delivered','read') or sent_at is not null
        )::integer as sent,
        count(*) filter (
          where status_text in ('delivered','read') or delivered_at is not null
        )::integer as delivered,
        count(*) filter (
          where status_text = 'read' or read_at is not null
        )::integer as read,
        count(*) filter (
          where status_text in ('failed','dead')
        )::integer as failed,
        count(*) filter (
          where status_text in ('queued','processing')
        )::integer as backlog
      from base
      group by context_type
    ),
    failures as (
      select
        left(coalesce(nullif(trim(last_error), ''), 'unknown'), 160) as signal,
        count(*)::integer as occurrences
      from base
      where status_text in ('failed','dead')
      group by 1
      order by occurrences desc
      limit 10
    ),
    health as (
      select
        count(*) filter (
          where status_text in ('queued','processing')
            and created_at < now() - interval '15 minutes'
        )::integer as backlog_over_15m,
        count(*) filter (
          where status_text in ('queued','processing')
            and created_at < now() - interval '2 hours'
        )::integer as backlog_over_2h,
        min(created_at) filter (
          where status_text in ('queued','processing')
        ) as oldest_backlog_at,
        count(*) filter (
          where status_text = 'failed'
        )::integer as retryable_failures,
        count(*)::integer as attempts,
        count(*) filter (
          where status_text in ('failed','dead')
        )::integer as failed,
        count(*) filter (
          where delivered_at is not null or read_at is not null
        )::integer as receipts
      from base
    ),
    recommendations as (
      select coalesce(jsonb_agg(item), '[]'::jsonb) as value
      from (
        select jsonb_build_object(
          'severity', 'critical',
          'code', 'BACKLOG_2H',
          'title', 'Fila crítica de mensagens',
          'description', 'Existem mensagens aguardando processamento há mais de duas horas.'
        ) as item
        from health
        where backlog_over_2h > 0

        union all

        select jsonb_build_object(
          'severity', 'warning',
          'code', 'FAILURE_RATE',
          'title', 'Taxa de falha elevada',
          'description', 'Mais de 10% das tentativas do período falharam. Priorize os sinais técnicos mais recorrentes.'
        )
        from health
        where attempts > 0 and failed::numeric / attempts::numeric > 0.10

        union all

        select jsonb_build_object(
          'severity', 'info',
          'code', 'NO_RECEIPTS',
          'title', 'Confirmações de entrega insuficientes',
          'description', 'A leitura estratégica fica limitada enquanto o provedor não preencher entrega e leitura.'
        )
        from health
        where receipts = 0
      ) r
    )
    select jsonb_build_object(
      'period_days', v_days,
      'generated_at', now(),
      'timezone', 'America/Sao_Paulo',
      'formula_version', 'message_intelligence.v1',
      'health', (
        select jsonb_build_object(
          'backlog_over_15m', backlog_over_15m,
          'backlog_over_2h', backlog_over_2h,
          'oldest_backlog_at', oldest_backlog_at,
          'retryable_failures', retryable_failures
        )
        from health
      ),
      'by_kind', coalesce(
        (select jsonb_agg(to_jsonb(x) order by x.attempts desc, x.key) from dimensions_kind x),
        '[]'::jsonb
      ),
      'by_context', coalesce(
        (select jsonb_agg(to_jsonb(x) order by x.attempts desc, x.key) from dimensions_context x),
        '[]'::jsonb
      ),
      'failure_signals', coalesce(
        (select jsonb_agg(to_jsonb(x) order by x.occurrences desc, x.signal) from failures x),
        '[]'::jsonb
      ),
      'recommendations', (select value from recommendations)
    )
  );
end;
$$;

create or replace function public.admin_v2_retry_failed_outbound(_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(_limit, 100), 500));
  v_count integer := 0;
begin
  perform public._require_perm('messaging.reprocess');

  with candidates as (
    select id
    from public.outbound_messages
    where status::text = 'failed'
      and channel = 'whatsapp'
      and provider::text = 'waha'
    order by created_at asc
    limit v_limit
    for update skip locked
  )
  update public.outbound_messages o
  set
    status = 'queued',
    attempts = 0,
    retry_count = 0,
    next_attempt_at = now(),
    claimed_at = null,
    lease_expires_at = null,
    last_error = null,
    dead_letter_at = null,
    sla_breach_at = null,
    updated_at = now(),
    metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
      'manual_requeue_at', now(),
      'manual_requeue_by', auth.uid()
    )
  from candidates c
  where o.id = c.id;

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'requeued', v_count,
    'limit', v_limit,
    'formula_version', 'message_retry.v1'
  );
end;
$$;

revoke all on function public.admin_v2_message_intelligence(integer) from public;
revoke all on function public.admin_v2_retry_failed_outbound(integer) from public;
grant execute on function public.admin_v2_message_intelligence(integer) to authenticated, service_role;
grant execute on function public.admin_v2_retry_failed_outbound(integer) to authenticated, service_role;

commit;
