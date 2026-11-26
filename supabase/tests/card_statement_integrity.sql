-- Testes de regressão da contabilidade do cartão contra os gatilhos reais. Rodam dentro de um bloco que termina
-- em RAISE EXCEPTION: tudo é desfeito e o resultado sai na mensagem. Usam competências de 2030 (sem colisão).
-- Esperado: 1_avista items=1 stated=reconciled=100; 2_parcelada 3 parcelas (1 billed/scheduled…);
-- 3_parcela_antiga items=1 linked=1 inst_status=paid stated=20 reconciled=20 status=paid;
-- 8_categoria tudo true, inst_status=paid, stated=20; 9_reprocesso items=1 stated=20; nov_real 1004.79.
DO $$
DECLARE u uuid := '088920ce-1f5e-47d5-9e07-e2e4a63f9214'; c uuid := '0780e320-fffb-4cfc-8b87-89a4175a1a36';
  t1 uuid; t2 uuid; t3 uuid; s1 uuid; s2 uuid; pg uuid := gen_random_uuid(); cat_a uuid; cat_b uuid; r jsonb := '{}'; inst2 uuid;
BEGIN
  SELECT id INTO cat_a FROM categories WHERE name='Mercado' AND (user_id=u OR user_id IS NULL) LIMIT 1;
  SELECT id INTO cat_b FROM categories WHERE name='Lazer' AND (user_id=u OR user_id IS NULL) LIMIT 1;
  INSERT INTO transactions(user_id,type,status,amount,occurred_at,purchase_date,competence_date,payment_method,credit_card_id,movement_kind,origin,description,category_id)
  VALUES (u,'expense','confirmed',100,'2029-12-20','2029-12-20','2030-01-01','credit_card',c,'transaction','manual','TESTE à vista',cat_a) RETURNING id INTO t1;
  SELECT id INTO s1 FROM credit_card_statements WHERE credit_card_id=c AND competence_month='2030-01-01';
  r := r || jsonb_build_object('1_avista', (SELECT jsonb_build_object('items',count(*),'stated',max(s.stated_total),'reconciled',max(s.reconciled_total),'item_cat_ok',bool_and(i.category_id=cat_a)) FROM credit_card_statement_items i JOIN credit_card_statements s ON s.id=i.statement_id WHERE i.statement_id=s1));
  INSERT INTO transactions(user_id,type,status,amount,occurred_at,purchase_date,competence_date,payment_method,credit_card_id,installment_number,installments_total,purchase_group_id,movement_kind,origin,description,category_id)
  VALUES (u,'expense','confirmed',50,'2029-12-21','2029-12-21','2030-01-01','credit_card',c,1,3,pg,'transaction','manual','TESTE parcelada',cat_a) RETURNING id INTO t2;
  r := r || jsonb_build_object('2_parcelada', (SELECT jsonb_build_object('installments',count(*),'schedule',string_agg(i.installment_number||':'||i.status||':'||i.competence_month, ' ' ORDER BY i.installment_number)) FROM credit_card_installments i JOIN credit_card_purchases p ON p.id=i.purchase_id WHERE p.legacy_purchase_group_id=pg));
  INSERT INTO credit_card_statements(user_id,credit_card_id,competence_month,due_date,opening_balance,stated_total,signed_total,reconciled_total,status,paid_amount)
  VALUES (u,c,'2030-02-01','2030-02-01',-30,20,20,20,'paid',20) RETURNING id INTO s2;
  SELECT i.id INTO inst2 FROM credit_card_installments i JOIN credit_card_purchases p ON p.id=i.purchase_id WHERE p.legacy_purchase_group_id=pg AND i.installment_number=2;
  UPDATE credit_card_installments SET status='paid' WHERE id=inst2;
  INSERT INTO credit_card_statement_items(user_id,statement_id,installment_id,item_kind,description,amount,occurred_at) VALUES (u,s2,inst2,'installment','TESTE parcelada',50,'2029-12-21');
  INSERT INTO transactions(user_id,type,status,amount,occurred_at,purchase_date,competence_date,payment_method,credit_card_id,installment_number,installments_total,purchase_group_id,movement_kind,origin,description,category_id)
  VALUES (u,'expense','confirmed',50,'2029-12-21','2029-12-21','2030-02-01','credit_card',c,2,3,pg,'transaction','import','TESTE parcelada',cat_a) RETURNING id INTO t3;
  r := r || jsonb_build_object('3_parcela_antiga', (SELECT jsonb_build_object('items',(SELECT count(*) FROM credit_card_statement_items WHERE statement_id=s2),'linked',(SELECT count(*) FROM credit_card_statement_items WHERE statement_id=s2 AND legacy_transaction_id=t3),'inst_status',(SELECT status FROM credit_card_installments WHERE id=inst2),'stated',stated_total,'reconciled',reconciled_total,'status',status) FROM credit_card_statements WHERE id=s2));
  UPDATE transactions SET category_id=cat_b, user_edited_at=now() WHERE id=t3;
  r := r || jsonb_build_object('8_categoria', (SELECT jsonb_build_object('tx_cat_kept',(SELECT category_id=cat_b FROM transactions WHERE id=t3),'item_cat',(SELECT category_id=cat_b FROM credit_card_statement_items WHERE legacy_transaction_id=t3),'purchase_cat',(SELECT category_id=cat_b FROM credit_card_purchases WHERE legacy_purchase_group_id=pg),'inst_status',(SELECT status FROM credit_card_installments WHERE id=inst2),'stated',stated_total,'reconciled',reconciled_total,'items',(SELECT count(*) FROM credit_card_statement_items WHERE statement_id=s2)) FROM credit_card_statements WHERE id=s2));
  UPDATE transactions SET description='TESTE parcelada' WHERE id=t3;
  UPDATE transactions SET notes='reprocessado' WHERE id=t3;
  r := r || jsonb_build_object('9_reprocesso', (SELECT jsonb_build_object('items',(SELECT count(*) FROM credit_card_statement_items WHERE statement_id=s2),'stated',stated_total,'reconciled',reconciled_total) FROM credit_card_statements WHERE id=s2));
  UPDATE transactions SET status='superseded' WHERE id=t1;
  r := r || jsonb_build_object('5_cancelada_fora_do_consumo', (SELECT count(*)=0 FROM transactions WHERE id=t1 AND status='confirmed'));
  r := r || jsonb_build_object('10_pagamento_nao_consumo', NOT EXISTS (SELECT 1 FROM transactions WHERE user_id=u AND movement_kind='card_payment' AND credit_card_id IS NOT NULL));
  r := r || jsonb_build_object('nov_real', (SELECT jsonb_build_object('stated',stated_total,'reconciled',reconciled_total,'status',status) FROM credit_card_statements WHERE id='7ff3433f-df92-491a-b502-85797607d514'));
  RAISE EXCEPTION 'TESTS %', r;
END $$;
