# Correção do caminho analítico novo: por que a resposta não mudou

## Diagnóstico confirmado agora (com leituras reais)

- `transactions` **não tem** a coluna `transfer_direction`. Consultei o schema: existem `transfer_group_id`, `competence_date`, `settles_card_id`, `movement_kind`, `posted_at` — `transfer_direction` não. E ela só aparece em `supabase/functions/_shared/agent/goalPerformanceTool.ts` (fora de uma migration antiga e do arquivo de tipos). Logo o `SELECT` da ferramenta nova falha no PostgREST.
- `CompositeAnalysis.ts` retorna `null` quando a ferramenta falha (`if (!exec?.ok || !exec.result) return null;`), e o `AgentCore` segue para o fluxo antigo. Ou seja: plano reconhecido → motor quebrado → **mesma resposta antiga**. A causa raiz apontada está correta.
- O loader novo carrega um `TransactionRow` incompleto: sem `transfer_group_id` e `settles_card_id`, que `isRealMonthlyMovement` usa para excluir transferência e pagamento de fatura.
- Categorias: hoje o loader novo faz `.eq("user_id", userId)`. Existem **20 categorias globais** (`user_id IS NULL`) contra 14 pessoais no banco, e as outras ferramentas já usam `.or(user_id.eq.<id>,user_id.is.null)`. Portanto nomes de categoria de meta podem sair vazios/ausentes.
- Competência: tanto `categorySpendInPeriod` quanto `evaluateCategoryGoal` recortam o período por `occurred_at`. Compra de cartão da fatura de agosto feita em 30/07 cai em julho — a inconsistência que já corrigimos em outros lugares.

## O que vou implementar

### Fase 1 — Tornar o caminho novo operante (cirúrgico)
1. Remover `transfer_direction` e substituir o `TX_SELECT` artesanal por um **conjunto canônico único** de colunas de lançamento, reutilizado pelas ferramentas financeiras (base: a lista já espelhada em `_shared/derived/txColumns.ts`), incluindo `transfer_group_id`, `settles_card_id`, `movement_kind`, `competence_date`, `posted_at`, `posted_at_source`, `refund_of_transaction_id`.
2. Carregar categorias pessoais **e** globais (`user_id.is.null`), com o mesmo filtro de arquivadas usado nas outras tools.

### Fase 2 — Fim do fallback semântico silencioso
3. Quando o `AnalyticalQueryPlanner` reconhece um plano e o motor obrigatório falha: uma tentativa determinística de recuperação (retry do `runTool`); se falhar de novo, o Nino responde honestamente ("não consegui cruzar suas metas com o histórico agora") **sem** cair numa análise diferente. Nunca mais um relatório genérico no lugar da pergunta composta.
4. Telemetria explícita no run do agente: `composite_plan_matched`, `goal_performance_tool_started`, `goal_performance_tool_failed`, `fallback_reason`, `final_path` — para o painel admin mostrar por qual caminho a resposta saiu.

### Fase 3 — Competência única para avaliação mensal
5. Criar função canônica de competência de relatório em `finance-core` (cartão/fatura → `competence_date`; conta/débito → `occurred_at`), espelhada para as edge functions.
6. Passar a usá-la no recorte de período de: meta por categoria, comparação por categoria, avaliação composta e fechamento mensal. O extrato/histórico continua exibindo `occurred_at` — são duas verdades distintas, documentadas.

### Fase 4 — Testes que pegariam esse erro
7. Teste de integração do `goalPerformanceTool` com um cliente falso que **valida cada coluna pedida contra o schema real** (tipos gerados): coluna inexistente falha o teste.
8. Guarda de CI que varre todo `SELECT` sobre `transactions` no repositório e falha se qualquer campo não existir no schema.
9. Golden E2E com a sua mensagem exata: mensagem → AgentCore → planner → ToolRuntime → motor → renderer, verificando que a resposta traz todas as metas, cada meta cruzada com o histórico, agregado **só** dessas categorias e conclusão.
10. Testes de competência: compra de cartão em 30/07 na fatura de agosto conta em agosto na avaliação e não aparece duas vezes.

## Notas técnicas

- Nenhuma fórmula nova: o motor `goal_performance_assessment.v1` continua compondo `evaluateCategoryGoal` + soma canônica; a mudança é loader, contrato de colunas, regra de data e política de fallback.
- Paridade app × edge continua garantida por `scripts/sync-finance-core.mjs` (a suíte de paridade falha se divergir).
- Sem publicação em produção sem sua autorização explícita.
