# Implantação do Hot Path V3 + insights que não se repetem

Duas frentes: (A) aplicar exatamente o que já está versionado no GitHub, sem redesenhar nada; (B) corrigir a repetição de insights já respondidos.

## Estado atual verificado

- `supabase/migrations/20260821205200_nino_home_hotpath_v3.sql` existe no repositório (405 linhas) e **ainda não foi aplicado**: no banco não existem `my_nino_home_context` nem `my_financial_home_snapshot` (só `my_nino_diagnosis_context` / `nino_diagnosis_context_for_user`).
- Frontend já está sincronizado com o V3 (Home usa `useNinoHomeContext`, sem `processCategoryQueue`, Realtime sem `transactions`). Nada será alterado nele.
- Repetição de insights, causa confirmada no banco:
  - a RPC `my_nino_item_feedback` só muda o status quando o feedback é `dismiss`. `useful` e `not_useful` apenas gravam o registro, então o item continua "active" e volta a ser servido.
  - a RPC `my_nino_intelligence_context` (aba de insights) ordena somente por `priority`/`updated_at` e não olha exposições ou feedback anterior — nem intercala tipos.
  - na Home a supressão é apenas `localStorage` do dia e do aparelho (`nino-answered-<dia>`), por isso amanhã ou em outro device a mesma leitura reaparece.
  - evidência: a leitura "Seus gastos de consumo superam a renda em R$ 4.115,59" recebeu `not_useful` em 17/08, 18/08 e 20/08 e a situação segue `active`; várias leituras marcadas como `useful` reapareceram em dias seguintes.

## Parte A — Implantação V3 (sem mudança de arquitetura)

1. Aplicar a migration `20260821205200_nino_home_hotpath_v3.sql` tal como está versionada.
2. Validar objetivamente:
   - `my_nino_home_context()` existe e responde para usuário autenticado (payload enxuto, sem timeline completo/closings/histórico);
   - `my_financial_home_snapshot(...)` existe e serve `financial_current_snapshots` (período corrente válido), `financial_derived_cache` (períodos já calculados) e só recomputa quando necessário;
   - a otimização do timeline do diagnóstico completo (consulta limitada/indexada por usuário) está presente na função criada;
   - nenhuma migration com erro; nada das otimizações anteriores revertido.
3. Rodar o guard `scripts/check-performance-architecture.mjs` como prova de que as invariantes de performance continuam válidas.
4. Reportar exatamente a lista de 6 pontos pedida.

## Parte B — Insight respondido não volta

Regra: uma leitura interagida sai da vez; entram novas, alternando tipos.

1. **Cooldown no servidor (fonte única)**: nova migration que estende `my_nino_item_feedback` — além de `dismiss`, os feedbacks `useful` e `not_useful` passam a marcar o item como respondido e a gravar um cooldown (`useful`: some por alguns dias; `not_useful`: cooldown mais longo, junto do sinal negativo já enviado ao aprendizado). Sem apagar histórico: o item muda de estado com auditoria, como hoje.
2. **Leitura já filtra o respondido**: `my_nino_intelligence_context` e o contexto da Home (`nino_home_context_for_user`, criado na Parte A) passam a excluir itens/situações em cooldown e a ordenar com desempate por "menos exposto recentemente", em vez de sempre o mesmo topo.
3. **Intercalar tipos**: na montagem da lista, evitar dois itens seguidos do mesmo `kind`/tópico, mantendo a prioridade de severidade crítica na primeira posição.
4. **Home**: o `localStorage` deixa de ser a única memória — vira só cache otimista sobre a resposta do servidor, então a supressão passa a valer entre dias e aparelhos.
5. Fórmulas financeiras, cálculo de severidade e regras de negócio permanecem intocados: muda só quem é elegível a aparecer e em que ordem.

## Notas técnicas

- Parte B é uma migration nova (não altera o arquivo do V3) mais ajuste mínimo nos componentes de leitura da Home/aba de insights.
- Cooldowns ficam derivados de `nino_item_exposures` + `financial_situation_feedback`, que já registram tudo; nenhuma tabela nova é obrigatória.
- Situações críticas continuam podendo retornar quando o valor material mudar, para não esconder risco real.
