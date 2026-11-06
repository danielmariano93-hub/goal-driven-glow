-- nino_feature_health.v1 — saúde das features: cada linha responde "esta feature está entregando o que deveria?".
-- Motivo: features já implementadas pararam de funcionar (erro ou sobreposição) e ninguém soube. Os alertas operacionais
-- cobriam infraestrutura (envio, fila, cron, IA); aqui cobrimos o RESULTADO da feature (o que ela produziu), com regra de
-- amostra mínima (volume pequeno não gera falso alarme: sem dados suficientes vira "nodata", nunca verde nem vermelho).
-- Alertas abertos entram no mesmo fluxo de `ops_alerts` (faixa no painel, notificação no app, WhatsApp e ntfy).

create or replace function public.fh_row(
  _key text, _group text, _title text, _question text, _status text, _value text, _reference text,
  _detail text, _action text, _link text
) returns jsonb language sql immutable as $$
  select jsonb_build_object('key', _key, 'group', _group, 'title', _title, 'question', _question, 'status', _status,
    'value', _value, 'reference', _reference, 'detail', _detail, 'action', _action, 'link', _link)
$$;

create or replace function public.feature_health_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  r jsonb := '[]'::jsonb;
  eligible int; dec6 int; deliver72 int; wa72 int; wa7 int; failed7 int; budget24 int; wa24 int; inter14 int; wa14 int;
  runs24 int; err24 int; p95 numeric; fb24 int; tv7 int; runs7 int; inbound24 int;
  last_reading timestamptz; flag_on boolean; flag_since timestamptz; readers int; targets int;
  hb_week timestamptz; imp7 int; impfail7 int; changed text; st text;
begin
  select count(*) into eligible from public.whatsapp_links l
   where l.status::text = 'active' and not exists (select 1 from public.profiles p where p.id = l.user_id and (p.is_test or p.is_sandbox));

  -- ===== Mensagens proativas =====
  select count(*) into dec6 from public.proactive_decisions where created_at > now() - interval '6 hours';
  st := case when eligible = 0 then 'nodata' when dec6 = 0 then 'crit' else 'ok' end;
  r := r || public.fh_row('proactive_engine', 'Mensagens proativas', 'O motor decide o que falar',
    'O motor de mensagens proativas está rodando?', st, dec6 || ' decisões em 6 h', 'esperado: dezenas por hora',
    case st when 'crit' then 'Nenhuma decisão foi registrada nas últimas 6 horas: o motor parou.' when 'nodata' then 'Nenhum usuário com WhatsApp ativo.' else 'O motor está decidindo normalmente.' end,
    case when st = 'crit' then 'Verifique a rotina agent-proactive-hourly e a função de decisão (logs).' else null end, '/admin/comunicacoes');

  select count(*) filter (where decision = 'deliver') into deliver72 from public.proactive_decisions where created_at > now() - interval '72 hours';
  select count(*) into wa72 from public.communication_deliveries where channel = 'whatsapp' and status::text = 'delivered' and delivered_at > now() - interval '72 hours';
  st := case when eligible = 0 then 'nodata' when wa72 = 0 and deliver72 > 0 then 'crit' when wa72 = 0 then 'warn' else 'ok' end;
  r := r || public.fh_row('proactive_delivery', 'Mensagens proativas', 'Mensagens proativas chegam ao WhatsApp',
    'O que o Nino decide enviar está saindo?', st, wa72 || ' entregues em 72 h', deliver72 || ' decisões de enviar no mesmo período',
    case st when 'crit' then 'O Nino decidiu enviar ' || deliver72 || ' mensagens e nenhuma foi entregue em 3 dias.' when 'warn' then 'Nenhuma mensagem proativa foi entregue em 3 dias (pode ser silêncio legítimo, confira os motivos).' when 'nodata' then 'Nenhum usuário com WhatsApp ativo.' else 'Entregas acontecendo.' end,
    case when st in ('crit','warn') then 'Veja em Mensageria os motivos de retenção e o último erro de envio.' else null end, '/admin/comunicacoes');

  select count(*) filter (where status::text = 'failed'), count(*) filter (where status::text in ('failed','delivered'))
    into failed7, wa7 from public.communication_deliveries where channel = 'whatsapp' and created_at > now() - interval '7 days';
  st := case when wa7 < 5 then 'nodata' when failed7::numeric / wa7 >= 0.5 then 'crit' when failed7::numeric / wa7 >= 0.25 then 'warn' else 'ok' end;
  r := r || public.fh_row('proactive_failure_rate', 'Mensagens proativas', 'Falhas de entrega',
    'Quanto do que tentamos entregar falha?', st, case when wa7 = 0 then 'sem tentativas' else round(100.0 * failed7 / wa7) || '% falharam' end, 'alerta a partir de 25% (mín. 5 tentativas em 7 dias)',
    case st when 'nodata' then 'Poucas tentativas para medir.' when 'ok' then failed7 || ' de ' || wa7 || ' falharam em 7 dias.' else failed7 || ' de ' || wa7 || ' entregas falharam em 7 dias.' end,
    case when st in ('warn','crit') then 'Abra Mensageria e confira o erro mais frequente (número inválido, sessão caída, janela de 24 h).' else null end, '/admin/comunicacoes');

  select count(*) filter (where reason like 'attention_budget_exhausted%' or reason like 'dispatcher_would_defer%') into budget24
    from public.proactive_decisions where created_at > now() - interval '24 hours';
  select count(*) into wa24 from public.communication_deliveries where channel = 'whatsapp' and status::text = 'delivered' and delivered_at > now() - interval '24 hours';
  st := case when eligible = 0 then 'nodata' when budget24 >= 10 and wa24 = 0 then 'warn' else 'ok' end;
  r := r || public.fh_row('proactive_budget_choke', 'Mensagens proativas', 'Tetos barrando tudo',
    'Algum limite (teto diário, cota do pilar, cadência) está barrando o que deveria sair?', st, budget24 || ' retidas por limite em 24 h', wa24 || ' entregues em 24 h',
    case when st = 'warn' then 'Houve ' || budget24 || ' retenções por limite e nenhuma entrega no dia: sinal de sobreposição de regras.' else 'Sem sinal de limite barrando tudo.' end,
    case when st = 'warn' then 'Compare os motivos em proactive_decisions; revise teto diário, cotas por pilar e cadência de 2 h.' else null end, '/admin/comunicacoes');

  select count(*), count(*) filter (where interacted_at is not null) into wa14, inter14
    from public.communication_deliveries where channel = 'whatsapp' and status::text = 'delivered' and delivered_at > greatest(now() - interval '14 days', timestamptz '2026-11-05 22:40+00');
  st := case when wa14 < 10 then 'nodata' when inter14::numeric / wa14 < 0.05 then 'warn' else 'ok' end;
  r := r || public.fh_row('proactive_engagement', 'Mensagens proativas', 'Mensagens que geram resposta',
    'As mensagens proativas estão sendo lidas e respondidas?', st, case when wa14 = 0 then 'sem entregas' else round(100.0 * inter14 / wa14) || '% respondidas em até 2 h' end, 'alerta abaixo de 5% (mín. 10 entregas em 14 dias)',
    case when st = 'nodata' then 'Poucas entregas desde que a medição de resposta passou a valer (05/11 à noite).' when st = 'warn' then 'Quase nada do que enviamos é respondido: o conteúdo ou o horário não está funcionando.' else 'Há resposta às mensagens enviadas.' end,
    case when st = 'warn' then 'Agrupe por pilar (block_context->>''pillar'') e pause o tipo que nunca é respondido.' else null end, '/admin/comunicacoes');

  -- ===== Agente conversacional =====
  select count(*), count(*) filter (where status::text = 'error' and coalesce(error_sanitized, error_masked, '') not like 'needs\_%'), percentile_cont(0.95) within group (order by latency_ms),
         count(*) filter (where fallback_attempts > 0)
    into runs24, err24, p95, fb24
    from public.agent_runs a where started_at > now() - interval '24 hours' and coalesce(channel, '') <> 'simulator'
     and not exists (select 1 from public.profiles p where p.id = a.user_id and (p.is_test or p.is_sandbox));
  st := case when runs24 < 5 then 'nodata' when err24::numeric / runs24 >= 0.3 then 'crit' when err24::numeric / runs24 >= 0.15 then 'warn' else 'ok' end;
  r := r || public.fh_row('agent_error_rate', 'Agente', 'Conversas que terminam em erro',
    'O Nino está conseguindo responder?', st, case when runs24 = 0 then 'sem conversas' else round(100.0 * err24 / runs24) || '% com erro (' || err24 || ' de ' || runs24 || ')' end, 'alerta a partir de 15% (mín. 5 conversas em 24 h)',
    case st when 'nodata' then 'Poucas conversas para medir.' when 'ok' then 'Taxa de erro dentro do esperado.' else 'A taxa de erro das conversas subiu.' end,
    case when st in ('warn','crit') then 'Abra Nino & IA e veja o erro mais frequente por função (provedor de IA, ferramenta, permissão).' else null end, '/admin/nino-ia');

  select count(*) into inbound24 from public.inbound_messages where received_at > now() - interval '24 hours' and ignored_reason is null;
  st := case when inbound24 < 3 then 'nodata' when runs24 = 0 then 'crit' else 'ok' end;
  r := r || public.fh_row('agent_silent', 'Agente', 'Mensagens recebidas sem resposta do agente',
    'Quando alguém escreve, o agente roda?', st, inbound24 || ' mensagens recebidas, ' || runs24 || ' conversas processadas (24 h)', 'devem andar juntas',
    case st when 'crit' then 'Chegaram mensagens, mas o agente não processou nenhuma em 24 h.' when 'nodata' then 'Poucas mensagens para medir.' else 'O agente está processando o que chega.' end,
    case when st = 'crit' then 'Verifique o webhook de entrada e a rotina de processamento; veja também a fila de mensagens não processadas.' else null end, '/admin/nino-ia');

  st := case when runs24 < 5 or p95 is null then 'nodata' when p95 > 40000 then 'crit' when p95 > 20000 then 'warn' else 'ok' end;
  r := r || public.fh_row('agent_latency', 'Agente', 'Tempo das respostas mais lentas',
    'A pessoa espera demais por uma resposta?', st, case when p95 is null then 'sem dados' else round(p95 / 1000.0, 1) || ' s (as 5% mais lentas)' end, 'alerta acima de 20 s',
    case st when 'nodata' then 'Poucas conversas para medir.' when 'ok' then 'Dentro do esperado.' else 'As respostas mais lentas passaram de 20 s.' end,
    case when st in ('warn','crit') then 'Veja o tempo por etapa (IA x ferramentas) em Nino & IA e o modelo/provedor usado.' else null end, '/admin/nino-ia');

  st := case when runs24 < 5 then 'nodata' when fb24::numeric / runs24 >= 0.25 then 'warn' else 'ok' end;
  r := r || public.fh_row('agent_fallback', 'Agente', 'Provedor de IA principal falhando',
    'Estamos caindo para o modelo reserva?', st, case when runs24 = 0 then 'sem conversas' else round(100.0 * fb24 / runs24) || '% usaram reserva' end, 'alerta a partir de 25%',
    case st when 'warn' then 'Uma em cada quatro conversas precisou do modelo reserva: o principal está instável.' when 'nodata' then 'Poucas conversas para medir.' else 'Provedor principal estável.' end,
    case when st = 'warn' then 'Confira status e limites do provedor principal e os erros por função.' else null end, '/admin/nino-ia');

  select count(*), count(*) filter (where truth_validation_failed) into runs7, tv7
    from public.agent_runs a where started_at > now() - interval '7 days' and coalesce(channel, '') <> 'simulator'
     and not exists (select 1 from public.profiles p where p.id = a.user_id and (p.is_test or p.is_sandbox));
  st := case when runs7 < 10 then 'nodata' when tv7::numeric / runs7 >= 0.15 then 'warn' else 'ok' end;
  r := r || public.fh_row('agent_truth_gate', 'Agente', 'Respostas barradas pela trava de números',
    'A trava que impede número errado está barrando demais?', st, case when runs7 = 0 then 'sem conversas' else round(100.0 * tv7 / runs7) || '% barradas' end, 'alerta a partir de 15% (mín. 10 conversas em 7 dias)',
    case st when 'warn' then 'Muitas respostas foram barradas por números fora da evidência: uma feature nova pode estar divergindo da trava.' when 'nodata' then 'Poucas conversas para medir.' else 'Dentro do esperado.' end,
    case when st = 'warn' then 'Veja os casos barrados no simulador e na auditoria do agente.' else null end, '/admin/nino-ia');

  -- ===== Mapa Financeiro =====
  select enabled, updated_at into flag_on, flag_since from public.agent_runtime_flags where flag_name = 'mapa_financeiro_default';
  select max(created_at) into last_reading from public.map_readings;
  st := case when not coalesce(flag_on, false) then 'nodata' when last_reading is null then 'crit'
             when now() - last_reading > interval '9 days' then 'crit' when now() - last_reading > interval '8 days' then 'warn' else 'ok' end;
  r := r || public.fh_row('mapa_freshness', 'Mapa Financeiro', 'Leitura semanal do Mapa',
    'O Mapa está sendo atualizado toda semana?', st, case when last_reading is null then 'nenhuma leitura' else 'última leitura há ' || floor(extract(epoch from (now() - last_reading)) / 86400) || ' dias' end, 'esperado: toda segunda-feira',
    case st when 'crit' then 'A rotina semanal do Mapa não produziu leituras no prazo.' when 'warn' then 'A leitura semanal está atrasada.' when 'nodata' then 'O Mapa não está liberado para todos.' else 'Leituras em dia.' end,
    case when st in ('warn','crit') then 'Rode a função mapa-weekly manualmente e confira a rotina mapa-weekly.' else null end, '/admin/produto');

  select count(*) into targets from public.profiles p where not coalesce(p.is_test, false) and not coalesce(p.is_sandbox, false);
  select count(distinct user_id) into readers from public.map_readings where created_at > now() - interval '8 days';
  st := case when not coalesce(flag_on, false) or targets < 3 then 'nodata'
             when flag_since > now() - interval '8 days' then 'nodata'
             when readers::numeric / targets < 0.5 then 'warn' else 'ok' end;
  r := r || public.fh_row('mapa_coverage', 'Mapa Financeiro', 'Quem recebeu leitura do Mapa',
    'A liberação para todos está chegando às pessoas?', st, readers || ' de ' || targets || ' pessoas com leitura em 8 dias', 'alerta abaixo de 50%',
    case when flag_since > now() - interval '8 days' and coalesce(flag_on, false) then 'Liberado há menos de 8 dias: a primeira rodada semanal completa acontece na próxima segunda-feira.'
         when st = 'warn' then 'Menos da metade das pessoas tem leitura do Mapa.' when st = 'nodata' then 'Poucas contas para medir.' else 'Cobertura adequada.' end,
    case when st = 'warn' then 'Confira o seletor de usuários do mapa-weekly (mapaUserIds) e os erros por etapa.' else null end, '/admin/produto');

  -- ===== Relatórios e dados =====
  select last_run_at into hb_week from public.job_heartbeats where job_key = 'financial-reports-weekly';
  st := case when hb_week is null then 'nodata' when now() - hb_week > interval '10 days' then 'crit' when now() - hb_week > interval '8 days' then 'warn' else 'ok' end;
  r := r || public.fh_row('reports_weekly', 'Relatórios e dados', 'Relatório semanal',
    'O relatório semanal está sendo gerado?', st, case when hb_week is null then 'sem registro' else 'última execução há ' || floor(extract(epoch from (now() - hb_week)) / 86400) || ' dias' end, 'esperado: toda segunda-feira',
    case st when 'crit' then 'O relatório semanal não roda há mais de 10 dias.' when 'warn' then 'O relatório semanal está atrasado.' when 'nodata' then 'Sem execução registrada.' else 'Em dia.' end,
    case when st in ('warn','crit') then 'Confira a rotina financial-reports-weekly e os logs da função.' else null end, '/admin/comunicacoes');

  select count(*), count(*) filter (where status::text in ('failed', 'error')) into imp7, impfail7 from public.import_batches where created_at > now() - interval '7 days';
  st := case when imp7 < 3 then 'nodata' when impfail7::numeric / imp7 >= 0.4 then 'warn' else 'ok' end;
  r := r || public.fh_row('imports', 'Relatórios e dados', 'Importação de extratos e faturas',
    'As importações estão dando certo?', st, case when imp7 = 0 then 'sem importações em 7 dias' else impfail7 || ' falhas em ' || imp7 || ' importações' end, 'alerta a partir de 40% de falha (mín. 3 em 7 dias)',
    case st when 'warn' then 'Muitas importações falharam: o formato de algum banco pode ter mudado.' when 'nodata' then 'Poucas importações para medir.' else 'Importações saudáveis.' end,
    case when st = 'warn' then 'Veja o campo error de import_batches e o banco/formato mais frequente.' else null end, '/admin/produto');

  -- ===== Flags =====
  select string_agg(flag_name || (case when enabled then '' else ' (desligada)' end), ', ' order by updated_at desc) into changed
    from public.agent_runtime_flags where updated_at > now() - interval '24 hours';
  r := r || public.fh_row('flags_changed', 'Flags', 'Flags alteradas nas últimas 24 h',
    'Alguém mudou o que está ligado?', case when changed is null then 'ok' else 'info' end, coalesce(changed, 'nenhuma'), 'informativo',
    case when changed is null then 'Nenhuma flag mudou.' else 'Mudanças de flag alteram o comportamento para as pessoas. Confirme que foram intencionais.' end,
    null, '/admin/nino-ia');

  return r;
end $$;
revoke all on function public.feature_health_snapshot() from public, anon, authenticated;
grant execute on function public.feature_health_snapshot() to service_role;

-- Leitura para o painel (somente admin).
create or replace function public.admin_feature_health()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_current_user_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object('generated_at', now(), 'rows', public.feature_health_snapshot());
end $$;
revoke all on function public.admin_feature_health() from public, anon;
grant execute on function public.admin_feature_health() to authenticated;

-- Alertas (formato do `ops_alerts_sync`): só o que está em aviso ou crítico.
create or replace function public.ops_feature_health_alerts()
returns jsonb
language sql
security definer
set search_path = 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', 'feature_' || (x->>'key'),
    'severity', case when x->>'status' = 'crit' then 'critical' else 'warning' end,
    'title', 'Feature com problema: ' || (x->>'title'),
    'detail', (x->>'detail') || coalesce(' Ação: ' || (x->>'action'), '')
  )), '[]'::jsonb)
  from jsonb_array_elements(public.feature_health_snapshot()) x
  where x->>'status' in ('warn', 'crit')
$$;
revoke all on function public.ops_feature_health_alerts() from public, anon, authenticated;
grant execute on function public.ops_feature_health_alerts() to service_role;
