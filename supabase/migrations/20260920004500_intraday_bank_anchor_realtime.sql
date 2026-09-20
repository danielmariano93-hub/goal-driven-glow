-- bank_cash_truth.v2 — preserve the exact instant represented by a bank anchor.
-- A date-only anchor incorrectly swallowed live transactions entered later on the
-- same calendar day. `anchor_observed_at` lets the runtime distinguish what was
-- already inside the statement from activity that happened after it.

begin;

alter table public.account_balance_snapshots
  add column if not exists anchor_observed_at timestamptz;

comment on column public.account_balance_snapshots.anchor_observed_at is
  'Exact instant represented by a bank-confirmed balance, when known. Same-day live transactions after this instant must affect current cash.';

create or replace function public.infer_bank_anchor_observed_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_text text;
  v_stamp text;
begin
  if new.anchor_observed_at is not null or coalesce(new.anchor_kind, '') <> 'bank_confirmed' then
    return new;
  end if;

  v_text := coalesce(new.provenance->>'source', '');
  v_stamp := substring(lower(v_text) from 'emitido[[:space:]]+([0-9]{2}/[0-9]{2}/[0-9]{4}[[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})');

  if v_stamp is null and new.source_document_id is not null then
    select substring(lower(coalesce(d.raw_text, '')) from 'emitido[[:space:]]+([0-9]{2}/[0-9]{2}/[0-9]{4}[[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})')
      into v_stamp
      from public.document_imports d
     where d.id = new.source_document_id;
  end if;

  if v_stamp is not null then
    begin
      new.anchor_observed_at :=
        to_timestamp(v_stamp, 'DD/MM/YYYY HH24:MI:SS')::timestamp
        at time zone 'America/Sao_Paulo';
    exception when others then
      new.anchor_observed_at := null;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_infer_bank_anchor_observed_at on public.account_balance_snapshots;
create trigger trg_infer_bank_anchor_observed_at
before insert or update of anchor_kind, provenance, source_document_id, anchor_observed_at
on public.account_balance_snapshots
for each row execute function public.infer_bank_anchor_observed_at();

-- Backfill only anchors whose source explicitly states the statement issue time.
-- Unknown times remain NULL and retain the conservative date-only behavior.
update public.account_balance_snapshots s
   set anchor_observed_at =
     to_timestamp(
       substring(lower(coalesce(s.provenance->>'source', '')) from 'emitido[[:space:]]+([0-9]{2}/[0-9]{2}/[0-9]{4}[[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})'),
       'DD/MM/YYYY HH24:MI:SS'
     )::timestamp at time zone 'America/Sao_Paulo'
 where s.anchor_observed_at is null
   and s.anchor_kind = 'bank_confirmed'
   and lower(coalesce(s.provenance->>'source', '')) ~ 'emitido[[:space:]]+[0-9]{2}/[0-9]{2}/[0-9]{4}[[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2}';

commit;
