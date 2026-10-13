-- Linha do tempo de importações do assessor: todos os documentos recentes do usuário, com o
-- balanço dos itens (registrados / ignorados / aguardando revisão) numa única leitura.
-- SECURITY INVOKER: a RLS das tabelas continua valendo e o filtro é por auth.uid().
-- (Aplicada em produção com DROP prévio: o tipo de retorno ganhou `registered`.)
create or replace function public.assistant_import_timeline(p_days int default 30)
returns table (
  id uuid, source text, status text, document_kind text, error text,
  created_at timestamptz, updated_at timestamptz, statement_bank text,
  period_start date, period_end date, counters jsonb,
  total int, confirmed int, ignored int, pending int, registered int
)
language sql stable security invoker set search_path = public as $$
  select d.id, d.source, d.status, d.document_kind, d.error, d.created_at, d.updated_at, d.statement_bank,
         d.period_start, d.period_end, d.counters,
         count(e.id)::int,
         (count(*) filter (where e.status = 'confirmed'))::int,
         (count(*) filter (where e.status = 'ignored'))::int,
         (count(*) filter (where e.status in ('needs_review', 'duplicate_suspect') and e.transaction_id is null))::int,
         (select count(*)::int from public.transactions t where t.source_document_id = d.id and t.user_id = d.user_id and t.status <> 'superseded')
    from public.document_imports d
    left join public.extracted_items e on e.document_id = d.id
   where d.user_id = auth.uid()
     and d.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90))
     and d.status <> 'canceled'
   group by d.id
   order by d.created_at desc
   limit 40
$$;

revoke all on function public.assistant_import_timeline(int) from public, anon;
grant execute on function public.assistant_import_timeline(int) to authenticated;
