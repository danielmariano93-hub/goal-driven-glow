# Fechamento: fatos derivados incrementais + âncora patrimonial de investimentos

Rodada de fechamento. Nada do que já funciona é revertido: `home-snapshot`, `finance-derived`, cache por versão de ledger, `useLedgerWindow`, paginação server-side e debounce de realtime permanecem.

## 1. Estado atual comprovado (verificado agora)

Funcionando de verdade:
- `useFinancialSnapshot` e `useFinancialPerformance`/`usePerformanceDetail` não baixam mais ledger; consomem `home-snapshot` e `finance-derived`.
- `financial_derived_cache` tem 3 linhas reais; `financial_ledger_versions` tem 2 usuários com versão incrementada por trigger.
- Metas/MetaDetalhe/MetaCategoriaDetalhe/Cartões usam `useLedgerWindow` (13 meses atrás + 24 à frente).

Apenas infraestrutura (não entregue):
- `financial_dirty_periods`: 10 linhas, **todas com `processed_at` nulo**. `markDirtyProcessed()` existe em `_shared/derived/cache.ts` e **não é chamado em nenhum lugar**. Não há worker, lease, retry nem observabilidade. Consumidor real: zero.
- Fatos: `financial_current_snapshots` 0 linhas, `financial_profile_snapshots` 0 linhas, `financial_daily_facts` 59 e `financial_daily_category_facts` 194 (resíduo do backfill antigo, ninguém lê no hot path).
- Observabilidade do agente: 379 runs, **0 com `llm_ms`** e **0 com `stage_ms` diferente de `{}`**; último run 21/08 02:18 (antes do deploy). Schema entregue, runtime não.

`fetchAllTransactions` ainda executa em: `home-snapshot/index.ts:103` e `finance-derived/index.ts:77` — sempre que o cache erra. Ele é necessário hoje porque não existe nenhum fato mensal materializado do qual o motor possa partir: qualquer miss reconstrói a vida inteira (1.856 tx hoje, O(N) por design).

Duplicação de request confirmada: `useFinancialPerformance` e `usePerformanceDetail` usam `ledgerVersion.data ?? 0` na chave **sem** `!ledgerVersion.isLoading` no `enabled` — disparam versão 0 e depois a real. A Home já está protegida.

## 2. Arquitetura alvo

```text
ESCRITA FINANCEIRA
  -> trigger marca dirty (mês + domínio)
  -> worker recomputa SÓ os meses sujos
  -> financial_monthly_facts atualizado
  -> snapshot/cache derivado invalidado por mês
HOME/PERFORMANCE
  -> lê fatos mensais + janela do período + verdades de estado (contas, cartões, metas)
  -> nunca o ledger inteiro
```

## 3. Blocos de implementação

**A. Fatos mensais + worker incremental**
- Nova tabela `financial_monthly_facts` (reutilizando os fatos diários existentes como insumo, sem duplicar verdade): income, consumo comportamental/conta/cartão, refunds, transfers, aplicações e resgates de investimento, dívida, breakdown por categoria e merchant, dias com gasto, contagem, `completeness`, `formula_version`, `ledger_version`, `computed_at`.
- `financial_dirty_periods` ganha `domain` e colunas de lease (`locked_until`, `attempts`, `last_error`); o trigger passa a informar o domínio afetado.
- Função de banco + Edge Function `finance-facts-worker`: lease por lote, teto de meses por rodada, idempotente (upsert por `user_id, month`), retry com backoff, agendada; grava `processed_at` e métricas por rodada.
- Um lançamento de 15/03 recomputa **apenas** março e os agregados que dependem de março.

**B. Hot path sem ledger inteiro**
- `home-snapshot`: monta a partir dos fatos do período + estado atual (contas, snapshots de saldo, cartões, dívidas, metas, recorrências, investimentos) + janela do período requisitado. `fetchAllTransactions` fica restrito a bootstrap/rebuild administrativo com flag explícita e registro em log.
- `finance-derived`: performance e comparações passam a ler fatos mensais/diários do intervalo, não a vida toda.
- Paridade obrigatória: RPC/fatos vs motor canônico, tolerância 0,01. Divergência bloqueia o bloco.

**C. Backfill seguro**
- Reaproveita o padrão de `finance-backfill-runner`: por usuário, por mês, lote limitado, checkpoint, retomável, observável. Nunca dentro da abertura da Home.

**D. Invalidação com granularidade**
- Mantém `financial_ledger_versions` global, e acrescenta versão por `(user_id, month)` / domínio para as chaves de leitura. Escrita em março não invalida cache de janeiro, cartões não relacionados nem dados estáticos.
- `useLedgerWindow` deixa de ser janela genérica: Cartões passa a usar statements/installments/purchases; meta mensal usa período + baseline; meta histórica usa fatos agregados. Cada consumidor com janela justificada em comentário.
- `useFinancialPerformance` e `usePerformanceDetail` recebem o gate `!ledgerVersion.isLoading`.

**E. Observabilidade e benchmark**
- Home: `ledger_version_ms`, `snapshot_request_ms`, `cache_lookup_ms`, `derived_fact_read_ms`, `snapshot_assembly_ms`, `payload_bytes`, `total_ms`, `cache_hit`; em rebuild: `dirty_months`, `transactions_read`, `rebuild_ms`.
- Benchmark em usuário sintético de teste (nunca no ledger real) com 100/1k/5k/10k/20k/50k transações, cenários A–E (cache hit, miss sem mudança, lançamento no mês atual, lançamento histórico, importação de 5.000 antigas).

**F. Agente/WhatsApp**
- Deploy das funções do agente e execução de turnos novos reais. As 5 perguntas de referência ("saldo", "quanto gastei", "como estou", "melhor desde janeiro", "patrimônio") com `capability`, `path`, tokens, `context_chars` e todos os `*_ms` preenchidos; P50/P90 apresentados contra o baseline de 8–13 s / 20k–27k tokens.
- Fast path das perguntas simples: intent → tool canônica → fato compacto → resposta leve, sem `FinancialContext360` completo.

## 4. Investimentos — causa e correção

Causa da dupla contagem (lida em `tf_transactions_investment_link`): no `AFTER INSERT/UPDATE`, quando `movement_kind` é aplicação/resgate e um `investment_id` é resolvido, a função **sempre** soma/subtrai `current_value` e `invested_amount` e move `reference_date`. Não existe comparação com a âncora. Preencher `investment_id` num lançamento histórico durante reconciliação é lido como movimento novo — e a posição atual já o incorporava. Agrava: o estado "já incorporado" hoje é inferido de `applied = false AND notes IS NULL`, um significado oculto e frágil.

Correção:
- **Âncora explícita**: `occurred_at <= reference_date` → apenas vínculo + movimento auditável, sem mexer no estoque. `occurred_at > reference_date` → aplica uma única vez. Igual à data da âncora conta como incorporado.
- **Estado contábil explícito** em `investment_movements`: nova coluna `accounting_state` (`applied_to_position`, `incorporated_in_anchor`, `pending_reconciliation`, `rejected`) + `provenance`. `applied` é mantido e passa a ser derivado, preservando compatibilidade; migration classifica as 40 linhas existentes conforme a semântica atual (sem alterar posição de ninguém).
- **Link ≠ apply**: preencher `transaction.investment_id` cria vínculo; aplicar posição é operação separada e condicionada à âncora.
- **Ambíguo nunca aplica**: sem confiança suficiente → `pending_reconciliation` e reconciliação exposta, nunca mutação silenciosa.
- **Resgate maior que a posição**: proteção preservada, com diagnóstico enriquecido (âncora antiga, saldo inicial ausente, ativo errado, já incorporado, outro produto). Jamais zerar patrimônio em silêncio.
- **Principal/rendimento**: mantém baixa proporcional de principal, distinguindo `current_value`, `invested_amount` e rendimento.
- **Aliases**: resolução determinística reforçada para as variações reais (RESGATE CDB DI, DI RESGATE CDB, APLICACAO CDB DI, APLICACAO/INT RESGATE SABESP FIA), sem LLM quando existe alias, e nunca vínculo arbitrário entre ativos distintos.
- **Reconciliação**: `InvestmentPositionReconciliation` (âncora, aplicações/resgates após a âncora, rendimento, posição esperada vs registrada, diferença, confiança, proveniência) como fonte única consumida por Home, Patrimônio, Nino, WhatsApp, Relatórios e Metas.
- **Semântica de relatório**: resgate/empréstimo/transferência/ajuste nunca entram como renda operacional; aplicação/pagamento de cartão/transferência nunca como consumo; refund neutraliza consumo. Ponte patrimonial que não fecha expõe `reconciliation_gap`, `confidence` e `missing_sources` em vez de inventar taxa de poupança.

Nenhum dado financeiro atual do usuário é alterado por esta rodada.

## 5. Testes

Performance: 100/1k/5k/10k/20k/50k tx, cold e warm, lançamento no mês atual, lançamento histórico, importação em massa.
Investimentos: aplicação/resgate novo e histórico, vínculo tardio, re-vínculo idempotente, movimento antes/depois/exatamente na âncora, resgate maior que a posição, ativo ambíguo, alias único, dois ativos com nomes parecidos, backfill em ordem invertida.
E2E obrigatório: âncora 31/07 R$ 24.500, resgate histórico 15/07 R$ 500 (não reduz), resgate futuro 05/08 R$ 500 → posição R$ 24.000; reexecutar o fluxo mantém R$ 24.000.

## 6. Rollout e rollback

Ordem: A (fatos + worker) → C (backfill) → B (hot path) → D (invalidação) → investimentos (migration + trigger) → F (agente) → E (evidência).
Rollout com flag por bloco: o hot path só passa a ler fatos depois da paridade verde; enquanto isso o caminho antigo continua servindo. Rollback = desligar a flag (hot path volta ao caminho atual) e desativar o worker; a migration de investimentos é aditiva e o trigger anterior é restaurável em um passo.

## 7. Entrega

No fim, matriz PASS/FAIL/BLOCKED dos 10 critérios de performance e 8 de investimentos, tabela ANTES/DEPOIS (requests, rows, payload, query/compute/render ms, P50/P90 do agente) e mapa arquivo antigo → novo → motivo.
