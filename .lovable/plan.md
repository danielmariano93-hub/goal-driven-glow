# Correção P0 — o Nino respondeu certo e o validador jogou a resposta no lixo

## Causa raiz (confirmada no run real)

Run real do incidente: `7706f860-31d9-4b4a-aeb6-90b3141ab539`, usuário `088920ce-…9214`, `2026-09-02 11:03:59Z` (08:03 São Paulo), pergunta "Quais categorias eu tenho gastado mais nos últimos 90 dias?".

O caminho semântico funcionou por completo:

- `semantic_status = executable`, `executed_by = semantic_query_executor`
- IR: `intent=analyze`, 1 query `q1.rank_categories_by_expense`, período `2026-06-05 → 2026-09-02` (exato)
- engine mapeado e executado: `analyze_spending` — `ok = true`, 649 ms (registrado em `agent_tool_calls`)
- Completeness `complete`, Grounding `ok`, 26 claims
- `action_planner_used_for_tool_choice = false`

Ou seja: nada da arquitetura v3 falhou, e as flags v3 já estão `enabled` com `rollout_percent = 100` em `agent_runtime_flags`.

O que quebrou foi a **última milha**: o `capability` legado classificou a frase como `recent_transactions`, cujo `required_tool` é `list_recent_transactions`. O `AgentCore` passa `requiredTool: capability.required_tool` ao `ResponseValidator` mesmo quando a autoridade do turno foi semântica. Como `list_recent_transactions` nunca rodou (nem deveria), o validador acusou `required_tool_missing` e substituiu a resposta correta por "Não consegui consultar a fonte financeira necessária…".

Contrato violado: com `semantic_status = executable`, quem define a ferramenta obrigatória do turno é o mapeamento semântico, não o roteador legado.

## O que será corrigido

1. **Ferramenta obrigatória segue a autoridade do turno.** Quando `semantic_status` for `executable`, o `requiredTool` do `ResponseValidator` passa a vir das engines mapeadas/executadas pelo `SemanticQueryExecutor`; o `required_tool` legado é descartado no turno. Se o executor rodou e teve sucesso, o gate passa; se falhou, o gate acusa a engine real que falhou.
2. **Capability reconciliada.** Com autoridade semântica, `metrics.capability`, `tool_scope` e o `capability` usado em rescue/telemetria refletem o mapeamento semântico (ex.: `financial_analysis` / `analyze_spending`), acabando com o `recent_transactions` fantasma no run.
3. **Erro observável em vez de mensagem genérica.** `required_tool_missing` passa a registrar a engine esperada, a engine executada, `ok/error/duration` e o `semantic_status` em `context_layers.semantic_ir.validator`, para que a próxima falha diga onde quebrou.
4. **Rescue não devolve escolha de ferramenta ao ActionPlanner.** Auditoria do bloco de rescue: quando `semantic_status` for `executable`, `clarification_required` ou `unsupported`, o rescue reexecuta deterministicamente a engine mapeada; só `compiler_failed` cai no legado. Qualquer caminho remanescente que reabra catálogo de tools sai.
5. **Fail-closed continua para WRITE.** `MUTATION_TOOLS` mantém o comportamento atual: a mudança só afeta ferramentas de leitura sob autoridade semântica.

## Verificação (runtime real, não mock)

- Redeploy atômico do lote de 10 funções de `DEPENDENTS.md` + bump de `AGENT_RUNTIME_VERSION`.
- Tabela real de `isEnabled(flag, user_id)` para as 7 flags v3 no seu usuário.
- Execução pelo runtime real (`agent-run`, mesmo caminho do chat) dos cenários: ranking 90 dias; gasto 30 dias; "e por cartão?"; categorias no Nubank; clarificação com mais de um cartão + retomada "Nubank"; "por que gastei mais este mês?"; filtro negativo (esperado `unsupported`); repair ("não foi isso que eu perguntei" / "eu queria por cartão").
- Regressão de WRITE: "gastei 50 no mercado hoje" → rascunho, "confirma" → recibo, "cancela" → cancelamento.
- Para cada cenário, leitura do `agent_runs.context_layers` real: `semantic_status`, engine, `tool ok`, gates, `action_planner_used_for_tool_choice`, `final_path`.
- Suíte automatizada + build.

## Relatório final

Tabela CENÁRIO | STATUS | ENGINE | SEMANTIC STATUS | FINAL PATH | RESULTADO, com o texto real devolvido pelo Nino em cada caso, mais causa raiz, correções, funções redeployadas, flags e riscos residuais.
