-- Hábitos: o limite de hábitos ativos sobe de 5 para 10. Reescreve as duas funções que aplicam o limite,
-- trocando só a comparação (">= 5" vira ">= 10"), sem copiar o corpo delas. Idempotente: rodar de novo não muda nada.
do $$
declare
  r record;
  def text;
begin
  for r in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('hb_create_habit', 'hb_set_status')
  loop
    def := pg_get_functiondef(r.oid);
    if position(') >= 5 then' in def) > 0 then
      execute replace(def, ') >= 5 then', ') >= 10 then');
    end if;
  end loop;
end $$;
