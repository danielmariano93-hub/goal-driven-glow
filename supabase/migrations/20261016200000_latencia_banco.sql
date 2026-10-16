-- Latência: três causas medidas em produção (16/10).
--
-- 1) claim_category_classification_batch rodava a cada minuto e REESCREVIA todas as linhas 'completed' da fila
--    (re-avaliava transaction_needs_categorization em ~1.000 linhas, 175 ms, e dava UPDATE em todas: bloat + WAL + disputa com as telas).
--    Linha 'completed' nunca é elegível para pegar; só 'queued'/'failed' precisam ser reavaliadas.
create or replace function public.claim_category_classification_batch(p_limit integer default 100, p_user_id uuid default null::uuid)
 returns table(queue_id uuid, transaction_id uuid, user_id uuid, type text, description text, movement_kind text, transfer_group_id uuid, settles_card_id uuid, shared_expense_id uuid, evidence_hash text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  UPDATE public.category_classification_queue q
     SET status='failed', locked_at=NULL, available_at=now() + interval '5 minutes', last_error='stale_processing_lease', updated_at=now(), next_retry_reason='technical_retry'
   WHERE q.status='processing' AND q.locked_at < now()-interval '5 minutes';

  UPDATE public.category_classification_queue q
     SET status='completed', processed_at=now(), locked_at=NULL, last_error='no_longer_eligible', terminal_reason='no_longer_eligible', updated_at=now()
   WHERE q.status IN ('queued','failed')
     AND (p_user_id IS NULL OR q.user_id=p_user_id)
     AND NOT public.transaction_needs_categorization(q.transaction_id, q.user_id);

  RETURN QUERY
  WITH eligible AS (
    SELECT q.id, public.category_transaction_evidence_hash(q.transaction_id, q.user_id) AS current_hash
    FROM public.category_classification_queue q
    WHERE q.status IN ('queued','failed')
      AND q.attempts < 5
      AND q.available_at <= now()
      AND (p_user_id IS NULL OR q.user_id=p_user_id)
      AND public.transaction_needs_categorization(q.transaction_id, q.user_id)
  ), picked AS (
    SELECT q.id, e.current_hash
    FROM public.category_classification_queue q
    JOIN eligible e ON e.id=q.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_classification_attempts a
      WHERE a.transaction_id=q.transaction_id
        AND a.user_id=q.user_id
        AND a.evidence_hash=e.current_hash
        AND a.engine_version='categorization_truth.v2'
        AND a.status IN ('resolved','suggested','needs_review_until_new_evidence')
    )
    ORDER BY q.available_at,q.created_at
    FOR UPDATE OF q SKIP LOCKED
    LIMIT greatest(1,least(coalesce(p_limit,100),500))
  ), locked AS (
    UPDATE public.category_classification_queue q
       SET status='processing', locked_at=now(), attempts=q.attempts+1, updated_at=now(), evidence_hash=p.current_hash, terminal_reason=NULL
      FROM picked p
     WHERE q.id=p.id
     RETURNING q.id,q.transaction_id,q.user_id,q.evidence_hash
  )
  SELECT l.id,t.id,t.user_id,t.type::text,
    coalesce(t.friendly_description,t.raw_description,t.description),
    t.movement_kind,t.transfer_group_id,t.settles_card_id,t.shared_expense_id,l.evidence_hash
  FROM locked l
  JOIN public.transactions t ON t.id=l.transaction_id AND t.user_id=l.user_id;
END $function$;

-- 2) financial_situation_events: o gatilho gravava "piorou/melhorou" a cada rodada horária por qualquer variação de centavos no
--    impacto (41 mil linhas "worsened" para 55 situações). Cada situação ativa carregava ~450 linhas e o selo do menu Mais
--    (nino_screen_situations) as percorria todas, cada vez mais devagar. Agora só registra mudança de status/severidade ou
--    variação de impacto relevante (≥ 5% e ≥ R$ 1).
create or replace function public.nino_diag_situation_event()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_type text; v_delta numeric; begin
 if tg_op='INSERT' then insert into public.financial_situation_events(user_id,situation_id,event_type,to_status,delta_amount,narrative) values(new.user_id,new.id,'detected',new.status,new.impact_amount,coalesce(new.one_line_summary,new.headline)) on conflict do nothing; return new; end if;
 if new.status is not distinct from old.status and new.severity is not distinct from old.severity and new.impact_amount is not distinct from old.impact_amount then return new; end if;
 v_delta := coalesce(new.impact_amount,0)-coalesce(old.impact_amount,0);
 -- só ruído de valor (mesmo status e severidade, variação pequena): não é um fato novo
 if new.status is not distinct from old.status and new.severity is not distinct from old.severity
    and abs(v_delta) < greatest(1, 0.05*abs(coalesce(old.impact_amount,0))) then return new; end if;
 v_type:=case when new.status='resolved' then 'resolved' when new.status='expired' then 'expired' when new.supersedes_id is not null and old.supersedes_id is null then 'superseded' when new.status='confirmed' and old.status<>'confirmed' then 'confirmed' when new.status='improving' or coalesce(new.impact_amount,0)<coalesce(old.impact_amount,0) then 'improved' else 'worsened' end;
 -- vai-e-volta (resolveu, reabriu, resolveu...): o mesmo tipo já registrado nas últimas 6 h não é fato novo
 if v_type in ('resolved','worsened','improved') and exists (
      select 1 from public.financial_situation_events x
       where x.user_id=new.user_id and x.situation_id=new.id and x.event_type=v_type and x.occurred_at > now()-interval '6 hours') then return new; end if;
 insert into public.financial_situation_events(user_id,situation_id,event_type,from_status,to_status,delta_amount,narrative,metadata) values(new.user_id,new.id,v_type,old.status,new.status,v_delta,case v_type when 'improved' then 'A situação melhorou desde a leitura anterior.' when 'resolved' then 'A situação foi resolvida.' when 'expired' then 'A janela desta situação terminou.' when 'confirmed' then 'A situação foi confirmada por novas evidências.' else 'A situação exige mais atenção do que na leitura anterior.' end,jsonb_build_object('from_severity',old.severity,'to_severity',new.severity)); return new;
end $function$;

-- Histórico repetitivo: mantém, por situação, os 10 eventos mais recentes de cada tipo repetitivo (piorou/melhorou/resolveu).
-- (Aplicado em produção em 16/10: 56 mil → 1,6 mil linhas.)
delete from public.financial_situation_events e
 using (
   select id from (
     select id, row_number() over (partition by situation_id, event_type order by occurred_at desc, id desc) rn
       from public.financial_situation_events
      where event_type in ('worsened','improved','resolved')
   ) r where r.rn > 10
 ) old
 where e.id = old.id;

-- O selo do Mais pede só o evento material mais recente de cada situação.
create index if not exists financial_situation_events_material_idx
  on public.financial_situation_events (situation_id, occurred_at desc)
  where event_type in ('detected','improved','worsened');
