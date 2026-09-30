-- Diagnóstico de padrão comportamental sem jargão interno ("amostras",
-- "confiança de 63%"): esse texto chega às notificações do Nino.
do $mig$
declare
  d text := pg_get_functiondef('public.nino_evaluate_financial_situations'::regproc);
  old_text text := $q$'O comportamento apareceu em ' || r.sample_size || ' amostras, com confiança de '
        || public.nino_diag_pct(r.confidence*100) || '.'$q$;
begin
  if position(old_text in d) = 0 then
    raise notice 'nino_evaluate_financial_situations: texto antigo não encontrado, nada a fazer';
    return;
  end if;
  execute replace(d, old_text,
    $q$'Isso se repetiu ' || r.sample_size || ' vezes no seu histórico recente.'$q$);
end
$mig$;

update public.financial_situations
   set cause_summary = regexp_replace(cause_summary,
         'O comportamento apareceu em (\d+) amostras, com confiança de [^.]*\.',
         'Isso se repetiu \1 vezes no seu histórico recente.')
 where cause_summary ~ 'amostras, com confiança de';
