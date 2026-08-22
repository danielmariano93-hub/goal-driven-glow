alter table public.agent_runs
  add column if not exists llm_calls integer not null default 0,
  add column if not exists tool_result_full_chars integer not null default 0,
  add column if not exists tool_result_llm_chars integer not null default 0,
  add column if not exists route_reason text,
  add column if not exists model_tier text;

comment on column public.agent_runs.llm_calls is 'nino_efficiency.v1: numero de chamadas de modelo no turno (0 = rota determinística).';
comment on column public.agent_runs.tool_result_full_chars is 'nino_efficiency.v1: tamanho bruto dos resultados de ferramenta no turno.';
comment on column public.agent_runs.tool_result_llm_chars is 'nino_efficiency.v1: tamanho efetivamente enviado ao modelo apos compressao.';

create index if not exists agent_runs_efficiency_idx on public.agent_runs (started_at desc, llm_calls);

alter table public.financial_feature_flags
  add column if not exists use_nino_efficiency_v1 boolean not null default true;