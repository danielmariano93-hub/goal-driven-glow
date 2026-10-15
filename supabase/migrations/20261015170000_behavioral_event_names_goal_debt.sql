-- Mensagem de "você repetiu o que funciona" precisa dizer O QUE foi repetido: o evento passa a carregar o nome da meta/dívida.
CREATE OR REPLACE FUNCTION public.nino_goal_contribution_behavioral_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.nino_mark_behavioral_event(
    NEW.user_id, 'GOAL_CONTRIBUTION', coalesce(NEW.created_at, now()), NEW.id,
    'goal_contributions', coalesce(NEW.amount, 0),
    jsonb_build_object('goal_id', NEW.goal_id, 'goal_name', (SELECT g.name FROM public.goals g WHERE g.id = NEW.goal_id))
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.nino_debt_payment_behavioral_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.nino_mark_behavioral_event(
    NEW.user_id, 'DEBT_PAYMENT', coalesce(NEW.created_at, now()), NEW.id,
    'debt_payments', coalesce(NEW.amount, 0),
    jsonb_build_object('debt_id', NEW.debt_id, 'debt_name', (SELECT d.name FROM public.debts d WHERE d.id = NEW.debt_id))
  );
  RETURN NEW;
END $$;
