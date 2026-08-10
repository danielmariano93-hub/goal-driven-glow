-- Saneamento auditável `bank_cash_truth.v1` — conta Itaú 6c1cf814 / extrato a1481e01.
-- Idempotente: toda escrita é guardada por NOT EXISTS / status atual.
-- Nenhum DELETE. Nenhum lançamento de ajuste. Toda correção gera ledger_corrections.
-- Ids determinísticos das transações criadas: md5('sanit:'||<extracted_item_id>)::uuid

-- ============ 1. duplicidades de 03/08 (mantém a de proveniência bancária) ============
-- 33,00 | 34,55 | 66,00 | 100,00
INSERT INTO public.ledger_corrections(
  user_id, correction_kind, transaction_id, related_transaction_id, document_id, account_id,
  amount_before, amount_after, cash_impact, reason, evidence, snapshot_before, actor_id, contract_version)
SELECT t.user_id, 'supersede', t.id, s.keep_id, t.source_document_id, t.account_id,
       t.amount, t.amount,
       CASE WHEN t.type = 'income' THEN -t.amount ELSE t.amount END,
       s.reason,
       jsonb_build_object('contract','bank_cash_truth.v1','rule','keep_bank_provenance',
         'survivor_document', s.keep_id, 'duplicate_document', t.source_document_id),
       to_jsonb(t), t.user_id, 'bank_cash_truth.v1'
  FROM public.transactions t
  JOIN (VALUES
    ('038be068-0d03-4eac-a5aa-634da31a718a'::uuid,'bc7052de-42e1-4495-8f33-4a2cf9d97b78'::uuid,'99 R$33,00 03/08 duplicado: cópia inferida de 11b6dcde vs. linha com postagem bancária de 6e768b47'),
    ('4229162c-3041-4446-8091-f514fcac4a87'::uuid,'9d72b394-4914-4e9a-9871-593f0285cf70'::uuid,'99 R$34,55 03/08 duplicado: mantida a ocorrência com postagem bancária'),
    ('83a790f3-725a-4e6f-8068-c86e6da46077'::uuid,'60037a2b-6465-4d58-a0bf-e84512e737a0'::uuid,'99 R$66,00 03/08 duplicado: mantida a ocorrência com postagem bancária'),
    ('52fb9910-dbf0-4da4-9e2f-88cfa24db2dd'::uuid,'0472a63b-81ef-464f-b41c-2c42e9f193de'::uuid,'R$100,00 03/08: PAY Lazer (linha 19 de 11b6dcde) e Adega são a mesma ocorrência econômica; mantida a que tem postagem bancária em 03/08')
  ) AS s(dup_id, keep_id, reason) ON s.dup_id = t.id
 WHERE t.status = 'confirmed'
   AND NOT EXISTS (SELECT 1 FROM public.ledger_corrections lc
                    WHERE lc.transaction_id = t.id AND lc.correction_kind = 'supersede');

UPDATE public.transactions t
   SET status = 'superseded', superseded_by = s.keep_id,
       supersede_reason = s.reason, superseded_at = now(), updated_at = now()
  FROM (VALUES
    ('038be068-0d03-4eac-a5aa-634da31a718a'::uuid,'bc7052de-42e1-4495-8f33-4a2cf9d97b78'::uuid,'duplicidade 03/08 R$33,00 — mantida a postagem bancária'),
    ('4229162c-3041-4446-8091-f514fcac4a87'::uuid,'9d72b394-4914-4e9a-9871-593f0285cf70'::uuid,'duplicidade 03/08 R$34,55 — mantida a postagem bancária'),
    ('83a790f3-725a-4e6f-8068-c86e6da46077'::uuid,'60037a2b-6465-4d58-a0bf-e84512e737a0'::uuid,'duplicidade 03/08 R$66,00 — mantida a postagem bancária'),
    ('52fb9910-dbf0-4da4-9e2f-88cfa24db2dd'::uuid,'0472a63b-81ef-464f-b41c-2c42e9f193de'::uuid,'duplicidade 03/08 R$100,00 — mantida a postagem bancária (Adega/PAY Lazer)')
  ) AS s(dup_id, keep_id, reason)
 WHERE t.id = s.dup_id AND t.status = 'confirmed';

UPDATE public.extracted_items ei
   SET status = 'ignored', duplicate_resolution = 'supersede',
       duplicate_resolved_at = coalesce(duplicate_resolved_at, now()), updated_at = now()
 WHERE ei.transaction_id IN ('038be068-0d03-4eac-a5aa-634da31a718a','4229162c-3041-4446-8091-f514fcac4a87',
                             '83a790f3-725a-4e6f-8068-c86e6da46077','52fb9910-dbf0-4da4-9e2f-88cfa24db2dd')
   AND ei.status <> 'ignored';
