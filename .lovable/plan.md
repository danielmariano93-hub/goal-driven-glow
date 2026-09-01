# Home em zero: read model v3 rodando com código v4

## Diagnóstico confirmado

- O código já está em v4: `supabase/functions/home-snapshot/index.ts` declara `CONTRACT = "home_snapshot.v4"` e monta a chave `home_snapshot_v4|...`.
- O banco, porém, só tem artefato antigo:
  - `financial_current_snapshots`: 1 linha, `contract_version = home_snapshot.v3`, gerada em 31/08 23:55 UTC.
  - `financial_derived_cache`: 1 linha com chave começando em `home_snapshot_v3|`, mesmo instante.
- Como o consumidor exige exatamente `home_snapshot.v4` (contrato versionado), o snapshot v3 é tratado como stale, o cache não bate, e a Home cai no fallback — saldo indisponível e indicadores em R$ 0,00.

Conclusão: é drift de deploy. As Edge Functions em produção ainda carregam o bundle anterior (cada função embute sua própria cópia de `_shared`). Nada de errado com os lançamentos.

## O que será feito

1. Sincronizar o espelho canônico do `finance-core` para as Edge Functions (`financial_snapshot_contract.v9`, `finance_truth.v2`, `card_cycle.v3`) e rodar a suíte de paridade.
2. Redeploy de `home-snapshot` e `finance-current-snapshot-worker`.
3. Redeploy do lote atômico que depende de `_shared` (lista de `DEPENDENTS.md`): `whatsapp-webhook`, `agent-run`, `agent-chat`, `agent-proactive-tick`, `anticipation-tick`, `financial-reports-generate`, `shared-goal-notify-invite`, `split-reminders-dispatch-v2`, `user-ai-preferences`.
4. Invalidar somente os artefatos derivados v3: remover a linha de `financial_current_snapshots` com `contract_version = 'home_snapshot.v3'` e as linhas de `financial_derived_cache` cuja chave começa por `home_snapshot_v3|`, e enfileirar o usuário para recomputação. Nenhuma outra tabela é tocada.
5. Forçar a recomputação chamando `home-snapshot` com `force_refresh` (via worker), já com o runtime novo.
6. Validar no banco: `contract_version = 'home_snapshot.v4'` e chave `home_snapshot_v4|...`.
7. Abrir a Home no preview autenticado e conferir números reais no lugar do fallback.

## Garantias

- Nenhum `UPDATE`/`DELETE` em `transactions`, `credit_card_*`, `categories`, `accounts`, metas ou histórico. A limpeza é restrita a read model derivado, que é recalculável a partir do ledger.
- A validação é feita por consulta ao banco após a recomputação, não pela versão do repositório.

## Detalhes técnicos

- Sincronização: `node scripts/sync-finance-core.mjs` + `src/test/finance-core-parity.test.ts` para provar que o espelho não divergiu.
- Bump de `AGENT_RUNTIME_VERSION` em `_shared/agent/core/RuntimeContract.ts` para que o run em produção carimbe versão nova — é assim que se distingue "código novo com bug" de "código antigo ainda respondendo".
- Recomputação: `finance_snapshot_refresh_queue` + `finance-current-snapshot-worker` (claim/done), que chama `home-snapshot` com `force_refresh: true`.
- `scripts/check-agent-dependents.mjs` roda para confirmar que a lista de funções a redeployar está completa.

## Relatório final que será entregue

Versão efetivamente deployada de `home-snapshot` e do worker, `contract_version` e `cache_key` recém-gerados (lidos do banco), resultado do teste da Home e contagem de transações antes/depois provando que nada financeiro mudou.
