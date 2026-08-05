-- ---------------------------------------------------------------------------
-- 4. AVALIADORES DE SITUAÇÃO
-- ---------------------------------------------------------------------------

create or replace function public.nino_evaluate_financial_situations(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live',
  _source text default 'engine'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_run_id uuid;
  v_period_start date := date_trunc('month', _as_of)::date;
  v_prev_start date := (date_trunc('month', _as_of) - interval '1 month')::date;
  v_days_elapsed int := greatest(1, (_as_of - date_trunc('month', _as_of)::date) + 1);
  v_prev_end date;
  v_days_in_month int := extract(day from (date_trunc('month', _as_of) + interval '1 month - 1 day'))::int;
  v_current_expense numeric := 0;
  v_previous_expense numeric := 0;
  v_current_income numeric := 0;
  v_previous_income numeric := 0;
  v_redemptions numeric := 0;
  v_delta numeric := 0;
  v_pct numeric := 0;
  v_projected numeric := 0;
  v_gap numeric := 0;
  v_cat record;
  v_cat_contribution numeric := 0;
  v_merchants jsonb := '[]'::jsonb;
  v_avg_income numeric := 0;
  v_avg_expense numeric := 0;
  v_monthly_surplus numeric := 0;
  v_card_outstanding numeric := 0;
  v_card_limit numeric := 0;
  v_card_goal numeric := 0;
  v_card_ratio numeric := 0;
  v_commitments numeric := 0;
  v_goal record;
  v_goal_current numeric := 0;
  v_goal_remaining numeric := 0;
  v_goal_months numeric := 0;
  v_goal_needed numeric := 0;
  v_debt record;
  v_debt_progress numeric := 0;
  v_uncategorized_count int := 0;
  v_uncategorized_amount numeric := 0;
  v_duplicate_pairs jsonb := '[]'::jsonb;
  v_duplicate_count int := 0;
  v_duplicate_amount numeric := 0;
  v_situation_id uuid;
  r record;
  v_detected int := 0;
  v_resolved int := 0;
begin
  if _run_mode not in ('live','shadow','backtest') then
    raise exception 'invalid run_mode: %', _run_mode;
  end if;

  v_prev_end := least((v_period_start - interval '1 day')::date,
                      v_prev_start + (v_days_elapsed - 1));

  insert into public.nino_diagnosis_runs(user_id, run_mode, as_of, status, source)
  values (_user_id, _run_mode, _as_of, 'running', _source)
  returning id into v_run_id;

  update public.financial_situations
     set status='observed', updated_at=now()
   where user_id=_user_id and run_mode=_run_mode
     and status in ('active','confirmed','improving','worsening','observed')
     and temporal_scope in ('now','future');

  -- Consumo: somente transações de despesa; exclui fatura, dívida, aplicações,
  -- transferências e demais movimentos não comparáveis.
  select coalesce(sum(amount),0) into v_current_expense
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='expense'
     and coalesce(movement_kind,'transaction')='transaction'
     and occurred_at between v_period_start and _as_of;

  select coalesce(sum(amount),0) into v_previous_expense
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='expense'
     and coalesce(movement_kind,'transaction')='transaction'
     and occurred_at between v_prev_start and v_prev_end;

  select coalesce(sum(amount),0) into v_current_income
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='income'
     and coalesce(movement_kind,'transaction')='transaction'
     and occurred_at between v_period_start and _as_of;

  select coalesce(sum(amount),0) into v_previous_income
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='income'
     and coalesce(movement_kind,'transaction')='transaction'
     and occurred_at between v_prev_start and v_prev_end;

  select coalesce(sum(amount),0) into v_redemptions
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='income'
     and movement_kind='investment_redemption'
     and occurred_at between v_period_start and _as_of;

  v_delta := v_current_expense - v_previous_expense;
  v_pct := case when v_previous_expense > 0 then (v_delta/v_previous_expense)*100 else 0 end;
  v_projected := case when v_days_elapsed > 0 then (v_current_expense/v_days_elapsed)*v_days_in_month else 0 end;

  with curr as (
    select t.category_id, coalesce(c.name,'Sem categoria') category_name, sum(t.amount) amount,
           array_agg(t.id order by t.amount desc) transaction_ids
      from public.transactions t
      left join public.categories c on c.id=t.category_id
     where t.user_id=_user_id and t.status='confirmed' and t.type='expense'
       and coalesce(t.movement_kind,'transaction')='transaction'
       and t.occurred_at between v_period_start and _as_of
       and lower(coalesce(c.name,'')) !~ '(estorno|reembolso|transfer|fatura|invest|resgate|d[ií]vida)'
     group by t.category_id, c.name
  ), prev as (
    select t.category_id, sum(t.amount) amount
      from public.transactions t
     where t.user_id=_user_id and t.status='confirmed' and t.type='expense'
       and coalesce(t.movement_kind,'transaction')='transaction'
       and t.occurred_at between v_prev_start and v_prev_end
     group by t.category_id
  )
  select c.category_id, c.category_name, c.amount current_amount,
         coalesce(p.amount,0) previous_amount,
         c.amount-coalesce(p.amount,0) delta,
         c.transaction_ids
    into v_cat
    from curr c left join prev p on p.category_id is not distinct from c.category_id
   order by
     case when v_delta=0 then 0
          when (c.amount-coalesce(p.amount,0))*v_delta>0 then 0 else 1 end,
     abs(c.amount-coalesce(p.amount,0)) desc
   limit 1;

  if v_cat.category_id is not null or v_cat.category_name is not null then
    v_cat_contribution := case
      when abs(v_delta)>0 and coalesce(v_cat.delta,0)*v_delta>0
      then least(100, greatest(0, abs(v_cat.delta/v_delta)*100))
      else 0 end;
    select coalesce(jsonb_agg(x order by (x->>'amount')::numeric desc), '[]'::jsonb)
      into v_merchants
      from (
        select jsonb_build_object(
          'merchant', coalesce(nullif(t.normalized_description,''), nullif(t.friendly_description,''), t.description),
          'amount', sum(t.amount),
          'count', count(*)
        ) x
        from public.transactions t
        where t.user_id=_user_id and t.status='confirmed' and t.type='expense'
          and coalesce(t.movement_kind,'transaction')='transaction'
          and t.occurred_at between v_period_start and _as_of
          and t.category_id is not distinct from v_cat.category_id
        group by coalesce(nullif(t.normalized_description,''), nullif(t.friendly_description,''), t.description)
        order by sum(t.amount) desc limit 3
      ) q;
  end if;

  -- 4.1 Ritmo de gastos + explicação causal por categoria.
  if abs(v_delta) >= 100 and (abs(v_pct) >= 15 or v_previous_expense=0) then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'spending_pace_change', 'spending_pace:' || to_char(v_period_start,'YYYY-MM'),
      case when v_delta>0 then 'worsening' else 'improving' end,
      'now',
      case when v_delta<0 then 'positive'
           when v_days_elapsed>=7 and abs(v_pct)>=40 and v_delta>=500 then 'critical'
           else 'attention' end,
      case when v_days_elapsed<7 then 0.68 else 0.85 end,
      v_period_start, _as_of, v_current_expense, v_previous_expense,
      v_delta, v_pct, abs(v_delta),
      case
        when v_delta>0 and v_cat_contribution>=40 then
          v_cat.category_name || ' explicou ' || public.nino_diag_pct(v_cat_contribution) || ' do aumento dos seus gastos'
        when v_delta>0 then 'Seus gastos aumentaram ' || public.nino_diag_brl(abs(v_delta))
        else 'Seus gastos caíram ' || public.nino_diag_brl(abs(v_delta))
      end,
      'No mesmo intervalo, você gastou ' || public.nino_diag_brl(v_current_expense)
        || ' agora e ' || public.nino_diag_brl(v_previous_expense) || ' no mês anterior.'
        || case when v_cat_contribution>=25 then ' ' || v_cat.category_name || ' foi a maior explicação da diferença.' else '' end,
      case
        when v_delta>0 and v_cat_contribution>=50 then
          'Sem ' || v_cat.category_name || ', a variação restante seria de aproximadamente '
          || public.nino_diag_brl(abs(v_delta-v_cat.delta)) || '.'
        when v_delta>0 then 'A alta merece contexto antes de qualquer recomendação de corte.'
        else 'A redução melhora o ritmo do mês, desde que não seja apenas efeito de despesas adiadas.'
      end,
      case when v_delta>0 and v_days_elapsed>=5 then 'Mantido o ritmo atual, o consumo pode chegar a '
        || public.nino_diag_brl(v_projected) || ' até o fim do mês.' else null end,
      (_as_of + 3)::timestamptz,
      jsonb_build_object(
        'comparison_period', jsonb_build_object('current_start',v_period_start,'current_end',_as_of,'previous_start',v_prev_start,'previous_end',v_prev_end),
        'current_expense',v_current_expense,'previous_expense',v_previous_expense,
        'delta',v_delta,'percentage_delta',v_pct,'projected_month',v_projected,
        'top_category',v_cat.category_name,'category_delta',v_cat.delta,
        'category_contribution_pct',v_cat_contribution,'top_merchants',v_merchants
      ),
      jsonb_build_object(
        'evidence_type','spending_comparison','metric_key','expense_consumption',
        'value',v_current_expense,'contribution_amount',abs(coalesce(v_cat.delta,0)),
        'contribution_pct',v_cat_contribution,'top_merchants',v_merchants,
        'transaction_ids',coalesce(to_jsonb(v_cat.transaction_ids),'[]'::jsonb)
      ),
      jsonb_build_object(
        'key','spending_pace:review','type','review_spending','title',
        case when v_cat_contribution>=40 then 'Entender ' || v_cat.category_name else 'Entender a mudança' end,
        'explanation','Veja os lançamentos que mais contribuíram antes de decidir qualquer ajuste.',
        'route','/app/relatorios','priority',85
      )
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.2 Mudança concentrada em uma categoria: o estabelecimento vira evidência.
  if v_cat.category_name is not null and abs(coalesce(v_cat.delta,0)) >= 100 and v_cat_contribution >= 35 then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'category_shift', 'category_shift:' || coalesce(v_cat.category_id::text,'none') || ':' || to_char(v_period_start,'YYYY-MM'),
      case when v_cat.delta>0 then 'active' else 'improving' end,
      'now', case when v_cat.delta>0 then 'attention' else 'positive' end,
      case when v_days_elapsed<7 then 0.68 else 0.82 end,
      v_period_start, _as_of, v_cat.current_amount, v_cat.previous_amount,
      v_cat.delta,
      case when v_cat.previous_amount>0 then (v_cat.delta/v_cat.previous_amount)*100 else null end,
      abs(v_cat.delta),
      case when v_cat.delta>0 then v_cat.category_name || ' foi a principal causa do aumento'
           else v_cat.category_name || ' foi a principal causa da redução' end,
      v_cat.category_name || ' passou de ' || public.nino_diag_brl(v_cat.previous_amount)
        || ' para ' || public.nino_diag_brl(v_cat.current_amount) || ' no período equivalente.',
      'Os maiores lançamentos da categoria são evidências da mudança; eles não são, isoladamente, o insight.',
      null, (_as_of + 5)::timestamptz,
      jsonb_build_object('category_id',v_cat.category_id,'category_name',v_cat.category_name,
                         'current',v_cat.current_amount,'previous',v_cat.previous_amount,
                         'delta',v_cat.delta,'contribution_pct',v_cat_contribution,
                         'top_merchants',v_merchants),
      jsonb_build_object('evidence_type','category_contribution','metric_key','category_delta',
                         'value',v_cat.current_amount,'contribution_amount',abs(v_cat.delta),
                         'contribution_pct',v_cat_contribution,'top_merchants',v_merchants),
      jsonb_build_object('key','category_shift:review','type','review_category',
                         'title','Ver o que mudou','route','/app/relatorios','priority',78)
    );
    v_detected := v_detected + 1;
  end if;

  -- Médias móveis de renda e consumo para capacidade financeira.
  select coalesce(sum(case when type='income' and coalesce(movement_kind,'transaction')='transaction' then amount else 0 end),0)/3,
         coalesce(sum(case when type='expense' and coalesce(movement_kind,'transaction')='transaction' then amount else 0 end),0)/3
    into v_avg_income, v_avg_expense
    from public.transactions
   where user_id=_user_id and status='confirmed'
     and occurred_at between (_as_of - 90) and (_as_of - 1);
  v_monthly_surplus := greatest(v_avg_income-v_avg_expense,0);

  -- 4.3 Desequilíbrio operacional; resgates são explicação, não receita recorrente.
  v_gap := v_current_expense-v_current_income;
  if (v_days_elapsed>=7 or v_current_income>0)
     and v_gap > greatest(300, v_current_income*0.10) then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'cash_flow_imbalance', 'cash_flow:' || to_char(v_period_start,'YYYY-MM'),
      'active', 'now',
      case when v_current_income>0 and v_gap/v_current_income>=0.35 then 'critical' else 'attention' end,
      case when v_days_elapsed<7 then 0.65 else 0.88 end,
      v_period_start, _as_of, v_current_expense, v_current_income,
      v_gap, case when v_current_income>0 then (v_gap/v_current_income)*100 else null end,
      v_gap,
      'Seus gastos de consumo superam a renda em ' || public.nino_diag_brl(v_gap),
      'O cálculo considera apenas renda operacional e consumo; pagamentos de fatura, transferências, dívidas e investimentos ficam fora para evitar dupla contagem.',
      case when v_redemptions>0 then public.nino_diag_brl(v_redemptions)
        || ' entraram por resgates de investimento e ajudaram a sustentar o caixa.'
        else 'Sem uma entrada adicional, a diferença tende a pressionar o saldo disponível.' end,
      case when v_current_expense>0 then 'Mantido o ritmo, o consumo projetado é '
        || public.nino_diag_brl(v_projected) || ' no mês.' else null end,
      (_as_of + 3)::timestamptz,
      jsonb_build_object('earned_income',v_current_income,'consumption_expense',v_current_expense,
                         'gap',v_gap,'investment_redemptions',v_redemptions,
                         'average_monthly_surplus_90d',v_monthly_surplus),
      jsonb_build_object('evidence_type','cash_flow','metric_key','operating_gap',
                         'value',v_gap,'redemptions',v_redemptions),
      jsonb_build_object('key','cash_flow:review','type','review_cash_flow',
                         'title','Revisar a formação do saldo','route','/app/relatorios','priority',92)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.4 Uso de investimento para sustentar o mês.
  if v_redemptions >= 500 and v_current_expense > v_current_income then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'investment_drawdown', 'investment_drawdown:' || to_char(v_period_start,'YYYY-MM'),
      'active', 'now', 'attention', 0.92,
      v_period_start, _as_of, v_redemptions, 0, v_redemptions, null, v_redemptions,
      public.nino_diag_brl(v_redemptions) || ' do caixa vieram de resgates de investimento',
      'Resgate não é renda nova: é patrimônio sendo convertido em caixa.',
      'Quando isso acontece para cobrir consumo recorrente, o orçamento deixa de se sustentar apenas pela renda.',
      'O Nino acompanhará se o uso de investimentos volta a acontecer nos próximos ciclos.',
      (_as_of + 7)::timestamptz,
      jsonb_build_object('redemptions',v_redemptions,'earned_income',v_current_income,
                         'consumption_expense',v_current_expense),
      jsonb_build_object('evidence_type','investment_redemption','metric_key','redemption_total','value',v_redemptions),
      jsonb_build_object('key','investment_drawdown:review','type','review_investments',
                         'title','Entender os resgates','route','/app/investimentos','priority',88)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.5 Pressão de cartão por fatura aberta/relevante.
  select coalesce(sum(greatest(coalesce(s.outstanding_amount,s.reconciled_total,s.stated_total,0),0)),0),
         coalesce(sum(c.total_limit),0), coalesce(sum(c.statement_goal),0)
    into v_card_outstanding, v_card_limit, v_card_goal
    from public.credit_card_statements s
    join public.credit_cards c on c.id=s.credit_card_id
   where s.user_id=_user_id and c.active=true
     and s.status not in ('deleted','void')
     and (s.competence_month=date_trunc('month',_as_of)::date
          or s.due_date between (_as_of-7) and (_as_of+20));

  v_card_ratio := case when v_card_limit>0 then (v_card_outstanding/v_card_limit)*100 else 0 end;
  if v_card_outstanding>0 and (v_card_ratio>=35 or (v_card_goal>0 and v_card_outstanding>v_card_goal)) then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'card_cycle_pressure', 'card_pressure:' || to_char(v_period_start,'YYYY-MM'),
      'active', 'now', case when v_card_ratio>=65 then 'critical' else 'attention' end, 0.88,
      v_period_start, _as_of, v_card_outstanding,
      case when v_card_goal>0 then v_card_goal else v_card_limit end,
      case when v_card_goal>0 then v_card_outstanding-v_card_goal else v_card_outstanding end,
      v_card_ratio, v_card_outstanding,
      case when v_card_goal>0 and v_card_outstanding>v_card_goal then
        'Sua fatura está ' || public.nino_diag_brl(v_card_outstanding-v_card_goal) || ' acima da meta'
      else 'Sua fatura ocupa ' || public.nino_diag_pct(v_card_ratio) || ' do limite' end,
      'A leitura usa o saldo da fatura, não o pagamento da fatura como novo consumo.',
      'Uma fatura acelerada reduz a margem dos próximos dias e pode pressionar o fechamento do mês.',
      null, (_as_of + 5)::timestamptz,
      jsonb_build_object('outstanding',v_card_outstanding,'limit',v_card_limit,
                         'goal',v_card_goal,'utilization_pct',v_card_ratio),
      jsonb_build_object('evidence_type','card_statement','metric_key','statement_outstanding','value',v_card_outstanding),
      jsonb_build_object('key','card_pressure:review','type','review_card',
                         'title','Revisar a fatura','route','/app/cartoes','priority',90)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.6 Viabilidade de meta baseada na sobra média real.
  -- Metas e saldos de investimentos não têm histórico de estado suficiente para
  -- um backtest fiel; entram apenas em execução live/shadow do presente.
  if _run_mode <> 'backtest' then
    select g.*, coalesce(sum(i.current_value),0) current_saved
      into v_goal
      from public.goals g
      left join public.investments i on i.goal_id=g.id and i.user_id=g.user_id
     where g.user_id=_user_id and g.status='active'
     group by g.id
     order by g.priority desc, g.target_date asc
     limit 1;

    if v_goal.id is not null then
      v_goal_current := coalesce(v_goal.current_saved,0);
      v_goal_remaining := greatest(v_goal.target_amount-v_goal_current,0);
      v_goal_months := greatest(1, ceil(greatest(v_goal.target_date-_as_of,1)/30.0));
      v_goal_needed := v_goal_remaining/v_goal_months;
      if v_goal_remaining>0 and (v_monthly_surplus=0 or v_goal_needed>v_monthly_surplus*1.15) then
        perform public.nino_diag_put_situation(
          _user_id, _run_mode, v_run_id, _as_of,
          'goal_feasibility', 'goal_feasibility:' || v_goal.id::text,
          'active', 'now', case when v_goal.target_date<_as_of then 'critical' else 'attention' end, 0.86,
          v_period_start, _as_of, v_goal_needed, v_monthly_surplus,
          v_goal_needed-v_monthly_surplus,
          case when v_monthly_surplus>0 then ((v_goal_needed-v_monthly_surplus)/v_monthly_surplus)*100 else null end,
          v_goal_remaining,
          'A meta “' || v_goal.name || '” pede mais do que sua sobra média comporta',
          'Faltam ' || public.nino_diag_brl(v_goal_remaining) || ' e o ritmo necessário é '
            || public.nino_diag_brl(v_goal_needed) || ' por mês.',
          'Sua sobra média dos últimos 90 dias foi ' || public.nino_diag_brl(v_monthly_surplus)
            || '. Ajustar prazo ou valor evita uma meta matematicamente inviável.',
          null, (_as_of + 14)::timestamptz,
          jsonb_build_object('goal_id',v_goal.id,'goal_name',v_goal.name,'target',v_goal.target_amount,
                             'current',v_goal_current,'remaining',v_goal_remaining,'months_left',v_goal_months,
                             'monthly_needed',v_goal_needed,'average_surplus_90d',v_monthly_surplus),
          jsonb_build_object('evidence_type','goal_capacity','metric_key','monthly_needed','value',v_goal_needed),
          jsonb_build_object('key','goal_feasibility:adjust','type','adjust_goal',
                             'title','Ajustar a meta','route','/app/metas','priority',82)
        );
        v_detected := v_detected + 1;
      end if;
    end if;

  end if;

  -- 4.7 Progresso de dívida como evolução, não como alerta.
  -- O saldo atual da dívida não é projetado para trás em backtests.
  if _run_mode <> 'backtest' then
    select * into v_debt from public.debts
     where user_id=_user_id and status='active'
       and coalesce(original_amount,contract_total_amount,0)>0
     order by coalesce(outstanding_balance,original_amount,0) desc limit 1;

    if v_debt.id is not null then
      v_debt_progress := greatest(0, least(100,
        (1-(coalesce(v_debt.outstanding_balance,0)/nullif(coalesce(v_debt.original_amount,v_debt.contract_total_amount),0)))*100));
      if v_debt_progress>=10 then
        perform public.nino_diag_put_situation(
          _user_id, _run_mode, v_run_id, _as_of,
          'debt_progress', 'debt_progress:' || v_debt.id::text,
          'improving', 'historical', 'positive', 0.95,
          coalesce(v_debt.start_date,v_period_start), _as_of,
          coalesce(v_debt.outstanding_balance,0), coalesce(v_debt.original_amount,v_debt.contract_total_amount),
          coalesce(v_debt.original_amount,v_debt.contract_total_amount)-coalesce(v_debt.outstanding_balance,0),
          v_debt_progress,
          coalesce(v_debt.original_amount,v_debt.contract_total_amount)-coalesce(v_debt.outstanding_balance,0),
          'Você já reduziu ' || public.nino_diag_pct(v_debt_progress) || ' da dívida “' || v_debt.name || '”',
          'O saldo caiu para ' || public.nino_diag_brl(coalesce(v_debt.outstanding_balance,0)) || '.',
          'Esse avanço reduz o passivo e melhora o patrimônio líquido.',
          null, (_as_of + 30)::timestamptz,
          jsonb_build_object('debt_id',v_debt.id,'name',v_debt.name,'progress_pct',v_debt_progress,
                             'outstanding',v_debt.outstanding_balance,'original',v_debt.original_amount),
          jsonb_build_object('evidence_type','debt_balance','metric_key','debt_progress','value',v_debt_progress),
          jsonb_build_object('key','debt_progress:open','type','review_debt',
                             'title','Ver a evolução','route','/app/dividas','priority',60)
        );
        v_detected := v_detected + 1;
      end if;
    end if;

  end if;

  -- 4.8 Compromissos recorrentes comparados à renda média.
  -- Regras e saldos atuais não podem vazar para uma leitura histórica.
  if _run_mode <> 'backtest' then
    select coalesce(sum(case frequency::text
      when 'weekly' then amount*4.345
      when 'biweekly' then amount*2.17
      when 'quarterly' then amount/3
      when 'yearly' then amount/12
      else amount end),0)
      into v_commitments
      from public.recurring_rules
     where user_id=_user_id and status='active' and kind::text='expense';

    select v_commitments + coalesce(sum(installment_amount),0) into v_commitments
      from public.debts where user_id=_user_id and status='active';
    v_commitments := coalesce(v_commitments,0)+coalesce(v_card_outstanding,0);

    if v_avg_income>0 and v_commitments/v_avg_income>=0.60 then
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, v_run_id, _as_of,
        'recurring_commitment_pressure', 'commitment_pressure:' || to_char(v_period_start,'YYYY-MM'),
        'active', 'future', case when v_commitments/v_avg_income>=0.85 then 'critical' else 'attention' end, 0.78,
        v_period_start, (v_period_start + interval '1 month - 1 day')::date,
        v_commitments, v_avg_income, v_commitments-v_avg_income,
        (v_commitments/v_avg_income)*100, v_commitments,
        'Compromissos previstos consomem ' || public.nino_diag_pct((v_commitments/v_avg_income)*100) || ' da renda média',
        'A conta reúne recorrências, parcelas de dívida e faturas identificadas.',
        'Quanto menor a margem restante, maior o risco de depender de resgates ou crédito.',
        'Revise o calendário antes dos próximos vencimentos.', (_as_of + 14)::timestamptz,
        jsonb_build_object('monthly_commitments',v_commitments,'average_income_90d',v_avg_income),
        jsonb_build_object('evidence_type','commitments','metric_key','commitment_ratio','value',v_commitments),
        jsonb_build_object('key','commitments:review','type','review_commitments',
                           'title','Revisar compromissos','route','/app/recorrencias','priority',88)
      );
      v_detected := v_detected + 1;
    end if;

  end if;

  -- 4.9 Padrões comportamentais: somente com direção coerente e evidência mínima.
  for r in
    select * from public.behavioral_patterns
     where user_id=_user_id and status in ('candidate','validated','active','weakened')
       and confidence>=0.60 and data_coverage>=0.60 and sample_size>=6
       and coalesce(absolute_delta,0)>0
       and (_run_mode<>'backtest' or (window_end<=_as_of and created_at::date<=_as_of))
     order by confidence desc, abs(absolute_delta) desc limit 4
  loop
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'behavioral_pattern', 'behavioral_pattern:' || r.id::text,
      case when r.status in ('validated','active') then 'confirmed' else 'observed' end,
      'historical', 'info', r.confidence,
      r.window_start, r.window_end, r.pattern_value, r.baseline_value,
      r.absolute_delta, r.uplift_pct, abs(r.absolute_delta),
      r.label,
      'O comportamento apareceu em ' || r.sample_size || ' amostras, com confiança de '
        || public.nino_diag_pct(r.confidence*100) || '.',
      'O padrão só vira antecipação quando também existir uma oportunidade futura útil e acionável.',
      null, coalesce(r.expires_at, now()+interval '30 days'),
      jsonb_build_object('pattern_id',r.id,'detector',r.detector,'sample_size',r.sample_size,
                         'baseline',r.baseline_value,'observed',r.pattern_value,
                         'delta',r.absolute_delta,'uplift_pct',r.uplift_pct,
                         'coverage',r.data_coverage,'consistency',r.consistency),
      jsonb_build_object('evidence_type','behavioral_pattern','metric_key',r.detector,
                         'value',r.pattern_value,'contribution_amount',r.absolute_delta,
                         'contribution_pct',r.uplift_pct,'pattern_id',r.id),
      jsonb_build_object('key','pattern:understand','type','understand_pattern',
                         'title','Entender o padrão','route','/app/nino?section=aprendizados','priority',55)
    );
    v_detected := v_detected + 1;
  end loop;

  -- 4.10 Antecipações conectadas ao mesmo domínio de situação.
  for r in
    select * from public.anticipation_opportunities
     where user_id=_user_id and status in ('scheduled','ready','revalidating')
       and opportunity_date between _as_of and (_as_of+30)
       and (_run_mode<>'backtest' or created_at::date<=_as_of)
     order by utility_score desc, opportunity_date asc limit 4
  loop
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'anticipation', 'anticipation:' || r.id::text,
      'active', 'future',
      case when r.severity='critical' then 'critical' when r.severity='attention' then 'attention' else 'info' end,
      coalesce(r.confidence,0.5), _as_of, r.opportunity_date,
      r.expected_value, r.baseline_value,
      r.expected_value-r.baseline_value,
      case when r.baseline_value<>0 then ((r.expected_value-r.baseline_value)/abs(r.baseline_value))*100 else null end,
      abs(r.expected_value-r.baseline_value), r.title,
      r.body, 'A antecipação existe porque há um padrão validado e uma janela futura em que agir pode mudar o resultado.',
      'Janela útil: ' || to_char(r.window_start at time zone coalesce(r.timezone,'America/Sao_Paulo'),'DD/MM HH24:MI')
        || ' a ' || to_char(r.window_end at time zone coalesce(r.timezone,'America/Sao_Paulo'),'DD/MM HH24:MI') || '.',
      coalesce(r.window_end, (r.opportunity_date+1)::timestamptz),
      coalesce(r.evidence,'{}'::jsonb) || jsonb_build_object('opportunity_id',r.id,'pattern_id',r.pattern_id,
                                                            'utility_score',r.utility_score),
      jsonb_build_object('evidence_type','anticipation','metric_key',r.detector,'value',r.expected_value,
                         'contribution_amount',abs(r.expected_value-r.baseline_value),
                         'opportunity_id',r.id,'pattern_id',r.pattern_id),
      coalesce(r.action, jsonb_build_object('key','anticipation:act','type','anticipation_action',
                                            'title','Preparar agora','route','/app/nino?section=prepare-se','priority',90))
    );
    v_detected := v_detected + 1;
  end loop;

  -- 4.11 Qualidade de dados: operacional, nunca insight principal.
  select count(*)::int, coalesce(sum(amount),0)
    into v_uncategorized_count, v_uncategorized_amount
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='expense'
     and coalesce(movement_kind,'transaction')='transaction'
     and category_id is null and occurred_at between v_period_start and _as_of;

  if v_uncategorized_count>0 then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'data_quality_issue', 'uncategorized:' || to_char(v_period_start,'YYYY-MM'),
      'observed', 'now', 'info', 1,
      v_period_start, _as_of, v_uncategorized_count, 0,
      v_uncategorized_count, null, v_uncategorized_amount,
      v_uncategorized_count || case when v_uncategorized_count=1 then ' lançamento sem categoria' else ' lançamentos sem categoria' end,
      'Eles somam ' || public.nino_diag_brl(v_uncategorized_amount) || ' e reduzem a precisão das análises por categoria.',
      'Classificar melhora as próximas leituras, mas não deve competir com a situação financeira principal.',
      null, (_as_of+14)::timestamptz,
      jsonb_build_object('uncategorized_count',v_uncategorized_count,'amount',v_uncategorized_amount),
      jsonb_build_object('evidence_type','data_quality','metric_key','uncategorized_count','value',v_uncategorized_count),
      jsonb_build_object('key','uncategorized:classify','type','classify_transactions',
                         'title','Classificar agora','route','/app/lancamentos?filtro=sem-categoria','priority',70)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.12 Duplicidades agrupadas em uma única pendência operacional.
  with grouped as (
    select occurred_at, amount,
           coalesce(nullif(normalized_description,''),nullif(friendly_description,''),description) merchant,
           count(*)::int cnt,
           array_agg(id order by created_at) transaction_ids
      from public.transactions t
     where t.user_id=_user_id and t.status='confirmed' and t.type='expense'
       and coalesce(t.movement_kind,'transaction')='transaction'
       and t.occurred_at >= (_as_of-60)
     group by occurred_at, amount,
              coalesce(nullif(normalized_description,''),nullif(friendly_description,''),description)
    having count(*)>1
  ), undecided as (
    select g.*,
           public.nino_norm_text(g.merchant) || '::' || g.amount::text || '::' || g.occurred_at::text pair_key
      from grouped g
     where not exists (
       select 1 from public.nino_duplicate_decisions d
        where d.user_id=_user_id
          and d.pair_key=public.nino_norm_text(g.merchant) || '::' || g.amount::text || '::' || g.occurred_at::text
     )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'pair_key',pair_key,'merchant',merchant,'amount',amount,
           'occurred_at',occurred_at,'count',cnt,'transactions',transaction_ids
         ) order by occurred_at desc),'[]'::jsonb),
         count(*)::int,
         coalesce(sum(amount*(cnt-1)),0)
    into v_duplicate_pairs, v_duplicate_count, v_duplicate_amount
    from undecided;

  if v_duplicate_count>0 then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'duplicate_review', 'duplicate_review',
      'observed', 'now', 'info', 0.75,
      (_as_of-60), _as_of, v_duplicate_count, 0,
      v_duplicate_count, null, v_duplicate_amount,
      v_duplicate_count || case when v_duplicate_count=1 then ' possível duplicidade para revisar' else ' possíveis duplicidades para revisar' end,
      public.nino_diag_brl(v_duplicate_amount) || ' podem estar contados duas vezes.',
      'É uma pendência de qualidade dos dados, não um highlight comportamental.',
      null, (_as_of+21)::timestamptz,
      jsonb_build_object('pairs',v_duplicate_pairs,'pair_count',v_duplicate_count,'amount_at_risk',v_duplicate_amount),
      jsonb_build_object('evidence_type','duplicate_groups','metric_key','duplicate_pair_count','value',v_duplicate_count,
                         'pairs',v_duplicate_pairs),
      jsonb_build_object('key','duplicates:review','type','review_duplicates',
                         'title','Revisar duplicidades','route','/app/lancamentos?revisar=duplicidades','priority',72)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.13 Confirmações reais da Divisão do Rolê permanecem operacionais.
  -- Status atual de cobrança não é reescrito em backtests históricos.
  if _run_mode <> 'backtest' then
    for r in
      select p.id participant_id, p.name, p.amount_due, p.amount_paid, p.status,
             se.id shared_expense_id, se.title shared_expense_title
        from public.shared_expense_participants p
        join public.shared_expenses se on se.id=p.shared_expense_id
       where se.owner_user_id=_user_id and se.deleted_at is null
         and p.status in ('payment_reported','awaiting_owner_confirmation')
    loop
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, v_run_id, _as_of,
        'shared_payment_confirmation', 'split_confirmation:' || r.participant_id::text,
        'active', 'now', 'attention', 1,
        _as_of, _as_of,
        greatest(coalesce(r.amount_due,0)-coalesce(r.amount_paid,0),0), 0,
        greatest(coalesce(r.amount_due,0)-coalesce(r.amount_paid,0),0), null,
        greatest(coalesce(r.amount_due,0)-coalesce(r.amount_paid,0),0),
        '1 pagamento aguardando sua confirmação',
        r.name || ' informou pagamento em “' || r.shared_expense_title || '”.',
        'Confirmar atualiza o valor a receber e encerra os lembretes daquele participante.',
        null, (_as_of+30)::timestamptz,
        jsonb_build_object('participant_id',r.participant_id,'shared_expense_id',r.shared_expense_id,'status',r.status),
        jsonb_build_object('evidence_type','shared_payment','metric_key','amount_due','value',
                           greatest(coalesce(r.amount_due,0)-coalesce(r.amount_paid,0),0)),
        jsonb_build_object('key','split:confirm','type','confirm_shared_payment',
                           'title','Confirmar pagamento','route','/app/divisao-do-role/' || r.shared_expense_id::text,'priority',96)
      );
      v_detected := v_detected + 1;
    end loop;

  end if;

  -- O que não foi revalidado nesta execução deixa de ser atual.
  update public.financial_situations
     set status='resolved', resolved_at=now(), updated_at=now()
   where user_id=_user_id and run_mode=_run_mode
     and status='observed'
     and temporal_scope in ('now','future')
     and last_evaluation_run_id is distinct from v_run_id;
  get diagnostics v_resolved = row_count;

  update public.financial_situations
     set status='expired', resolved_at=coalesce(resolved_at,now()), updated_at=now()
   where user_id=_user_id and run_mode=_run_mode
     and status not in ('resolved','expired','suppressed')
     and valid_until is not null and valid_until<now();

  update public.nino_diagnosis_runs
     set status='completed', situations_created=v_detected,
         situations_resolved=v_resolved, finished_at=now()
   where id=v_run_id;

  return jsonb_build_object('ok',true,'run_id',v_run_id,'detected',v_detected,
                            'resolved',v_resolved,'as_of',_as_of,'run_mode',_run_mode);
exception when others then
  update public.nino_diagnosis_runs
     set status='failed', error_message=sqlerrm, finished_at=now()
   where id=v_run_id;
  raise;
end $$;

revoke all on function public.nino_evaluate_financial_situations(uuid,date,text,text) from public, anon, authenticated;