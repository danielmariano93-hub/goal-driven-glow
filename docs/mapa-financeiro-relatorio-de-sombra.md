# Mapa Financeiro: relatório de sombra (legado × Mapa)

Objetivo (spec, seção 10): antes de remover o legado (hábitos v2/v3, `behavior_observed_*`), o Mapa roda em paralelo e cada divergência com o legado precisa ser **explicada** (diferença de construto) ou **corrigida** (defeito). Critério da fase 5: **2 semanas sem divergência não explicada**.

**Estado em 16/10/2026: critério NÃO cumprido.** Só existe uma comparação (conta do dono, semana de 12/10), e as leituras do Mapa só começam a ser gravadas em `map_readings` depois deste PR (o job semanal `mapa-weekly` grava às segundas, 06:45 em São Paulo). O legado só pode ser removido depois de duas semanas de leituras e da liberação para outras contas.

## Como gerar a comparação (rodar por semana)

```sql
create or replace function pg_temp.dim_pillar(d text) returns text language sql immutable as $$
  select case d when 'security' then 'seguranca' when 'debt' then 'dividas' when 'wealth' then 'futuro'
                when 'control' then 'execucao' when 'planning' then 'planejamento' else null end $$;
select s.week_start, k.key as dimensao_legado, (s.dimensions->k.key->>'score')::numeric as nota_legado,
       s.dimensions->k.key->>'confidence' as confianca_legado, r.indicator_id, r.value, r.status
from public.behavior_observed_snapshots s
cross join lateral jsonb_object_keys(s.dimensions) as k(key)
left join public.map_readings r on r.user_id = s.user_id and r.period_kind = 'semanal' and r.as_of = s.week_start
     and split_part(r.indicator_id, '.', 1) = pg_temp.dim_pillar(k.key)
where s.user_id = :user_id and s.week_start = :segunda
order by 2, 5;
```

## Primeira comparação (conta do dono, semana de 12/10, dados reais do legado; Mapa com a leitura calculada no smoke da fase 4)

| Legado (nota 0–10) | Mapa | Divergência | Explicação |
|---|---|---|---|
| Segurança 1,3 (meses cobertos 0,5) | `seguranca.meses_cobertos` ≈ 0,1 mês, "precisa de cuidado" (base: gastos totais) | mesmo sentido, magnitude diferente | o legado divide pelo gasto **projetado do mês**; o Mapa pelo gasto **típico de meses fechados** (P-01). Esperado. |
| Dívidas 3,3 (carga 1,4; trajetória 6,3) | `dividas.comprometimento_renda` ≈ 15% "tudo certo"; `dividas.trajetoria` favorável; custo e perfil **sem dados** | **construto diferente** | o legado mede dívida ÷ patrimônio; o Mapa mede parcela ÷ renda. As duas leituras podem divergir sem que nenhuma esteja errada. Custo/perfil dependem da captura de taxa e tipo. |
| Controle 1,8 (0 metas mensais cumpridas) | `execucao.aderencia` baixa ("atenção") | sem divergência | mesma fonte (`goalHistory`). |
| Planejamento 5,0 | `planejamento.viabilidade` **sem dados** (essenciais não confirmados) | indicador sem dado | o Mapa não chuta: pede a marcação de essenciais. |
| Patrimônio (Wealth) sem nota | `futuro.patrimonio_liquido` e `futuro.variacao_mes` com valor | Mapa tem mais informação | usa a ponte patrimonial. |
| Consciência 7,0 · Consistência 8,4 · Calma 3,8 | sem equivalente | **removidos de propósito** | frequência de uso/check-in não é hábito financeiro (P-03). Calma vira o CFPB, em "Bem-estar percebido". |

Nenhuma divergência **não explicada** nesta primeira comparação, mas uma comparação não é o critério.

## Saída do legado (quando o critério for cumprido)

1. Liberar `mapa_access` para mais contas (decisão do dono do produto).
2. Duas semanas de leituras sem divergência não explicada (query acima) e taxa de falha do `mapa-weekly` ≈ 0.
3. Congelar `behavior_observed_snapshots` e `behavioral_assessments` (somente leitura) e desligar o job `behavior-observed-weekly`.
4. Remover `HabitsV2`, `EmocoesLegacy`, os motores `behaviorObservedV2/V3`, a flag `habits_v2_access` e as tabelas de experimentos da UI.
5. **Rollback** até lá: desligar `mapa_access` devolve a conta para a experiência anterior, sem perda.
