# Fechamento 100% — Performance estrutural + Consultoria patrimonial E2E + Evidência

Aceito a auditoria. Confirmei no código e no schema de produção os três pontos mais graves:

- `src/lib/hooks/useFinancialSnapshot.ts` (linha 78) ainda chama `useAllTransactions()` e calcula `computeFinancialSnapshot` no cliente — a Home continua escalando com o tamanho da vida financeira. O mesmo vale para `useFinancialPerformance`, `usePerformanceDetail`, `Metas`, `MetaDetalhe`, `MetaCategoriaDetalhe`, `Cartoes`.
- `analyze_wealth_opportunity` (engineTools, linha 716) consulta `accounts.initial_balance` e `accounts.archived_at`. A tabela real tem `opening_balance` e não tem `archived_at`; o erro é engolido por `((accounts as any)?.data ?? [])` e o patrimônio sai incompleto. Além disso recalcula patrimônio em vez de consumir a verdade canônica.
- `agent_runs` tem só `tokens_in`, `tokens_out`, `latency_ms` — nenhuma decomposição por estágio/bloco de token.

## Bloco 1 — P0 imediato: Wealth Opportunity confiável

- Remover o cálculo local de patrimônio da capability. Ela passa a consumir a verdade canônica (mesma fonte de `get_net_worth`), extraída para um helper único `resolveCanonicalNetWorth(ctx)` usado pelas duas.
- Falha ao ler patrimônio deixa de ser silenciosa: a tool retorna degradação honesta ("não consegui confirmar seu patrimônio agora") em vez de responder com patrimônio parcial. Sem `?? []` mascarando `error`.
- Contrafactual temporal real: o aporte de cada mês passa a ser o excesso daquele mês (`max(0, flex_mes − baseline) × share`), capitalizado pelo tempo restante até o fim do período. Sem rendimento o total fecha igual; com rendimento passa a estar correto.
- `flexibleByCategory` passa a ser fornecido pela tool (série mensal por categoria flexível), destravando os drivers "R$ 250 de Lazer, R$ 210 de Transporte".

## Bloco 2 — Mês aberto e extraordinários na inteligência longitudinal

- Série mensal ganha `is_open_month` e `days_elapsed`. Tendência, slope, change-point e baseline usam apenas meses fechados; o mês corrente aparece como ponto informativo com equivalente MTD, nunca como evidência de melhora.
- Normalização de extraordinários: renda e despesa atípicas (fora de ~2,5 desvios/MAD da própria série, 13º/PLR/férias, gasto único não recorrente) são separadas em `extraordinary_income` / `extraordinary_expense` e excluídas da baseline e das tendências, ficando visíveis como anotação.

## Bloco 3 — Performance estrutural das telas (fim do histórico completo no cliente)

- Novas RPCs de leitura derivada no banco (`SECURITY DEFINER`, escopo `auth.uid()`), com os mesmos contratos dos motores atuais: snapshot financeiro do período, performance do período e agregados por categoria.
- Materialização: tabelas de fatos derivadas por usuário/mês, atualizadas por trigger de escrita no ledger (marcação de mês sujo) e por job de reprocessamento em lote — com trava de execução única, teto por rodada e marcação idempotente de progresso.
- `useFinancialSnapshot`, `useFinancialPerformance` e `usePerformanceDetail` passam a consumir a RPC. `useAllTransactions` sai da Home e das telas de metas/cartões; transações cruas ficam apenas em Extrato e nas telas que listam lançamentos, sempre por período/paginação.
- Invalidação: performance snapshots deixam de ser invalidados em toda escrita; só quando o mês afetado é o mês do snapshot.

## Bloco 4 — Wealth → plano (capability composta `financial_plan.v1`)

Fluxo determinístico único: longitudinal → capacidade sustentável de poupança → wealth opportunity → meta desejada → `goal_strategy.v1` → passos e alternativas. A LLM só narra; nada de ligação improvisada. Registrada no router/registry para app e WhatsApp.

## Bloco 5 — Financial Profile Learning (perfil persistente)

Nova tabela `financial_profile_snapshots` (por usuário, versionada): baseline flexível, capacidade histórica de poupança, volatilidade, savings rate, categorias recorrentes de deterioração, propensão a parcelar, padrão de recuperação, regime atual e último change-point. Escrita pelo job de reprocessamento e lida pelas capabilities (pergunta passa a ser "consulta o perfil", não "recalcula tudo").

## Bloco 6 — Observabilidade exigida

- Migration em `agent_runs`: `routing_ms`, `history_ms`, `memory_ms`, `financial_context_ms`, `planning_ms`, `tool_ms`, `llm_ms`, `validation_ms`, `persistence_ms`, `tokens_system`, `tokens_tools`, `tokens_memory`, `tokens_history`, `tokens_financial`, `tokens_total`.
- `Observability.ts` mede cada estágio e cada bloco de contexto (via `estimateTokens`) e persiste a decomposição em todo turno.
- Painel admin do agente exibe P50/P90 por estágio e a divisão de tokens.
- Correção do `ContextBudget`: o fallback final passa a cortar por remoção de campos de menor prioridade, nunca `slice` no meio do JSON.

## Bloco 7 — Evidência antes/depois

- Benchmark reproduzível com 100/1k/5k/10k/20k transações sintéticas medindo payload, tempo de query e tempo de render da Home, antes e depois.
- Testes E2E: Home autenticada (contagem de linhas trazidas ao cliente) e turno completo do assessor exercitando `financial_plan.v1`, com verificação da decomposição gravada em `agent_runs`.
- Matriz final de latência/tokens/payload publicada em `docs/`, com números medidos — sem alegação de ganho não comprovada.

## Detalhes técnicos

- Nada de nova Edge Function para o job: reprocessamento entra como função de banco agendada + hop bounded, com trava de lease, teto de itens e guarda de estado pausado (circuit breaker em 402/403).
- Toda RPC nova recebe `GRANT` para `authenticated`/`service_role` na mesma migration, RLS via `auth.uid()`.
- Motores continuam espelhados para as Edge Functions por `scripts/sync-finance-core.mjs`; qualquer divergência App/Edge é bug bloqueante.
- Ordem de execução: Bloco 1 e 6 (P0 e medição) → Bloco 2 → Bloco 3 → Blocos 4 e 5 → Bloco 7.
