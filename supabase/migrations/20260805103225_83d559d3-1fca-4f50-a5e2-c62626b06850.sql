CREATE OR REPLACE FUNCTION public.mark_transaction_category_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.category_id IS NULL
     AND NEW.type IN ('income','expense')
     AND coalesce(NEW.movement_kind,'transaction')='transaction'
     AND coalesce(NEW.status,'confirmed')='confirmed'
  THEN
    NEW.category_review_status := 'needs_review';
  ELSIF NEW.category_id IS NOT NULL THEN
    NEW.category_review_status := 'resolved';
  ELSE
    NEW.category_review_status := 'excluded';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_transaction_categorization_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.category_id IS NULL
     AND NEW.type IN ('income','expense')
     AND coalesce(NEW.movement_kind,'transaction')='transaction'
     AND coalesce(NEW.status,'confirmed')='confirmed'
     AND coalesce(NEW.category_source,'none') <> 'user'
  THEN
    INSERT INTO public.category_classification_queue(user_id,transaction_id,status,available_at,updated_at)
    VALUES(NEW.user_id,NEW.id,'queued',now(),now())
    ON CONFLICT(transaction_id) DO UPDATE SET
      status='queued', available_at=now(), last_error=NULL, updated_at=now()
      WHERE public.category_classification_queue.status <> 'processing';
  ELSE
    DELETE FROM public.category_classification_queue WHERE transaction_id=NEW.id AND status <> 'processing';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS transactions_enqueue_categorization ON public.transactions;
CREATE TRIGGER transactions_mark_category_review
  BEFORE INSERT OR UPDATE OF category_id,description,friendly_description,normalized_description,type,movement_kind,status
  ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.mark_transaction_category_review();
CREATE TRIGGER transactions_enqueue_categorization
  AFTER INSERT OR UPDATE OF category_id,description,friendly_description,normalized_description,type,movement_kind,status
  ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enqueue_transaction_categorization_after();