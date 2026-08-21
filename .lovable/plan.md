# Auditoria de performance — Home e Metas (mobile) e arquitetura alvo

Auditoria do HEAD atual. Nada implementado, nada publicado.

## O que a gravação mostra, traduzido em arquitetura

A casca (shell) chega rápido porque é estática. Os números chegam tarde e em ondas porque **cada número tem sua própria viagem de rede**, e algumas delas só começam depois que outra terminou. Não é lentidão de cálculo: é uma cadeia de esperas.

## Hipóteses: confirmadas / refutadas

| # | Hipótese | Veredito | Evidência no HEAD |
|---|---|---|---|
| 1 | Múltiplas queries independentes por tela → números em tempos diferentes | **Confirmada** | Home: `useAccounts`, `useFinancialSnapshot`, `useNinoDiagnosisContext` (RPC `my_nino_diagnosis_context`), + queries próprias dos cards: `EmotionalCheckinCard` (2), `ParaPagarResumo` (1), `AReceberRoleResumo` (RPC `split_summary`). Cada uma resolve sozinha e re-renderiza |
| 2 | Metas ainda baixa 13 meses atrás + 24 à frente | **Confirmada** | `src/pages/Metas.tsx:59` → `useLedgerWindow()`; default em `src/lib/db/finance.ts:357` = `monthsBack 13`, `monthsAhead 24` (~38 meses), paginado de 1.000 em 1.000 em `useTransactions`. Agregado de categoria é calculado **no dispositivo** sobre esse array (`numericTxs`, `catGoalEvals`). Mesmo padrão em `MetaDetalhe.tsx:21`, `MetaCategoriaDetalhe.tsx:25`, `Cartoes.tsx:50` |
| 3 | `useLedgerVersion` adiciona round-trip que bloqueia o snapshot | **Confirmada** | `derivedViews.ts` faz RPC `finance_ledger_version`; `useFinancialSnapshot.ts:59` e `useFinancialPerformance.ts:30` têm `enabled: … && !ledgerVersion.isLoading` → a Edge Function só é chamada **depois** dessa ida e volta |
| 4 | Home depende de Edge Function + muitas queries + compute on-demand no miss | **Confirmada** | `home-snapshot` faz 14 leituras de tabela em paralelo + `buildCompactLedger` (~1,5k linhas) + motor canônico; no miss de cache tudo isso roda dentro do request, somado ao cold start da função |
| 5 | Materialização de fatos incompleta / não é o read path principal | **Parcialmente confirmada** | `financial_monthly_facts` existe e o cron `finance-facts-worker-1m` está **ativo**. Porém os fatos só alimentam o *carry* dentro de `compactLedger`; `category_breakdown`/`merchant_breakdown` já materializados **não são lidos por nenhuma tela**. Metas ignora fatos por completo |
| 6 | Navegação lazy sem prefetch de chunk nem de dados | **Confirmada** | `App.tsx`: todas as rotas em `lazy()`, `Suspense` com spinner global, nenhum `prefetchQuery` e nenhum preload de chunk na barra de navegação |
| 7 | Realtime/invalidation gera refetch excessivo | **Parcialmente refutada** | `FinancialRealtimeSync` já faz debounce de 1,2s e invalidação por escopo. O problema é o **tamanho** do que é invalidado: o escopo `transactions` derruba `qk.transactions` e, com Metas montada, isso re-baixa os 38 meses |
| 8 | Falta separar time-to-shell / first useful content / screen-complete | **Confirmada** | Não existe instrumentação de tempo no cliente; nenhuma marca de render, nenhuma métrica por superfície |

Fato adicional relevante: **não existe cache persistido** (nenhum `persistQueryClient`/`Preferences`/`localStorage` de React Query). Toda abertura de app é *cold* — sem um único número em tela até a rede responder. Isso explica os 7–9s com skeleton após refresh.

## Causa-raiz priorizada

**P0 — cadeia serial antes do primeiro número.** `auth → RPC de versão do ledger → invoke da Edge (cold start) → 14 leituras + ledger compacto + motor → render`. Quatro saltos em série antes de qualquer valor aparecer, sem nada em cache no disco.

**P0 — Metas calcula no celular sobre 38 meses de ledger.** É a origem exata do "agregados de categoria só estabilizam ~5s depois da navegação": download paginado + agregação em JS na thread principal. Cresce com o histórico → viola a regra de nenhuma tela O(histórico).

**P0 — ausência de cache persistido.** Sem SWR a partir do disco não há como cumprir first useful content < 700ms warm.

**P1 — números fragmentados por card.** Cada card com sua própria query produz o efeito ruim de "número muda depois da tela visível". Precisa de um envelope por tela.

**P1 — fatos materializados subutilizados.** `category_breakdown` já existe e ninguém lê; a mesma soma é recalculada no cliente.

**P1 — Metas dispara um segundo `home-snapshot`** com período próprio (`Metas.tsx:63`), chave diferente da Home → recomputo do zero em vez de reuso.

**P2 — sem prefetch de chunk/dados na navegação** e **sem observabilidade/SLO**.

## Arquitetura atual vs alvo

```text
HOJE (Home)
auth ─► RPC ledger_version ─► invoke home-snapshot ─┬─ 14 tabelas
                                                    ├─ compactLedger (~1.5k linhas)
                                                    └─ motor canônico ─► 1 payload
   + RPC diagnosis      (paralela, chega depois)
   + 4 queries de card  (paralelas, chegam depois)

HOJE (Metas)
auth ─► goals/contribs/investments/accounts/categories/catGoals (6 queries)
     ─► ledgerWindow: 38 meses paginados ─► agregação em JS ─► números
     ─► home-snapshot com outro período (recomputo)

ALVO
disco (cache persistido) ─► pinta números de imediato (com selo "atualizando")
        │
        └─ 1 invoke por tela (screen bundle), sem round-trip prévio
             ├─ resposta em 2 estágios: critical (saldo/topo) → full (detalhe)
             └─ read model materializado (monthly_facts) como caminho primário
```

Princípio inegociável: **nenhuma segunda verdade financeira**. Os fatos mensais e o cache derivado continuam sendo *memoização de um único motor* (`finance-core`), versionados por `ledger_version` + `formula_version`, nunca uma nova fórmula. Toda leitura nova sai do mesmo motor ou de fato já materializado por ele.

## Mudanças concretas por arquivo/camada

### P0.1 — Matar o round-trip de versão do ledger no caminho crítico
- `src/lib/db/derivedViews.ts`: `useLedgerVersion` deixa de ser pré-requisito. A versão passa a ser **resultado** da resposta (as funções já devolvem `ledger_version`).
- `src/lib/hooks/useFinancialSnapshot.ts`, `useFinancialPerformance.ts`, `usePerformanceDetail.ts`: remover a versão da `queryKey` e o gate `!ledgerVersion.isLoading`. Frescor passa a vir de invalidação explícita (`invalidateFinancialQueries`) + realtime, que já existem.
- Ganho: −1 RTT em toda abertura de tela financeira.

### P0.2 — Cache persistido com stale-while-revalidate
- `src/App.tsx`: `persistQueryClient` com `Preferences` (nativo) / `localStorage` (web), `maxAge` 24h, allow-list de chaves derivadas (`home-snapshot`, `goals-bundle`, `advisor-performance`, catálogos) e **deny-list** de dados sensíveis não necessários.
- Chave de cache inclui `user_id` + `formula_version`; troca de usuário ou de fórmula descarta tudo.
- UI: número persistido aparece imediatamente com selo discreto "atualizando"; skeleton só quando **não há** valor anterior.

### P0.3 — Metas deixa de baixar ledger
- Nova view no `finance-derived`: `view: "goals"`, devolvendo por meta de categoria `{ spent, cap, projection, status, contribution_progress }`, calculada pelo mesmo motor a partir de `financial_monthly_facts.category_breakdown` + janela do mês corrente.
- `src/pages/Metas.tsx`: remover `useLedgerWindow`; consumir a view. `MetaDetalhe.tsx` e `MetaCategoriaDetalhe.tsx`: janela reduzida ao escopo da meta (categoria + período exibido), nunca 38 meses.
- `src/pages/Cartoes.tsx`: passa a usar a view de cartões já existente no servidor em vez de ledger cru.
- `src/lib/db/finance.ts`: `useLedgerWindow`/`useAllTransactions` passam a exigir escopo explícito (from/to/categoria) e ganham teto duro; nenhuma tela pode chamar sem filtro.

### P0.4 — Um envelope por tela (chegada simultânea)
- `home-snapshot` passa a devolver também o que hoje são queries de card (check-in emocional do dia, a pagar, a receber do rolê) e o resumo de diagnóstico da Home.
- `src/pages/Index.tsx` e cards em `src/components/home/*`: recebem dados por prop do envelope; cards param de consultar sozinhos.
- Resposta em dois estágios: `critical` (topo: disponível, ritmo, previsão) resolvido primeiro; `full` (detalhes, diagnóstico) num segundo trecho — cada estágio pinta um bloco inteiro, nunca um número solto.

### P1.1 — Fatos como caminho primário de leitura
- `compactLedger.ts`: quando o período pedido está inteiramente coberto por fatos frescos, servir direto dos fatos (janela = mês corrente apenas). Ledger cru só para o mês aberto e para o horizonte de parcelas.
- Cobertura do worker: verificação de meses `processed_at IS NULL` como sinal de saúde, não como degradação silenciosa.

### P1.2 — Reuso entre Home e Metas
- Chave de cache derivada normalizada por `(período, modo)`; Metas reaproveita o envelope da Home quando o período coincide, em vez de disparar novo invoke.

### P1.3 — Invalidação mais cirúrgica
- `src/lib/db/queryKeys.ts`: escopo `transactions` deixa de invalidar leituras que dependem apenas de fatos do mês afetado; invalidação passa a carregar o mês tocado e só derruba envelopes que o contêm.

### P2 — Prefetch e navegação
- `BottomTabBar`/`AppLayout`: `onPointerDown`/`onTouchStart` dispara import do chunk da rota **e** `queryClient.prefetchQuery` do envelope da tela; feedback visual de tap imediato (<100ms) independente da navegação.
- `Suspense` por rota com **shell específico** (cabeçalho + moldura dos cards) em vez do spinner global.

## Observabilidade e SLOs

Instrumentar três marcas por tela, enviadas em amostragem para `financial_performance_snapshots`:
- `time_to_shell` — primeira pintura da moldura da rota;
- `first_useful_content` — primeiro número real (inclui valor vindo do cache persistido);
- `screen_complete` — último bloco estabilizado (nenhum número muda depois).

Cada resposta derivada carrega `cache_hit`, `compute_ms`, `rows_read`, `source: facts|window|mixed`. Painel admin: P50/P75/P90/P95 por tela e por origem.

| Métrica | P50 warm | P75 warm | P90 warm | P95 cold |
|---|---|---|---|---|
| tap feedback | <50ms | <80ms | <100ms | <100ms |
| route shell | <150ms | <220ms | <300ms | <600ms |
| first useful content | <350ms | <500ms | <700ms | <1,2s |
| critical data | <500ms | <750ms | <1s | <1,5s |
| screen complete | <800ms | <1,1s | <1,5s | <2s |

Regra de guarda em CI: nenhuma tela normal pode ler mais linhas de `transactions` do que o teto do seu escopo — teste falha se `rows_read` crescer com o histórico.

## Rollout seguro

1. **Fase 0 — medir.** Instrumentação + benchmark sintético com 100/1k/5k/10k/20k transações (usuário de teste dedicado), registrando `rows_read`, `compute_ms`, e as três marcas de tela. Linha de base publicada antes de qualquer mudança.
2. **Fase 1 — P0.1 + P0.2** (sem tocar em fórmula): remoção do RTT de versão e cache persistido. Risco baixo, reversível por flag.
3. **Fase 2 — P0.3 + P1.1** atrás de flag por usuário, com **teste de paridade 100%**: para cada usuário de teste e cada período, todo campo numérico do caminho novo comparado ao caminho atual; qualquer divergência (tolerância R$ 0,00) bloqueia o rollout.
4. **Fase 3 — P0.4 + P1.2 + P1.3** com paridade repetida.
5. **Fase 4 — P2** (prefetch/shell) e comparação final contra a linha de base da Fase 0.
6. Rollback: cada fase é uma flag; desligar a flag volta ao caminho atual sem migração reversa.

Sem publicação em produção sem sua autorização explícita.

## Perguntas em aberto

- Se o cache persistido puder mostrar valores de até 24h atrás por alguns instantes (sempre com selo "atualizando"), isso é aceitável? É o que torna o first useful content <700ms possível.
- Quer que Cartões entre nesta rodada ou fique para depois?
