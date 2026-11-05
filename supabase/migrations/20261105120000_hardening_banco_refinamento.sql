-- Endurecimento do banco (refinamento técnico de 05/11/2026, docs/NINO_REFINAMENTO_TECNICO_COMPLETO_2026-11-05.md).
-- Nada aqui muda comportamento de produto: fecha uma exposição, fixa um search_path, remove índices idênticos,
-- cria índices de chave estrangeira onde há volume, reescreve políticas de RLS para o planner avaliar auth.uid() uma vez,
-- e passa a podar proactive_decisions.

-- 1) S1: nino_diag_changed_since aceitava qualquer _user_id e era chamável sem login. Só funções do banco a usam
--    (diagnóstico incremental, 20261029230000), que rodam como dono e não dependem dos papéis abaixo.
revoke execute on function public.nino_diag_changed_since(uuid, timestamptz, text) from public, anon, authenticated;

-- 2) Função pura (CASE) sem search_path fixo.
alter function public.habit_answer_label(text) set search_path = '';

-- 3) Índices idênticos (alerta duplicate_index): mantém um de cada.
drop index if exists public.emo_user_date_idx;
drop index if exists public.emotional_checkins_user_occurred_desc_idx;
drop index if exists public.financial_situations_user_mode_key_uidx;   -- a constraint ..._situation_key_key continua
drop index if exists public.idx_transactions_user_account_posted;      -- idx_transactions_posted_at continua

-- 4) Chaves estrangeiras sem índice, só em tabelas com >= 1.000 linhas (onde o índice compensa; as demais ficam para quando crescerem).
create index if not exists ix_agent_runs_conversation_id on public.agent_runs (conversation_id);
create index if not exists ix_agent_runs_prompt_version_id on public.agent_runs (prompt_version_id);
create index if not exists ix_category_decisions_decided_category_id on public.category_decisions (decided_category_id);
create index if not exists ix_category_decisions_previous_category_id on public.category_decisions (previous_category_id);
create index if not exists ix_category_decisions_run_id on public.category_decisions (run_id);
create index if not exists ix_extracted_items_attached_transaction_id on public.extracted_items (attached_transaction_id);
create index if not exists ix_extracted_items_investment_id on public.extracted_items (investment_id);
create index if not exists ix_extracted_items_settles_card_id on public.extracted_items (settles_card_id);
create index if not exists ix_extracted_items_transaction_id on public.extracted_items (transaction_id);
create index if not exists ix_financial_situation_evidence_evaluation_run_id on public.financial_situation_evidence (evaluation_run_id);
create index if not exists ix_financial_situation_evidence_fact_id on public.financial_situation_evidence (fact_id);
create index if not exists ix_financial_situation_evidence_opportunity_id on public.financial_situation_evidence (opportunity_id);
create index if not exists ix_financial_situation_evidence_pattern_id on public.financial_situation_evidence (pattern_id);
create index if not exists ix_financial_situation_evidence_report_id on public.financial_situation_evidence (report_id);
create index if not exists ix_financial_situation_evidence_transaction_id on public.financial_situation_evidence (transaction_id);
create index if not exists ix_inbound_messages_document_import_id on public.inbound_messages (document_import_id);
create index if not exists ix_inbound_messages_participant_id on public.inbound_messages (participant_id);
create index if not exists ix_nino_diagnosis_snapshots_primary_action_id on public.nino_diagnosis_snapshots (primary_action_id);
create index if not exists ix_nino_diagnosis_snapshots_primary_situation_id on public.nino_diagnosis_snapshots (primary_situation_id);
create index if not exists ix_outbound_messages_artifact_id on public.outbound_messages (artifact_id);
create index if not exists ix_outbound_messages_inbound_message_id on public.outbound_messages (inbound_message_id);
create index if not exists ix_shared_expense_events_participant_id on public.shared_expense_events (participant_id);
create index if not exists ix_shared_expense_events_shared_expense_id on public.shared_expense_events (shared_expense_id);
create index if not exists ix_transactions_category_decision_id on public.transactions (category_decision_id);
create index if not exists ix_transactions_category_id on public.transactions (category_id);
create index if not exists ix_transactions_investment_id on public.transactions (investment_id);
create index if not exists ix_transactions_payroll_income_transaction_id on public.transactions (payroll_income_transaction_id);
create index if not exists ix_transactions_refund_of_transaction_id on public.transactions (refund_of_transaction_id);
create index if not exists ix_transactions_superseded_by on public.transactions (superseded_by);
create index if not exists ix_whatsapp_pipeline_events_agent_run_id on public.whatsapp_pipeline_events (agent_run_id);

-- 5) RLS: `auth.uid()` -> `(select auth.uid())` (alerta auth_rls_initplan). Mesma regra de acesso, avaliada uma vez por consulta
--    e não por linha. Só reescreve o que ainda não está embrulhado; mantém papéis, comando e nome de cada política.
do $$
declare
  p record;
  q text;
  w text;
  clauses text;
  changed int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') ~ 'auth\.(uid|jwt|role|email)\(\)' or coalesce(with_check, '') ~ 'auth\.(uid|jwt|role|email)\(\)')
  loop
    q := case when p.qual is null then null
              else regexp_replace(p.qual, '(?<!SELECT )auth\.(uid|jwt|role|email)\(\)', '(select auth.\1())', 'g') end;
    w := case when p.with_check is null then null
              else regexp_replace(p.with_check, '(?<!SELECT )auth\.(uid|jwt|role|email)\(\)', '(select auth.\1())', 'g') end;
    if q is not distinct from p.qual and w is not distinct from p.with_check then
      continue;
    end if;
    clauses := concat_ws(' ',
      case when q is not null then format('USING (%s)', q) end,
      case when w is not null then format('WITH CHECK (%s)', w) end);
    execute format('alter policy %I on %I.%I %s', p.policyname, p.schemaname, p.tablename, clauses);
    changed := changed + 1;
  end loop;
  raise notice 'politicas reescritas: %', changed;
end $$;

-- 6) proactive_decisions (log de decisão a cada rodada horária) não tinha retenção. Janelas de repetição usam no máximo 14 dias.
select cron.unschedule(jobid) from cron.job where jobname = 'proactive-decisions-retention-daily';
select cron.schedule(
  'proactive-decisions-retention-daily', '50 4 * * *',
  $cron$delete from public.proactive_decisions where created_at < now() - interval '120 days'$cron$
);
