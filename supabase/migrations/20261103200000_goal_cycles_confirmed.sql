-- Histórico de metas importado em lote (source = 'backfill', sem meta por trás): o usuário confirma se aquele mês teve meta.
--   NULL  = ainda não confirmado (aparece como "?" no placar e fica FORA dos totais)
--   true  = tinha meta (entra nos cálculos)
--   false = não tinha (some dos cálculos)
-- Aditivo e reversível (DROP COLUMN). A RLS existente (`csgc_owner_all`) já limita a escrita ao dono.
alter table public.category_spending_goal_cycles
  add column if not exists confirmed boolean;
comment on column public.category_spending_goal_cycles.confirmed is
  'Confirmação do usuário para meses importados (backfill): true = tinha meta, false = não tinha, null = não confirmado.';
