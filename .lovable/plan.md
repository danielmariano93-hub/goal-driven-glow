# Performance e latência — plano fechado (sem tocar em verdade contábil)

Escopo: exclusivamente performance/latência. Nenhuma fórmula financeira, categorização, conciliação, saldo, dedupe ou lançamento histórico muda. Motores canônicos continuam a única origem dos números.

## 1. Causas confirmadas (verificadas agora)

1. `src/lib/hooks/useFinancialSnapshot.ts` já chama a Edge Function `home-snapshot` e só usa `useAllTransactions({ enabled: useLocalFallback })` como rede de segurança. Porém:
   - o fallback dispara em qualquer erro da função (inclusive cold start/timeout), e aí o iPhone volta a baixar o histórico inteiro;
   - `home-snapshot` ainda faz `select` de **todas** as transações do usuário no servidor (`TX_COLUMNS`, sem filtro de período) e roda `computeFinancialSnapshot` a cada abertura, em 15 queries paralelas. Rápido hoje (1.856 transações no projeto), mas continua O(histórico) — só mudou de dispositivo.
2. Consumidores que **ainda** baixam o ledger completo no cliente (confirmado por leitura):
   | Arquivo | Tela | Hoje | Nova fonte |
   |---|---|---|---|
   | `src/lib/hooks/useFinancialPerformance.ts:21` | Home/Resumo, Assessor | `useAllTransactions()` | RPC agregada de período |
   | `src/lib/hooks/usePerformanceDetail.ts:17` | Detalhe de performance | `useAllTransactions()` | RPC por categoria/período |
   | `src/pages/Metas.tsx:59` | Metas | `useAllTransactions()` | RPC de agregados de meta |
   | `src/pages/MetaDetalhe.tsx:21` | Meta | `useAllTransactions()` | RPC + lista paginada |
   | `src/pages/MetaCategoriaDetalhe.tsx:25` | Meta por categoria | `useAllTransactions()` | RPC de fatos por categoria |
   | `src/pages/Cartoes.tsx:50` | Cartões | `useAllTransactions()` | RPC de exposição de cartão |
   | `useFinancialSnapshot.ts:101` | Home (fallback) | condicional | fallback vira degradação honesta, não download total |
   `src/pages/Lancamentos.tsx` já usa `useTransactions(filtros)` — correto, fica.
3. Materialização existe no schema mas **não alimenta nada**: `financial_current_snapshots` = 0 linhas, `financial_profile_snapshots` = 0 linhas, `financial_performance_snapshots` = 1, `financial_daily_facts` = 59 e `financial_daily_category_facts` = 194 (parciais, do backfill antigo). Ou seja: as tabelas de fatos existem, o produto não lê nem escreve nelas de forma contínua.
4. `financial_profile_snapshots` está vazia porque a escrita foi implementada apenas dentro das tools do agente (`_shared/agent/financialProfile.ts`), condicionada a alguém fazer uma pergunta patrimonial, e a Edge Function não foi reimplantada depois da migration. Não há job.
5. Observabilidade do agente **não está integrada em produção**: os 26 runs recentes têm `stage_ms = {}`, `routing_ms/history_ms/context_ms/tool_ms/llm_ms/persist_ms = null`, `tokens_in = 0`. O código que grava esses campos existe em `AgentCore.ts:1136-1147` mas o último run é de 21/08 02:18 — anterior ao deploy. Falta deploy + runs novos.

## 2. Arquitetura atual vs alvo

```text
ATUAL:  Home -> home-snapshot (lê TODAS as transações) -> engine -> snapshot
        Metas/Cartões/Performance -> ledger completo no browser -> engine no cliente

ALVO:   ledger canônico
          -> fatos diários/mensais materializados (dirty-marking por trigger)
          -> RPCs derivadas SECURITY DEFINER (payload dezenas de campos)
          -> React Query com freshness/computed_at
          -> render progressivo por card
```

## 3. Plano de implementação

**Bloco A — Materialização contínua (reuso, sem segunda verdade)**
- Reusar `financial_daily_facts`, `financial_daily_category_facts` e `financial_current_snapshots`. Nada de tabela nova de fatos.
- Nova tabela só de controle: `financial_dirty_periods (user_id, month, marked_at, processed_at)`, alimentada por trigger `AFTER INSERT/UPDATE/DELETE` em `transactions`, `credit_card_*`, `account_balance_snapshots`. Trigger apenas marca — não recalcula.
- Recompute incremental: função de banco `finance_rebuild_dirty(limit)` com lease/trava, teto por rodada, idempotente, agendada; recomputa só os meses sujos e o snapshot atual. Importação de 5.000 linhas marca meses, não trava a Home.

**Bloco B — Leitura compacta**
- RPCs `SECURITY DEFINER` escopadas em `auth.uid()`, com `GRANT` na mesma migration: `rpc_home_snapshot(start,end,today)`, `rpc_period_performance`, `rpc_performance_detail`, `rpc_goal_aggregates`, `rpc_card_exposure`.
- Contrato de retorno inclui `computed_at`, `contract_version`, `completeness`, `missing_sources`, `freshness` (`fresh|stale_recomputing`).
- `home-snapshot` passa a ler fatos + janelas necessárias (nunca o histórico completo) e a servir de caminho de verificação de paridade; quando o mês está sujo, responde com dado atual e marca `stale_recomputing`.

**Bloco C — Frontend apresenta, não recalcula**
- `useFinancialSnapshot`: remove `useAllTransactions` de vez; erro do servidor vira erro honesto com retry (já existe UI de degradação), sem baixar ledger.
- `useFinancialPerformance`, `usePerformanceDetail`, `Metas`, `MetaDetalhe`, `MetaCategoriaDetalhe`, `Cartoes`: passam a consumir as RPCs; listas de lançamentos usam `useTransactions` por período/paginação.
- `useAllTransactions` é renomeada para `useAllTransactionsAdminOnly` e restrita a fluxos administrativos, com regra de lint proibindo uso em `src/pages` e `src/lib/hooks`.
- Adapter mantém o tipo `FinancialSnapshot` para os componentes não mudarem.

**Bloco D — Invalidação e realtime**
- Dependency graph por domínio+mês: escrita em agosto invalida apenas chaves cujo período intersecta agosto; `financial-snapshot` de outros períodos e `accounts/categories/cards` não são tocados.
- `FinancialRealtimeSync.tsx`: coalescing por janela, um refetch por escopo afetado, com contador de requests exposto em dev.

**Bloco E — Mobile e percepção**
- Render progressivo: P1 saldo, P2 ritmo/resumo, P3 insights; skeleton por card, sem bloqueio global.
- Prefetch no layout autenticado: snapshot da Home + estado da conversa do Nino + últimos movimentos (nunca histórico bruto).
- Code splitting: gráficos, relatórios e todo o `src/pages/admin` fora do bundle do usuário comum; auditoria de bundle antes/depois.

**Bloco F — Agente/WhatsApp**
- Deploy das funções do agente e produção de runs novos reais; validação de que `stage_ms`, `token_breakdown`, `routing_ms`, `history_ms`, `context_ms`, `tool_ms`, `llm_ms`, `persist_ms`, `context_chars` ficam preenchidos.
- Auditoria de `ContextBudget.ts` confirmando que não resta `slice` de JSON.
- Fast path determinístico para "qual meu saldo", "quanto gastei", "qual minha fatura": roteia para tool canônica + humanizador leve, sem raciocínio pesado.
- Perfil longitudinal passa a ser escrito pelo job (Bloco A), não pela pergunta.

**Bloco G — Evidência**
- Benchmark reproduzível em `scripts/bench-home.mjs` com usuários sintéticos de 100/1k/5k/10k/20k transações (dados sintéticos em usuário de teste; nada tocado no ledger real): requests, rows, payload KB, query ms, compute ms, render ms.
- Medição mobile via Playwright em viewport de iPhone, cold/warm cache, rede desacelerada.
- Instrumentação de query (duration, rows, bytes, cache_hit, tela) e marcos de rota (`route_start` → `first_useful_content` → `screen_complete`) visíveis em dev/admin, sem dado sensível.
- Tabela final ANTES/DEPOIS com todas as métricas pedidas + mapa arquivo antigo → novo → mudança → motivo.

## 4. Ordem de execução
A (dirty + job) → B (RPCs) → C (frontend) → D (invalidação/realtime) → F (agente) → E (mobile/percepção) → G (evidência).

## 5. Riscos e mitigação
- **Divergência de valores**: teste de paridade obrigatório RPC vs engine canônico por período, tolerância 0,01; qualquer divergência bloqueia o bloco.
- **Fatos sujos servindo número velho**: contrato expõe `freshness`; a UI mostra "atualizando" em vez de mentir.
- **Trigger encarecendo escrita**: trigger só faz `INSERT ... ON CONFLICT` numa tabela de controle.
- **Backfill pesado**: job com lease, teto por rodada e retomada por checkpoint (mesmo padrão de `finance-backfill-runner`).
- **Regressão de tela**: adapter preserva o contrato `FinancialSnapshot`; testes E2E de Home, Metas, Cartões e um turno completo do agente.

## 6. Critérios objetivos de aceite
1. Zero ocorrências de `useAllTransactions` em `src/pages` e `src/lib/hooks` (checado por script).
2. Home: uma query de snapshot, payload praticamente constante entre 100 e 20.000 transações (variação < 20%).
3. Metas, MetaDetalhe, MetaCategoriaDetalhe, Cartões e performance sem ledger completo.
4. `financial_current_snapshots`, `financial_daily_facts` e `financial_profile_snapshots` com linhas escritas pelo job, e `financial_dirty_periods` esvaziando após rodada.
5. Importação de histórico não degrada abertura da Home (medido antes/depois da importação sintética).
6. Realtime: uma escrita gera no máximo os refetches do escopo afetado (contagem medida).
7. Runs novos de `agent_runs` com todos os campos de estágio e `token_breakdown` preenchidos; P50/P90 medidos pós-deploy; tokens de entrada comprovadamente menores nas 4 perguntas de referência.
8. Metas mobile: first useful content < 1s, dados críticos < 1,5s, tela completa < 2s em condição normal (warm).
9. Paridade financeira exata antes/depois em saldo, renda, despesa, patrimônio, cartão, compromissos, metas e projeções.
10. Nenhum `UPDATE`/`DELETE` em `transactions` nesta iniciativa.
