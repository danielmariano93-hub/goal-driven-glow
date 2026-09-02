# Nino Semantic IR v2 — aplicação do patch auditado

Aplicar `NINO_SEMANTIC_IR_V2_20260901.patch` como fonte de verdade, sem redesenho, sem simplificação e sem ativar nada em produção. O patch não pode ser aplicado com `git apply` neste ambiente (comando bloqueado), então cada hunk será reproduzido manualmente, arquivo por arquivo, preservando o conteúdo literal do patch.

## Arquivos novos (conteúdo literal do patch)

- `supabase/functions/_shared/agent/core/DialogueAct.ts` — dialogue act conservador multi-label (repair/clarification/write/conversational), `findRepairBaseQuery`, `repairEffectiveQuery`.
- `supabase/functions/_shared/agent/core/FinancialQueryIR.ts` — contrato do IR, `validateFinancialIR` (fail-closed: exatamente 1 query), `fastFinancialIR` (fast path covarde) e `withCanonicalPeriods`.
- `supabase/functions/_shared/agent/core/SemanticCompiler.ts` — compilação via function calling forçado (`emit_financial_query_ir`), temperatura 0, timeout 8s, sem nomes de tools no prompt, telemetria e registro no `ai_usage_ledger`.
- `supabase/functions/_shared/agent/core/IRCapabilityAdapter.ts` — única camada IR→capability/tool/tool_args, com regra "filtro não suportado = unsupported", `capabilityExistsForIR` e `isFalseCapabilityDenial`.
- `src/test/nino-semantic-ir-v2.test.ts` — golden tests do patch (90 dias, repair, `por cartão`, total, receita, saldo, negativos, rollout).
- `supabase/migrations/20260902030000_nino_semantic_ir_v2.sql` — colunas de rollout + registro do flag `semantic_ir_v1` desligado.

## Arquivos alterados

- `FeatureFlags.ts` — novo flag `semantic_ir_v1` (default `false`), leitura das colunas de rollout e `rolloutDecision` determinístico (piloto + percentual).
- `tools.ts` — `analyze_spending` composicional: `metric` (expense/income), `view` (total/rank/breakdown), `group_by` (category/card/account) e filtros `category`/`card`/`account`/`payment_method`, mantendo intactas as exclusões canônicas de consumo (transferência, aplicação, pagamento de fatura, cancelado) e a semântica atual de estorno via `buildRefundAttribution`/`behavioralMetricAmount`.
- `DeterministicAnswers.ts` — `formatSpendingAnalysis` (resposta determinística sem segunda chamada de LLM).
- `AgentCore.ts` — dialogue act antes do roteamento (repair restaura pergunta e período anteriores, e só herda período quando o turno atual não traz recorte novo), bloco do Semantic Compiler restrito a READ atrás do flag, override de capability apenas com mapping completo, soma de tokens/llm_calls/custo do compiler nas métricas, persistência do IR/dialogue act/filtros/mapped tools no trace e Capability Availability Guard com resgate pelo motor correto.
- `RuntimeContract.ts` — bump de `AGENT_RUNTIME_VERSION` (contrato analítico mudou; exigência do `DEPENDENTS.md`).

## Divergências já identificadas entre patch e código atual

1. `git apply` é proibido no ambiente: hunks serão reproduzidos manualmente, sem alteração de intenção.
2. `analyze_spending` hoje é a versão `analyze_spending.consumption.v3` com apenas `days/from/to/payment_method`. A evolução composicional será enxertada sobre essa implementação, preservando a definição canônica de consumo (nada de recálculo novo).
3. `agent_runtime_flags` hoje tem apenas `flag_name/enabled/description/updated_at` e nenhuma linha `semantic_ir_v1` — a migration cria as colunas de rollout e insere o flag desligado.
4. Alguns hunks do `AgentCore.ts` têm contexto reduzido no patch; a inserção será feita nos pontos equivalentes reais (após `buildTurnPlan`, antes de `metrics.capability`, no cálculo de tokens/custo e após o bloco de `EVIDENCE_CONFLICT_REPLY`).
5. Se algum tool citado pelo adapter tiver assinatura divergente, o mapping fica ausente (unsupported) em vez de executar consulta mais ampla.

## Rollout e segurança

- Migration termina com `enabled=false`, `rollout_percent=0`, `pilot_user_ids='{}'` — zero usuários no Semantic IR.
- Nenhum piloto será habilitado nesta entrega; os SQLs de piloto/expansão ficam comentados no arquivo.
- Pipeline de WRITE (parse → draft → confirmação → execução idempotente → recibo) permanece intocado; o compiler nem roda quando o dialogue act indica write.
- IntentResolver, roteadores legados e fallbacks permanecem como estão e continuam sendo o caminho para consultas não suportadas.

## Validação antes de declarar concluído

- Suíte completa de testes (`vitest run`) incluindo os novos golden tests.
- Build e typecheck.
- Validação dos golden cases: 90 dias → `analyze_spending` com `rank`/`category` e janela exata (nunca `list_recent_transactions`); repair preservando período; `por cartão` com `group_by=card` chegando aos `tool_args`; total; receita; saldo; negativos de repair; WRITE íntegro.
- Verificação por SQL de que `semantic_ir_v1` está OFF e sem pilotos após a migration.

Deploy das Edge Functions não faz parte desta entrega; será feito só com autorização explícita (lote completo do `DEPENDENTS.md`).

## Relatório final

Ao terminar, entrego os 12 itens pedidos: arquivos criados/alterados, migration, testes, build/typecheck, confirmação de flag OFF e sem pilotos, resultado dos golden cases, divergências, itens não implementados, riscos residuais e confirmação de que nenhum cálculo financeiro canônico foi substituído por LLM.
