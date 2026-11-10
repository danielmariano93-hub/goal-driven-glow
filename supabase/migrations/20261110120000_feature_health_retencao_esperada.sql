-- Saúde das features: "Tetos barrando tudo" e "Mensagens proativas chegam ao WhatsApp" gritavam por comportamento correto.
-- Causa: (1) contava como "barrado por limite" o que o motor já filtra de propósito antes de decidir (horário silencioso,
-- intervalo de 2 h, severidade abaixo do mínimo do WhatsApp): isso é regra funcionando, volta a ser avaliado na próxima hora;
-- (2) "entregue" ignorava os lembretes de contas (due_reminder_log), que também são WhatsApp enviado;
-- (3) "decisões de enviar" incluía o canal app.
-- Agora: só teto diário e cota do pilar contam como limite; entrega = mensagens proativas + lembretes; só decisões de WhatsApp.
do $mig$
declare
  d text := pg_get_functiondef('public.feature_health_snapshot()'::regprocedure);
  n text;
  old_budget constant text := 'select count(*) filter (where reason like ''attention_budget_exhausted%'' or reason like ''dispatcher_would_defer%'') into budget24';
  new_budget constant text := 'select count(*) filter (where channel = ''whatsapp'' and (reason like ''attention_budget_exhausted%'' or reason like ''pillar_quota_reached%'')) into budget24';
  old_wa24 constant text := 'select count(*) into wa24 from public.communication_deliveries where channel = ''whatsapp'' and status::text = ''delivered'' and delivered_at > now() - interval ''24 hours'';';
  new_wa24 constant text := 'select (select count(*) from public.communication_deliveries where channel = ''whatsapp'' and status::text = ''delivered'' and delivered_at > now() - interval ''24 hours'') + (select count(*) from public.due_reminder_log where created_at > now() - interval ''24 hours'') into wa24;';
  old_wa72 constant text := 'select count(*) into wa72 from public.communication_deliveries where channel = ''whatsapp'' and status::text = ''delivered'' and delivered_at > now() - interval ''72 hours'';';
  new_wa72 constant text := 'select (select count(*) from public.communication_deliveries where channel = ''whatsapp'' and status::text = ''delivered'' and delivered_at > now() - interval ''72 hours'') + (select count(*) from public.due_reminder_log where created_at > now() - interval ''72 hours'') into wa72;';
  old_dec constant text := 'select count(*) filter (where decision = ''deliver'') into deliver72';
  new_dec constant text := 'select count(*) filter (where decision = ''deliver'' and channel = ''whatsapp'') into deliver72';
begin
  foreach n in array array[old_budget, old_wa24, old_wa72, old_dec] loop
    if position(n in d) = 0 then raise exception 'trecho não encontrado: %', left(n, 80); end if;
  end loop;
  d := replace(d, old_budget, new_budget);
  d := replace(d, old_wa24, new_wa24);
  d := replace(d, old_wa72, new_wa72);
  d := replace(d, old_dec, new_dec);
  d := replace(d, 'Houve '' || budget24 || '' retenções por limite e nenhuma entrega no dia: sinal de sobreposição de regras.',
                  'Houve '' || budget24 || '' retenções por teto diário ou cota de pilar e nenhuma mensagem saiu no dia: sinal de sobreposição de regras.');
  d := replace(d, 'Compare os motivos em proactive_decisions; revise teto diário, cotas por pilar e cadência de 2 h.',
                  'Compare os motivos em proactive_decisions; revise teto diário e cotas por pilar. Horário silencioso, intervalo de 2 h e severidade mínima não contam: o motor já os respeita ao decidir.');
  execute d;
end
$mig$;
