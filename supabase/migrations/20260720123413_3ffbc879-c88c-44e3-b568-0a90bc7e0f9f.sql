-- Contabilidade v3.1 (retry) — corrige status insights
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_movement_kind_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_movement_kind_check
  CHECK (movement_kind IN ('transaction','refund','internal_transfer','investment_application','investment_redemption','investment_yield','loan_proceeds'));

ALTER TABLE public.extracted_items DROP CONSTRAINT IF EXISTS extracted_items_movement_kind_check;
ALTER TABLE public.extracted_items ADD CONSTRAINT extracted_items_movement_kind_check
  CHECK (movement_kind IN ('transaction','refund','internal_transfer','investment_application','investment_redemption','investment_yield','loan_proceeds'));

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS categories_user_active_idx ON public.categories(user_id, type) WHERE archived_at IS NULL;

INSERT INTO public.categories (user_id, name, type, slug, color, icon)
SELECT NULL, 'Aplicações e Resgates', 'expense', 'aplicacoes-e-resgates', '#0EA5E9', 'Tag'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE user_id IS NULL AND slug='aplicacoes-e-resgates');

INSERT INTO public.categories (user_id, name, type, slug, color, icon)
SELECT NULL, 'Crédito de empréstimo', 'income', 'credito-emprestimo', '#8B5CF6', 'Wallet'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE user_id IS NULL AND slug='credito-emprestimo');

DO $$
DECLARE
  v_user uuid := '088920ce-1f5e-47d5-9e07-e2e4a63f9214';
  v_cat_yield uuid; v_cat_app_resg uuid; v_cat_credito uuid;
  v_cat_transporte uuid; v_cat_mercado uuid; v_cat_alimentacao uuid;
  v_cat_lazer uuid; v_cat_seguros uuid; v_cat_dividas uuid; v_cat_outros uuid;
  v_updated int; v_total int := 0;
BEGIN
  INSERT INTO public.categories (user_id, name, type, slug, color, icon)
  SELECT v_user, 'Seguros', 'expense', 'seguros-' || substr(v_user::text,1,6), '#E9A23B', 'Tag'
  WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE user_id=v_user AND slug='seguros-' || substr(v_user::text,1,6));

  INSERT INTO public.categories (user_id, name, type, slug, color, icon)
  SELECT v_user, 'Dívidas e empréstimos', 'expense', 'dividas-e-emprestimos-' || substr(v_user::text,1,6), '#DC4C64', 'Tag'
  WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE user_id=v_user AND slug='dividas-e-emprestimos-' || substr(v_user::text,1,6));

  SELECT id INTO v_cat_yield        FROM public.categories WHERE user_id IS NULL AND slug='investimentos-rendimento';
  SELECT id INTO v_cat_app_resg     FROM public.categories WHERE user_id IS NULL AND slug='aplicacoes-e-resgates';
  SELECT id INTO v_cat_credito      FROM public.categories WHERE user_id IS NULL AND slug='credito-emprestimo';
  SELECT id INTO v_cat_transporte   FROM public.categories WHERE user_id IS NULL AND slug='transporte';
  SELECT id INTO v_cat_mercado      FROM public.categories WHERE user_id IS NULL AND slug='mercado';
  SELECT id INTO v_cat_alimentacao  FROM public.categories WHERE user_id IS NULL AND slug='alimentacao';
  SELECT id INTO v_cat_lazer        FROM public.categories WHERE user_id IS NULL AND slug='lazer';
  SELECT id INTO v_cat_outros       FROM public.categories WHERE user_id IS NULL AND slug='outros';
  SELECT id INTO v_cat_seguros      FROM public.categories WHERE user_id=v_user AND slug LIKE 'seguros-%';
  SELECT id INTO v_cat_dividas      FROM public.categories WHERE user_id=v_user AND slug LIKE 'dividas-e-emprestimos-%';

  UPDATE public.transactions SET friendly_description='Rendimento de aplicação', category_id=v_cat_yield, movement_kind='investment_yield'
   WHERE user_id=v_user AND description ILIKE 'Rendimento de aplicaç%' AND movement_kind IN ('transaction','investment_yield');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated; RAISE NOTICE 'rendimento_aplicacao: %', v_updated;

  UPDATE public.transactions SET friendly_description='Resgate de CDB', category_id=v_cat_app_resg, movement_kind='investment_redemption'
   WHERE user_id=v_user AND description ILIKE 'Resgate de CDB%' AND movement_kind IN ('transaction','investment_redemption');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated; RAISE NOTICE 'resgate_cdb: %', v_updated;

  UPDATE public.transactions SET friendly_description='Resgate de investimento — Sabesp FIA', category_id=v_cat_app_resg, movement_kind='investment_redemption'
   WHERE user_id=v_user AND (id='4c1a0f4b-8c85-4141-8934-638b457c7afb' OR description ILIKE '%Sabesp%Fia%' OR description ILIKE '%Resgate Sabesp%' OR description ILIKE '%Int Resgate%');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated; RAISE NOTICE 'sabesp: %', v_updated;

  UPDATE public.transactions SET friendly_description='Crédito de empréstimo consignado', category_id=v_cat_credito, movement_kind='loan_proceeds'
   WHERE user_id=v_user AND type='income' AND (id='bc4dd74e-b5db-4248-b351-46b7027d054a' OR description ILIKE '%consignado%' OR description ILIKE '%emprestimo%' OR description ILIKE '%empréstimo%');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated; RAISE NOTICE 'loan: %', v_updated;

  UPDATE public.transactions SET friendly_description='Estorno Uber', category_id=v_cat_transporte, movement_kind='refund'
   WHERE user_id=v_user AND description ILIKE 'Estorno Uber%';
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated; RAISE NOTICE 'estorno_uber: %', v_updated;

  UPDATE public.transactions SET friendly_description='Market4you', category_id=COALESCE(v_cat_mercado,category_id)
   WHERE user_id=v_user AND description ILIKE 'PAY Souk4%' AND (friendly_description IS NULL OR friendly_description=description OR friendly_description='');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  UPDATE public.transactions SET friendly_description='Nutricar', category_id=COALESCE(v_cat_alimentacao,category_id)
   WHERE user_id=v_user AND (description ILIKE '%Pay Nutri%' OR description ILIKE '%Nutricar%')
   AND (friendly_description IS NULL OR friendly_description=description OR friendly_description='');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  UPDATE public.transactions SET friendly_description='iFood', category_id=COALESCE(v_cat_alimentacao,category_id)
   WHERE user_id=v_user AND description ILIKE 'Pay Ifd%' AND (friendly_description IS NULL OR friendly_description=description OR friendly_description='');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  UPDATE public.transactions SET friendly_description='OXXO', category_id=COALESCE(v_cat_mercado,category_id)
   WHERE user_id=v_user AND description ILIKE 'Pay Oxxo%' AND (friendly_description IS NULL OR friendly_description=description OR friendly_description='');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  UPDATE public.transactions SET friendly_description='MEP Eventos', category_id=COALESCE(v_cat_lazer,category_id)
   WHERE user_id=v_user AND description ILIKE 'Pay Mep%' AND (friendly_description IS NULL OR friendly_description=description OR friendly_description='');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  UPDATE public.transactions SET friendly_description='Lanche', category_id=COALESCE(v_cat_alimentacao,category_id)
   WHERE user_id=v_user AND description ILIKE 'Pay Lanch%' AND (friendly_description IS NULL OR friendly_description=description OR friendly_description='');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  UPDATE public.transactions SET friendly_description='McDonald''s', category_id=COALESCE(v_cat_alimentacao,category_id)
   WHERE user_id=v_user AND (description ILIKE '%Mc Donalds%' OR description ILIKE '%McDonalds%')
   AND (friendly_description IS NULL OR friendly_description=description OR friendly_description='');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  UPDATE public.transactions SET category_id=v_cat_seguros
   WHERE user_id=v_user AND description ILIKE '%Seguro%cart%' AND (category_id IS NULL OR category_id=v_cat_outros);
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  UPDATE public.transactions SET friendly_description='Pagamento de renegociação — Banco PAN', category_id=COALESCE(v_cat_dividas,category_id)
   WHERE user_id=v_user AND description ILIKE 'BOLETO Banco PAN%Reneg%'
   AND (friendly_description IS NULL OR friendly_description=description OR friendly_description='');
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  UPDATE public.transactions SET category_id=v_cat_app_resg
   WHERE user_id=v_user AND description ILIKE 'APLICACAO CDB%' AND (category_id IS NULL OR category_id=v_cat_outros);
  GET DIAGNOSTICS v_updated=ROW_COUNT; v_total:=v_total+v_updated;

  RAISE NOTICE 'v3_1_total: %', v_total;
END $$;

-- Invalidar insights antigos (usa apenas status; sem dismissed_at)
UPDATE public.user_insights
   SET status='dismissed'
 WHERE user_id='088920ce-1f5e-47d5-9e07-e2e4a63f9214'
   AND status='active'
   AND ((evidence->>'accounting_scope') IS DISTINCT FROM 'behavioral_v1');