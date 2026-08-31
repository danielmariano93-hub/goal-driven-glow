# P0: o Nino executou o caminho errado — escopo, período e ferramenta

## O que eu confirmei agora (leituras reais, não hipótese)

1. **O flag novo está ligado.** `agent_runtime_flags` não tem a linha `composite_analysis_v1`, e o default em `FeatureFlags.ts` é `true`. Ou seja: o caminho novo **não** foi desligado por flag.
2. **O run real do turno existe e é o antigo.** Último run (31/08 12:42 UTC): `path=llm`, `capability=financial_comparison`, `tools_used=[compare_financial_metric, get_financial_snapshot, assess_financial_performance]`, `llm_calls=2`. Nenhuma menção a `assess_goal_performance`. O turno anterior (12:41) foi `deterministic_tool / goals_overview` com `get_goals_overview` — também fora do caminho composto.
3. **A causa raiz do desvio está no planner, não em deploy.** `AnalyticalQueryPlanner.resolveAnalyticalPlan` só devolve plano se `domains.includes("goals")`, e o domínio `goals` exige a palavra meta/teto/orçamento/limite **no texto do turno atual**. Sua frase falava "essas categorias… mesmo período do mês anterior" — sem a palavra "meta". Resultado: `plan = null` → fluxo antigo → escopo global.
4. **A herança de escopo estava vazia.** `AgentCore` lê `memory.last_analysis.scope`, e esse campo só é gravado quando o caminho composto **responde**. O turno anterior foi respondido pelo fluxo antigo, então "essas categorias" não tinha nenhuma identidade para herdar.
5. **Os R$ 36.550,23 vêm de janela deslizante, não de julho × junho calendário.** Em `engineTools.compare_financial_metric`, quando `from/to` vêm explícitos o modo vira `CUSTOM_PERIOD`, e a comparação usa a janela imediatamente anterior de mesmo tamanho (31 dias antes de 01/07 = 31/05–30/06). Nada impede isso hoje.
6. **Nada impede conflito de evidência.** No mesmo turno duas ferramentas responderam perguntas diferentes (uma jul × jun, outra ago × jul) e a LLM escolheu o headline errado. Não existe camada que reconcilie ou rejeite evidência com período divergente.

## Correções

### Fase 1 — O planner deixa de perder o assunto (causa raiz do turno)
- Domínio `goals` passa a ser reconhecido também por **herança**: se o escopo anterior é de categorias com meta e o texto usa referência anafórica ("essas categorias", "nelas", "essas mesmas"), o plano composto é montado sem exigir a palavra "meta".
- Toda leitura analítica de categorias/gastos que o Nino responde (inclusive `goals_overview` pelo caminho antigo) passa a **gravar** `last_analysis.scope` com os IDs e rótulos das categorias envolvidas. Sem isso a anáfora nasce órfã.
- Cobertura do planner ampliada para "comparação de categorias com período anterior" mesmo quando a pergunta não cita metas: mesmo motor canônico, escopo travado nas categorias do contexto.

### Fase 2 — Dois gates duros (mesmo se o planner falhar de novo)
- **Gate de escopo herdado:** escopo do usuário = categorias concretas + resultado de ferramenta com `scope=overall`/`subject_id=null` → evidência **rejeitada**, nunca chega à resposta.
- **Gate de conflito de período:** duas ou mais evidências no mesmo turno com períodos diferentes → a LLM não escolhe. O runtime mantém a evidência cujo período casa com o plano/período do turno e descarta as demais; se nenhuma casar, resposta honesta de que não consegui cruzar agora.

### Fase 3 — Comparação de período com regra explícita
- `compare_financial_metric` deixa de inferir janela deslizante silenciosamente: quando `from/to` são um mês calendário, o período anterior é o **mês calendário anterior no mesmo recorte de dias**; janela deslizante só quando pedida explicitamente. O modo usado entra no resultado (`comparison_basis`) e é auditável.
- Recorte por `reportingCompetenceDate` (cartão = competência da fatura), consistente com o resto do produto.

### Fase 4 — Provar em runtime e travar por teste
- Telemetria do caminho analítico persistida no run (`composite_plan_matched`, `final_path`, `fallback_reason`, escopo herdado, períodos usados), para que este diagnóstico passe a ser uma consulta e não uma investigação.
- Golden E2E com a sequência exata de dois turnos: overview das metas → "comparando essas categorias com o mesmo período do mês anterior". Esperado: `assess_goal_performance`, escopo = as 4 categorias com meta, agregado só delas, agosto × julho, conclusão de melhora com Alimentação como exceção.
- Testes dos dois gates: evidência `overall` sob escopo herdado é rejeitada; evidência jul × jun em turno de ago × jul é descartada.
- Teste da nova base de comparação (mês calendário anterior, não janela deslizante).

## Notas técnicas
- Nenhum número novo é calculado por LLM: motores canônicos continuam sendo a única fonte.
- Arquivos no centro da mudança: `core/AnalyticalQueryPlanner.ts`, `core/ScopeResolver.ts`, `core/AnalysisGates.ts`, `core/CompositeAnalysis.ts`, `core/AgentCore.ts`, `core/ConversationMemory.ts`, `engineTools.ts` (+ espelho `finance-core` via `scripts/sync-finance-core.mjs`).
- Depois de aprovado e verde nos testes, faço o deploy das edge functions afetadas **somente com sua autorização explícita**, e confirmo pelo run seguinte que `final_path=composite_answered`.
