-- home_realtime.v3 — single read path + deployment-scoped cache hardening
--
-- 1) Remove o RPC financeiro antigo da Home. O cliente passa a ler apenas a
--    Edge Function `home-snapshot`, que é a única porta de cálculo canônico.
-- 2) Corrige timestamps de âncora bancária que não pertencem ao mesmo dia do
--    saldo representado.
-- 3) Limpa caches derivados do contrato antigo; o runtime novo grava caches
--    namespaced por DENO_DEPLOYMENT_ID (`perf_derived.v2`).
-- 4) Invalida a versão semântica para todos os usuários e enfileira refresh.

begin;

-- O hot path SQL financeiro virou uma segunda fonte de frescor e foi
-- descontinuado. Frontends antigos já possuem fallback para a Edge Function.
drop function if exists public.my_financial_home_snapshot(date, date, date);

create or replace function public.infer_bank_anchor_observed_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_text text;
  v_stamp text;
  v_observed timestamptz;
begin
  if coalesce(new.anchor_kind, '') <> 'bank_confirmed' then
    return new;
  end if;

  -- Timestamp explícito só é aceito se representar o MESMO dia local do saldo.
  if new.anchor_observed_at is not null then
    if (new.anchor_observed_at at time zone 'America/Sao_Paulo')::date = new.balance_date then
      return new;
    end if;
    new.anchor_observed_at := null;
  end if;

  v_text := coalesce(new.provenance->>'source', '');
  v_stamp := substring(
    lower(v_text)
    from 'emitido[[:space:]]+([0-9]{2}/[0-9]{2}/[0-9]{4}[[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})'
  );

  if v_stamp is null and new.source_document_id is not null then
    select substring(
      lower(coalesce(d.raw_text, ''))
      from 'emitido[[:space:]]+([0-9]{2}/[0-9]{2}/[0-9]{4}[[:space:]]+[0-9]{2}:[0-9]{2}:[0-9]{2})'
    )
      into v_stamp
      from public.document_imports d
     where d.id = new.source_document_id;
  end if;

  if v_stamp is not null then
    begin
      v_observed :=
        to_timestamp(v_stamp, 'DD/MM/YYYY HH24:MI:SS')::timestamp
        at time zone 'America/Sao_Paulo';

      -- Um extrato emitido em 19/09 não pode dar horário intraday a uma âncora
      -- de 27/08. Nesse caso a âncora continua válida, mas apenas date-only.
      if (v_observed at time zone 'America/Sao_Paulo')::date = new.balance_date then
        new.anchor_observed_at := v_observed;
      else
        new.anchor_observed_at := null;
      end if;
    exception when others then
      new.anchor_observed_at := null;
    end;
  end if;

  return new;
end;
$$;

-- Revalida dados já persistidos. O trigger acima impede que a própria correção
-- reintroduza um timestamp de outro dia ao processar o UPDATE.
update public.account_balance_snapshots
   set anchor_observed_at = null
 where anchor_kind = 'bank_confirmed'
   and anchor_observed_at is not null
   and (anchor_observed_at at time zone 'America/Sao_Paulo')::date <> balance_date;

-- Cache antigo não deve sobreviver ao runtime deployment-scoped.
delete from public.financial_derived_cache
 where contract_version is distinct from 'perf_derived.v2'
    or cache_key not like 'edge:%|%';

-- A mudança de arquitetura é semântica: força clientes Realtime a reler e
-- impede qualquer snapshot anterior de permanecer invisivelmente vigente.
update public.financial_ledger_versions
   set version = version + 1,
       updated_at = now();

-- O worker pré-aquece novamente os snapshots materializados para observabilidade
-- e consumidores internos; a Home não depende mais desta tabela para leitura.
select public.finance_snapshot_refresh_enqueue_all();

commit;
