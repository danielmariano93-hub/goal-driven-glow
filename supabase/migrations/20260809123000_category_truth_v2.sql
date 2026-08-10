-- Category Truth V2
-- Single categorization truth, personal memory, safe cross-user consensus,
-- fail-closed provenance and an automatic lease-based worker.

-- ---------------------------------------------------------------------------
-- 0) Provenance contract
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_category_source_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_category_source_check
  CHECK (category_source IS NULL OR category_source = ANY (ARRAY[
    'user','personal','alias','history','global','rule','llm','none',
    'legacy','import','document_hint','engine'
  ]));

ALTER TABLE public.category_decisions DROP CONSTRAINT IF EXISTS category_decisions_source_check;
ALTER TABLE public.category_decisions ADD CONSTRAINT category_decisions_source_check
  CHECK (source = ANY (ARRAY[
    'user','personal','alias','history','global','rule','llm','none',
    'legacy','import','document_hint','engine'
  ]));

-- Legacy audit treated any source-less origin=manual category as user truth.
-- That is unsafe because AgentCore historically also inserted with origin=manual.
-- V2 trusts inserts only when provenance is supplied explicitly; source-less
-- categories become an engine hint and must pass the central worker.
CREATE OR REPLACE FUNCTION public.tg_transactions_category_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path='public'
AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.category_id IS NOT NULL AND NEW.category_source IS NULL THEN
      NEW.category_source := CASE WHEN NEW.origin::text='import' THEN 'import' ELSE 'engine' END;
      NEW.category_confidence := CASE WHEN NEW.origin::text='import' THEN 0.80 ELSE 0.60 END;
      NEW.category_reason := 'categoria recebida sem provenance explícita; aguardando motor central';
      NEW.user_edited_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
    NEW.previous_category_id := OLD.category_id;
    -- A direct category-only update under the user's RLS context is a manual
    -- correction. Engine/import updates always set category_source together.
    IF NEW.category_id IS NOT NULL
       AND NEW.category_source IS NOT DISTINCT FROM OLD.category_source
    THEN
      NEW.category_source := 'user';
      NEW.category_confidence := 1;
      NEW.category_reason := 'edição manual do usuário';
      NEW.user_edited_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Canonical merchant identity used by persisted learning. This mirrors the V2
-- TypeScript normalizer: accents/punctuation removed, standalone numeric noise
-- removed (except merchant "99"), known banking/adquirer noise removed, then
-- the first three stable tokens are retained. Embedded digits survive (Souk4u).
CREATE OR REPLACE FUNCTION public.category_merchant_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path='public'
AS $$
  WITH base AS (
    SELECT public.category_alias_key(p_text) AS value
  ), tokens AS (
    SELECT token, ord
    FROM base,
      regexp_split_to_table(trim(base.value), E'\\s+') WITH ORDINALITY AS x(token, ord)
    WHERE length(token) >= 2
      AND token NOT IN (
        'pay','pix','ted','doc','compra','pagamento','pgto','debito','credito','cred','deb',
        'cartao','boleto','transf','transferencia','recebimento','redecard','stone','cielo',
        'getnet','rede','pagseguro','pagbank','mercpago','mercadopago','picpay',
        'de','do','da','em','no','na','ltda','me','sa','eireli','mei','epp','atm','tmob'
      )
      AND (token = '99' OR token !~ '^[0-9]+$')
  ), first_three AS (
    SELECT token, ord FROM tokens ORDER BY ord LIMIT 3
  )
  SELECT coalesce(string_agg(token, ' ' ORDER BY ord), '') FROM first_three;
$$;

-- ---------------------------------------------------------------------------
-- 1) Personal memory + privacy-safe global consensus
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_merchant_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_key text NOT NULL CHECK (length(merchant_key) >= 2),
  transaction_type text NOT NULL CHECK (transaction_type IN ('income','expense')),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  category_slug text NOT NULL,
  evidence_count integer NOT NULL DEFAULT 1 CHECK (evidence_count > 0),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, merchant_key, transaction_type)
);
ALTER TABLE public.user_merchant_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_merchant_preferences_own ON public.user_merchant_preferences;
CREATE POLICY user_merchant_preferences_own
  ON public.user_merchant_preferences FOR SELECT TO authenticated
  USING (user_id=auth.uid());
REVOKE ALL ON TABLE public.user_merchant_preferences FROM anon;
GRANT SELECT ON TABLE public.user_merchant_preferences TO authenticated;

-- One vote per user/merchant/type. evidence_count is audit context only; it does
-- NOT give one user more weight in global consensus.
CREATE TABLE IF NOT EXISTS public.merchant_global_votes (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_key text NOT NULL CHECK (length(merchant_key) >= 2),
  transaction_type text NOT NULL CHECK (transaction_type IN ('income','expense')),
  semantic_category_slug text NOT NULL,
  evidence_count integer NOT NULL DEFAULT 1 CHECK (evidence_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,merchant_key,transaction_type)
);
ALTER TABLE public.merchant_global_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.merchant_global_votes FROM anon,authenticated;

-- Cross-user knowledge contains only aggregate consensus; raw user votes remain
-- service-only. Curated cross-user knowledge lives in merchantCatalog.ts, so
-- there is one code source of truth for high-precision known merchants.
CREATE TABLE IF NOT EXISTS public.merchant_global_knowledge (
  merchant_key text NOT NULL CHECK (length(merchant_key) >= 2),
  transaction_type text NOT NULL CHECK (transaction_type IN ('income','expense')),
  canonical_name text NOT NULL,
  semantic_category_slug text NOT NULL,
  patterns text[] NOT NULL DEFAULT '{}',
  source text NOT NULL CHECK (source IN ('curated','consensus')),
  status text NOT NULL CHECK (status IN ('curated','verified','candidate','disabled')),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  unique_users integer NOT NULL DEFAULT 0 CHECK (unique_users >= 0),
  agreement numeric(5,4) CHECK (agreement IS NULL OR agreement BETWEEN 0 AND 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_key,transaction_type)
);
ALTER TABLE public.merchant_global_knowledge ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.merchant_global_knowledge FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.user_merchant_preferences TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.merchant_global_votes TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.merchant_global_knowledge TO service_role;

CREATE INDEX IF NOT EXISTS idx_user_merchant_preferences_category
  ON public.user_merchant_preferences(user_id,transaction_type,category_id);
CREATE INDEX IF NOT EXISTS idx_merchant_global_votes_consensus
  ON public.merchant_global_votes(merchant_key,transaction_type,semantic_category_slug);
CREATE INDEX IF NOT EXISTS idx_merchant_global_knowledge_verified
  ON public.merchant_global_knowledge(transaction_type,status,merchant_key);

-- Only strong evidence can become personal/global learning:
--   * an explicit category selected by the app/bulk UI;
--   * an explicit edit after creation;
--   * a category confirmed in document review.
-- Historical agent/model rows that happened to be stamped "user" by legacy
-- audit logic are intentionally NOT promoted merely because source='user'.
CREATE OR REPLACE FUNCTION public.capture_user_merchant_preference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_key text;
  v_slug text;
  v_global_slug text;
  v_verified boolean := false;
BEGIN
  IF NEW.category_id IS NULL
     OR NEW.type NOT IN ('income','expense')
     OR coalesce(NEW.movement_kind,'transaction') <> 'transaction'
     OR NEW.transfer_group_id IS NOT NULL
     OR NEW.settles_card_id IS NOT NULL
     OR NEW.shared_expense_id IS NOT NULL
  THEN
    RETURN NEW;
  END IF;

  IF NEW.category_source='user' AND coalesce(NEW.category_reason,'') IN (
    'escolha explícita',
    'escolha explícita em lote',
    'edição manual do usuário',
    'categoria confirmada na revisão do documento'
  ) THEN
    v_verified := true;
  ELSIF TG_OP='UPDATE'
        AND NEW.category_source='user'
        AND NEW.user_edited_at IS DISTINCT FROM OLD.user_edited_at
        AND NEW.user_edited_at IS NOT NULL
  THEN
    v_verified := true;
  END IF;

  IF NOT v_verified THEN RETURN NEW; END IF;

  v_key := public.category_merchant_key(
    coalesce(NEW.normalized_description,NEW.friendly_description,NEW.description,NEW.raw_description)
  );
  IF length(v_key)<2 THEN RETURN NEW; END IF;

  SELECT slug INTO v_slug
  FROM public.categories
  WHERE id=NEW.category_id AND type::text=NEW.type::text AND archived_at IS NULL;
  IF v_slug IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.user_merchant_preferences(
    user_id,merchant_key,transaction_type,category_id,category_slug,evidence_count,confirmed_at,updated_at
  ) VALUES(
    NEW.user_id,v_key,NEW.type::text,NEW.category_id,v_slug,1,now(),now()
  )
  ON CONFLICT(user_id,merchant_key,transaction_type) DO UPDATE SET
    category_id=EXCLUDED.category_id,
    category_slug=EXCLUDED.category_slug,
    evidence_count=public.user_merchant_preferences.evidence_count+1,
    confirmed_at=now(),updated_at=now();

  -- Cross-user learning is restricted to the shared/global taxonomy. A user's
  -- custom category remains a personal preference and can never become a
  -- platform-wide semantic category merely because its slug is present here.
  SELECT g.slug INTO v_global_slug
  FROM public.categories g
  WHERE g.user_id IS NULL AND g.archived_at IS NULL
    AND g.type::text=NEW.type::text AND g.slug=v_slug
  LIMIT 1;

  IF v_global_slug IS NOT NULL THEN
    INSERT INTO public.merchant_global_votes(
      user_id,merchant_key,transaction_type,semantic_category_slug,evidence_count,updated_at
    ) VALUES(
      NEW.user_id,v_key,NEW.type::text,v_global_slug,1,now()
    )
    ON CONFLICT(user_id,merchant_key,transaction_type) DO UPDATE SET
      semantic_category_slug=EXCLUDED.semantic_category_slug,
      evidence_count=public.merchant_global_votes.evidence_count+1,
      updated_at=now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_capture_user_merchant_preference ON public.transactions;
CREATE TRIGGER trg_capture_user_merchant_preference
AFTER INSERT OR UPDATE OF category_id,category_source,category_reason,user_edited_at
ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.capture_user_merchant_preference();

-- Conservative historical backfill. Do not promote generic legacy/import/model
-- rows. An explicit app reason OR an edit materially after creation is required.
INSERT INTO public.user_merchant_preferences(
  user_id,merchant_key,transaction_type,category_id,category_slug,evidence_count,confirmed_at,updated_at
)
SELECT DISTINCT ON (t.user_id,public.category_merchant_key(coalesce(t.normalized_description,t.friendly_description,t.description,t.raw_description)),t.type)
  t.user_id,
  public.category_merchant_key(coalesce(t.normalized_description,t.friendly_description,t.description,t.raw_description)),
  t.type::text,t.category_id,c.slug,1,coalesce(t.user_edited_at,t.updated_at,now()),now()
FROM public.transactions t
JOIN public.categories c ON c.id=t.category_id AND c.type::text=t.type::text
WHERE t.category_id IS NOT NULL
  AND t.type IN ('income','expense')
  AND coalesce(t.movement_kind,'transaction')='transaction'
  AND t.transfer_group_id IS NULL
  AND t.settles_card_id IS NULL
  AND t.shared_expense_id IS NULL
  AND (
    (t.category_source='user' AND coalesce(t.category_reason,'') IN (
      'escolha explícita','escolha explícita em lote','edição manual do usuário',
      'categoria confirmada na revisão do documento'
    ))
    OR (t.user_edited_at IS NOT NULL AND t.user_edited_at > t.created_at + interval '1 second')
  )
  AND length(public.category_merchant_key(coalesce(t.normalized_description,t.friendly_description,t.description,t.raw_description)))>=2
ORDER BY
  t.user_id,
  public.category_merchant_key(coalesce(t.normalized_description,t.friendly_description,t.description,t.raw_description)),
  t.type,
  coalesce(t.user_edited_at,t.updated_at) DESC
ON CONFLICT(user_id,merchant_key,transaction_type) DO UPDATE SET
  category_id=EXCLUDED.category_id,
  category_slug=EXCLUDED.category_slug,
  confirmed_at=EXCLUDED.confirmed_at,
  updated_at=now();

INSERT INTO public.merchant_global_votes(
  user_id,merchant_key,transaction_type,semantic_category_slug,evidence_count,updated_at
)
SELECT p.user_id,p.merchant_key,p.transaction_type,g.slug,p.evidence_count,now()
FROM public.user_merchant_preferences p
JOIN public.categories g
  ON g.user_id IS NULL AND g.archived_at IS NULL
 AND g.type::text=p.transaction_type AND g.slug=p.category_slug
ON CONFLICT(user_id,merchant_key,transaction_type) DO UPDATE SET
  semantic_category_slug=EXCLUDED.semantic_category_slug,
  evidence_count=EXCLUDED.evidence_count,
  updated_at=now();

CREATE OR REPLACE FUNCTION public.refresh_merchant_global_consensus()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_count integer := 0;
BEGIN
  -- Consensus is revocable. If agreement later falls below the gate, old
  -- verified knowledge must stop auto-applying immediately.
  UPDATE public.merchant_global_knowledge
     SET status='candidate',updated_at=now()
   WHERE source='consensus' AND status='verified';

  WITH votes AS (
    SELECT merchant_key,transaction_type,semantic_category_slug,count(*)::integer AS users
    FROM public.merchant_global_votes
    GROUP BY 1,2,3
  ), totals AS (
    SELECT merchant_key,transaction_type,sum(users)::integer AS total_users
    FROM votes GROUP BY 1,2
  ), ranked AS (
    SELECT v.*,t.total_users,
      v.users::numeric/nullif(t.total_users,0) AS agreement,
      row_number() over(
        partition by v.merchant_key,v.transaction_type
        order by v.users desc,v.semantic_category_slug
      ) AS rn
    FROM votes v JOIN totals t USING(merchant_key,transaction_type)
  )
  INSERT INTO public.merchant_global_knowledge(
    merchant_key,transaction_type,canonical_name,semantic_category_slug,patterns,
    source,status,confidence,unique_users,agreement,updated_at
  )
  SELECT merchant_key,transaction_type,merchant_key,semantic_category_slug,ARRAY[merchant_key],
    'consensus','verified',least(0.99,agreement),total_users,agreement,now()
  FROM ranked
  WHERE rn=1 AND total_users>=5 AND agreement>=0.95
  ON CONFLICT(merchant_key,transaction_type) DO UPDATE SET
    semantic_category_slug=EXCLUDED.semantic_category_slug,
    patterns=EXCLUDED.patterns,
    source='consensus',status='verified',confidence=EXCLUDED.confidence,
    unique_users=EXCLUDED.unique_users,agreement=EXCLUDED.agreement,updated_at=now()
  WHERE public.merchant_global_knowledge.source='consensus';

  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.refresh_merchant_global_consensus() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_merchant_global_consensus() TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Agent transaction confirmation with explicit category provenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agent_execute_transaction_confirmation_v2(
  p_confirmation_id uuid,
  p_source_message_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  c public.pending_confirmations;
  p jsonb;
  v_pay_method text;
  v_card record;
  v_n_inst integer;
  v_total_cents bigint;
  v_base_cents bigint;
  v_extra_cents integer;
  v_inst_amount numeric;
  v_purchase date;
  v_comp_date date;
  v_group uuid;
  v_new uuid;
  v_first uuid;
  v_i integer;
  v_category uuid;
  v_category_explicit boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO c
  FROM public.pending_confirmations
  WHERE id=p_confirmation_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  IF c.kind<>'transaction' THEN RETURN jsonb_build_object('ok',false,'error','wrong_kind'); END IF;
  IF c.status='confirmed' AND c.result_snapshot IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'result',c.result_snapshot);
  END IF;
  IF c.status='cancelled' THEN RETURN jsonb_build_object('ok',false,'error','cancelled'); END IF;
  IF c.status='expired' OR c.expires_at<now() THEN
    UPDATE public.pending_confirmations SET status='expired' WHERE id=c.id AND status='pending';
    RETURN jsonb_build_object('ok',false,'error','expired');
  END IF;

  p := coalesce(c.payload,'{}'::jsonb);
  IF p->>'type' NOT IN ('income','expense') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_type');
  END IF;

  v_category_explicit := coalesce((p->>'category_explicit')::boolean,false);
  v_category := CASE WHEN v_category_explicit THEN nullif(p->>'category_id','')::uuid ELSE NULL END;
  IF v_category IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories cat
    WHERE cat.id=v_category
      AND (cat.user_id IS NULL OR cat.user_id=c.user_id)
      AND cat.archived_at IS NULL
      AND cat.type::text=p->>'type'
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','category_not_owned_or_type');
  END IF;

  v_pay_method := coalesce(nullif(p->>'payment_method',''),'account');
  v_purchase := coalesce(nullif(p->>'occurred_at','')::date,current_date);

  IF v_pay_method='credit_card' THEN
    IF p->>'type'<>'expense' THEN RETURN jsonb_build_object('ok',false,'error','card_income_not_supported'); END IF;
    SELECT id,closing_day,name INTO v_card
    FROM public.credit_cards
    WHERE id=nullif(p->>'credit_card_id','')::uuid AND user_id=c.user_id AND active=true;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','card_not_owned'); END IF;

    v_n_inst := greatest(1,least(48,coalesce((p->>'installments_total')::integer,1)));
    v_total_cents := round((p->>'amount')::numeric*100)::bigint;
    IF v_total_cents<=0 THEN RETURN jsonb_build_object('ok',false,'error','invalid_amount'); END IF;
    v_base_cents := v_total_cents/v_n_inst;
    v_extra_cents := (v_total_cents-v_base_cents*v_n_inst)::integer;
    v_group := gen_random_uuid();

    FOR v_i IN 1..v_n_inst LOOP
      v_inst_amount := ((v_base_cents+CASE WHEN v_i=1 THEN v_extra_cents ELSE 0 END)::numeric)/100.0;
      IF v_i=1 THEN
        IF extract(day from v_purchase)::integer<=v_card.closing_day THEN
          v_comp_date:=date_trunc('month',v_purchase)::date;
        ELSE
          v_comp_date:=(date_trunc('month',v_purchase)+interval '1 month')::date;
        END IF;
      ELSE
        v_comp_date:=(v_comp_date+interval '1 month')::date;
      END IF;

      INSERT INTO public.transactions(
        user_id,account_id,category_id,type,status,amount,occurred_at,description,
        payment_method,credit_card_id,installment_number,installments_total,
        purchase_date,competence_date,emotional_trigger,purchase_group_id,
        origin,movement_kind,category_source,category_confidence,category_reason,user_edited_at
      ) VALUES (
        c.user_id,NULL,v_category,(p->>'type')::public.transaction_type,'confirmed'::public.transaction_status,
        v_inst_amount,v_purchase,nullif(p->>'description',''),'credit_card',v_card.id,v_i,v_n_inst,
        v_purchase,v_comp_date,nullif(p->>'emotional_trigger',''),v_group,
        'agent'::public.txn_origin,'transaction',
        CASE WHEN v_category IS NOT NULL THEN 'user' ELSE NULL END,
        CASE WHEN v_category IS NOT NULL THEN 1 ELSE NULL END,
        CASE WHEN v_category IS NOT NULL THEN 'escolha explícita' ELSE NULL END,
        CASE WHEN v_category IS NOT NULL THEN now() ELSE NULL END
      ) RETURNING id INTO v_new;
      IF v_i=1 THEN v_first:=v_new; END IF;
    END LOOP;

    v_result:=jsonb_build_object(
      'kind','transaction','transaction_id',v_first,'purchase_group_id',v_group,
      'type',p->>'type','amount',p->>'amount','payment_method','credit_card',
      'credit_card_id',v_card.id,'installments_total',v_n_inst
    );
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id=nullif(p->>'account_id','')::uuid AND a.user_id=c.user_id AND coalesce(a.active,true)=true
    ) THEN
      RETURN jsonb_build_object('ok',false,'error','account_not_owned');
    END IF;
    IF (p->>'amount')::numeric<=0 THEN RETURN jsonb_build_object('ok',false,'error','invalid_amount'); END IF;

    INSERT INTO public.transactions(
      user_id,account_id,category_id,type,status,amount,occurred_at,description,
      emotional_trigger,payment_method,origin,movement_kind,
      category_source,category_confidence,category_reason,user_edited_at
    ) VALUES (
      c.user_id,(p->>'account_id')::uuid,v_category,
      (p->>'type')::public.transaction_type,'confirmed'::public.transaction_status,
      (p->>'amount')::numeric,v_purchase,nullif(p->>'description',''),nullif(p->>'emotional_trigger',''),
      'account','agent'::public.txn_origin,'transaction',
      CASE WHEN v_category IS NOT NULL THEN 'user' ELSE NULL END,
      CASE WHEN v_category IS NOT NULL THEN 1 ELSE NULL END,
      CASE WHEN v_category IS NOT NULL THEN 'escolha explícita' ELSE NULL END,
      CASE WHEN v_category IS NOT NULL THEN now() ELSE NULL END
    ) RETURNING id INTO v_new;
    v_result:=jsonb_build_object(
      'kind','transaction','transaction_id',v_new,'type',p->>'type','amount',p->>'amount','payment_method','account'
    );
  END IF;

  UPDATE public.pending_confirmations
     SET status='confirmed',executed_at=now(),result_snapshot=v_result,
         confirmed_from_message_id=p_source_message_id
   WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'result',v_result);
END $$;
REVOKE ALL ON FUNCTION public.agent_execute_transaction_confirmation_v2(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_execute_transaction_confirmation_v2(uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Document provenance: preserve manual review and trusted V2 decisions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inherit_document_category_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
  v_doc_id uuid;
  v_idx integer;
  v_src text;
  v_conf numeric;
  v_user_edited timestamptz;
BEGIN
  IF NEW.category_id IS NULL
     OR NEW.origin::text <> 'import'
     OR coalesce(NEW.import_source_id,'') !~ '^document:[0-9a-fA-F-]{36}:[0-9]+$'
  THEN RETURN NEW; END IF;

  BEGIN
    v_doc_id := split_part(NEW.import_source_id,':',2)::uuid;
    v_idx := split_part(NEW.import_source_id,':',3)::integer;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  SELECT category_source,category_confidence,user_edited_at
    INTO v_src,v_conf,v_user_edited
  FROM public.extracted_items
  WHERE document_id=v_doc_id AND user_id=NEW.user_id AND idx=v_idx
  LIMIT 1;

  IF v_user_edited IS NOT NULL THEN
    NEW.category_source := 'user';
    NEW.category_confidence := 1;
    NEW.category_reason := 'categoria confirmada na revisão do documento';
    NEW.user_edited_at := v_user_edited;
  ELSIF v_src IN ('personal','alias','history','global','rule') THEN
    NEW.category_source := v_src;
    NEW.category_confidence := coalesce(v_conf,0.85);
    NEW.category_reason := 'categoria aplicada pelo Category Truth V2 durante importação';
    NEW.category_engine_version := 'categorization_truth.v2';
    NEW.category_classified_at := now();
  ELSE
    -- Any other document/model hint remains explicitly untrusted.
    NEW.category_source := 'document_hint';
    NEW.category_confidence := least(coalesce(v_conf,0.60),0.84);
    NEW.category_reason := 'categoria de origem aguardando validação do motor central';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS transactions_00_document_category_provenance ON public.transactions;
CREATE TRIGGER transactions_00_document_category_provenance
BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.inherit_document_category_provenance();

-- ---------------------------------------------------------------------------
-- 4) Single operational gate: every eligible untrusted write is queued
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_transaction_category_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_trusted boolean;
BEGIN
  IF NEW.type IN ('income','expense')
     AND coalesce(NEW.movement_kind,'transaction')='transaction'
     AND coalesce(NEW.status,'confirmed')='confirmed'
     AND NEW.transfer_group_id IS NULL
     AND NEW.settles_card_id IS NULL
     AND NEW.shared_expense_id IS NULL
  THEN
    v_trusted := NEW.category_id IS NOT NULL
      AND coalesce(NEW.category_source,'') IN ('user','personal','alias','history','global','rule');
    IF v_trusted THEN
      NEW.category_review_status := 'resolved';
    ELSIF NEW.category_id IS NOT NULL AND NEW.category_source='llm' THEN
      NEW.category_review_status := 'suggested';
    ELSE
      NEW.category_review_status := 'needs_review';
    END IF;
  ELSE
    NEW.category_review_status := 'excluded';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_transaction_categorization_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE v_eligible boolean; v_trusted boolean;
BEGIN
  v_eligible := NEW.type IN ('income','expense')
    AND coalesce(NEW.movement_kind,'transaction')='transaction'
    AND coalesce(NEW.status,'confirmed')='confirmed'
    AND NEW.transfer_group_id IS NULL
    AND NEW.settles_card_id IS NULL
    AND NEW.shared_expense_id IS NULL;
  v_trusted := NEW.category_id IS NOT NULL
    AND coalesce(NEW.category_source,'') IN ('user','personal','alias','history','global','rule');

  IF v_eligible AND NOT v_trusted THEN
    INSERT INTO public.category_classification_queue(
      user_id,transaction_id,status,attempts,available_at,locked_at,processed_at,last_error,updated_at
    ) VALUES(
      NEW.user_id,NEW.id,'queued',0,now(),NULL,NULL,NULL,now()
    )
    ON CONFLICT(transaction_id) DO UPDATE SET
      status='queued',attempts=0,available_at=now(),locked_at=NULL,processed_at=NULL,last_error=NULL,updated_at=now()
    WHERE public.category_classification_queue.status <> 'processing';
  ELSE
    DELETE FROM public.category_classification_queue
    WHERE transaction_id=NEW.id AND status <> 'processing';
  END IF;
  RETURN NULL;
END $$;

-- Existing trigger names already point to these functions; re-create defensively
-- in case an environment drifted.
DROP TRIGGER IF EXISTS transactions_mark_category_review ON public.transactions;
CREATE TRIGGER transactions_mark_category_review
BEFORE INSERT OR UPDATE OF category_id,category_source,description,friendly_description,normalized_description,type,movement_kind,status
ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.mark_transaction_category_review();

DROP TRIGGER IF EXISTS transactions_enqueue_categorization ON public.transactions;
CREATE TRIGGER transactions_enqueue_categorization
AFTER INSERT OR UPDATE OF category_id,category_source,description,friendly_description,normalized_description,type,movement_kind,status
ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.enqueue_transaction_categorization_after();

-- ---------------------------------------------------------------------------
-- 5) Lease-based queue claiming with bounded retries
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_category_classification_batch(
  p_limit integer DEFAULT 100,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  queue_id uuid,transaction_id uuid,user_id uuid,type text,description text,
  movement_kind text,transfer_group_id uuid,settles_card_id uuid,shared_expense_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
BEGIN
  UPDATE public.category_classification_queue
     SET status='failed',locked_at=NULL,available_at=now(),last_error='stale_processing_lease',updated_at=now()
   WHERE status='processing' AND locked_at<now()-interval '5 minutes';

  -- Close queue rows that are no longer eligible instead of leasing them forever.
  UPDATE public.category_classification_queue q
     SET status='completed',processed_at=now(),locked_at=NULL,last_error='no_longer_eligible',updated_at=now()
   WHERE q.status IN ('queued','failed')
     AND NOT EXISTS (
       SELECT 1 FROM public.transactions t
       WHERE t.id=q.transaction_id AND t.user_id=q.user_id
         AND t.type IN ('income','expense')
         AND coalesce(t.movement_kind,'transaction')='transaction'
         AND coalesce(t.status,'confirmed')='confirmed'
         AND t.transfer_group_id IS NULL
         AND t.settles_card_id IS NULL
         AND t.shared_expense_id IS NULL
         AND NOT (
           t.category_id IS NOT NULL
           AND coalesce(t.category_source,'') IN ('user','personal','alias','history','global','rule')
         )
     );

  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.category_classification_queue q
    JOIN public.transactions t ON t.id=q.transaction_id AND t.user_id=q.user_id
    WHERE q.status IN ('queued','failed')
      AND q.attempts < 5
      AND q.available_at<=now()
      AND (p_user_id IS NULL OR q.user_id=p_user_id)
      AND t.type IN ('income','expense')
      AND coalesce(t.movement_kind,'transaction')='transaction'
      AND coalesce(t.status,'confirmed')='confirmed'
      AND t.transfer_group_id IS NULL
      AND t.settles_card_id IS NULL
      AND t.shared_expense_id IS NULL
      AND NOT (
        t.category_id IS NOT NULL
        AND coalesce(t.category_source,'') IN ('user','personal','alias','history','global','rule')
      )
    ORDER BY q.available_at,q.created_at
    FOR UPDATE OF q SKIP LOCKED
    LIMIT greatest(1,least(coalesce(p_limit,100),500))
  ), locked AS (
    UPDATE public.category_classification_queue q
       SET status='processing',locked_at=now(),attempts=q.attempts+1,updated_at=now()
      FROM picked p
     WHERE q.id=p.id
     RETURNING q.id,q.transaction_id,q.user_id
  )
  SELECT l.id,t.id,t.user_id,t.type::text,
    coalesce(t.friendly_description,t.raw_description,t.description),
    t.movement_kind,t.transfer_group_id,t.settles_card_id,t.shared_expense_id
  FROM locked l
  JOIN public.transactions t ON t.id=l.transaction_id AND t.user_id=l.user_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_category_classification_batch(integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_category_classification_batch(integer,uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Semantic category type integrity + conservative repair of impossible rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_transaction_category_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path='public'
AS $$
DECLARE v_type text;
BEGIN
  IF NEW.category_id IS NULL OR NEW.type NOT IN ('income','expense') THEN RETURN NEW; END IF;
  SELECT type::text INTO v_type FROM public.categories WHERE id=NEW.category_id;
  IF v_type IS NULL THEN RAISE EXCEPTION 'category_not_found:%',NEW.category_id; END IF;

  -- Refunds are income movements that may intentionally inherit the original
  -- EXPENSE category so the behavioral engine can subtract from that category.
  IF NEW.type='income' AND coalesce(NEW.movement_kind,'transaction')='refund' AND v_type='expense' THEN
    RETURN NEW;
  END IF;

  IF v_type IS DISTINCT FROM NEW.type::text THEN
    RAISE EXCEPTION 'category_type_mismatch:%:%',NEW.type,v_type;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enforce_transaction_category_type ON public.transactions;
CREATE TRIGGER trg_enforce_transaction_category_type
BEFORE INSERT OR UPDATE OF category_id,type,movement_kind ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_transaction_category_type();

-- Existing transaction-kind mismatches are semantically impossible under the
-- category schema. Do not guess a replacement: clear only the category and let
-- the V2 queue reclassify. Legitimate income refunds with expense categories are
-- explicitly preserved by the exception above and by this WHERE clause.
UPDATE public.transactions t
SET previous_category_id=t.category_id,
    category_id=NULL,
    category_source=NULL,
    category_confidence=NULL,
    category_reason='Category Truth V2: categoria incompatível removida para reclassificação',
    category_review_status='needs_review',
    category_engine_version='categorization_truth.v2',
    category_classified_at=now()
FROM public.categories c
WHERE c.id=t.category_id
  AND t.type IN ('income','expense')
  AND coalesce(t.movement_kind,'transaction')='transaction'
  AND c.type::text<>t.type::text;

-- ---------------------------------------------------------------------------
-- 7) Automatic worker and consensus jobs (fail closed on missing infrastructure)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'category_truth_v2_requires_pg_cron';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE EXCEPTION 'category_truth_v2_requires_pg_net';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
      AND coalesce(decrypted_secret,'')<>''
  ) THEN
    RAISE EXCEPTION 'category_truth_v2_cron_secret_missing';
  END IF;

  SELECT jobid INTO v_job
  FROM cron.job
  WHERE command LIKE '%category-engine%' AND command LIKE '%process_queue_global%'
  LIMIT 1;
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;

  PERFORM cron.schedule('nino-category-truth-v2-worker','* * * * *',$cmd$
    SELECT net.http_post(
      url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/category-engine',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',coalesce((
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
          ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END,
                   created_at DESC
          LIMIT 1
        ),'')
      ),
      body := jsonb_build_object('operation','process_queue_global','limit',100)
    );
  $cmd$);

  SELECT jobid INTO v_job
  FROM cron.job
  WHERE command='SELECT public.refresh_merchant_global_consensus()'
  LIMIT 1;
  IF v_job IS NULL THEN
    PERFORM cron.schedule(
      'nino-category-global-consensus','13 * * * *',
      'SELECT public.refresh_merchant_global_consensus()'
    );
  END IF;
END $$;

SELECT public.refresh_merchant_global_consensus();
