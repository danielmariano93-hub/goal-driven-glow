# Correção de metas por categoria, dívidas e drill-down de latência do Nino

## Estado confirmado antes do plano

- O código de `home-snapshot` já lê categorias globais + categorias do usuário, mas o hot path SQL `my_financial_home_snapshot` ainda serve snapshots/cache com chave `home_snapshot_v2` e não valida `contract_version` antes de devolver o read model materializado.
- No banco, os snapshots materializados atuais ainda estão em `home_snapshot.v2`; há 4 itens de metas por categoria e os 4 estão sem nome/caindo em rótulo neutro. Isso explica o print continuar mostrando “Categoria”.
- A RPC `record_debt_payment` cria `debt_payments`, cria a movimentação de caixa e reduz `debts.outstanding_balance`; porém o motor de atraso de dívidas, quando a dívida só tem `due_day` e não tem `first_due_date/start_date`, deriva a agenda a partir do mês atual e do número de parcelas pagas. Esse desenho pode manter a parcela do ciclo atual como “em atraso” logo após registrar o pagamento.
- O painel Admin já tem histórico agregado de tokens/latência em `admin_v2_ai_history`, com filtros de `capability`, `model_tier` e `model`, mas a UI ainda não tem drill-down dos `agent_runs` que explicam P50/P95.

## Objetivos da rodada

1. Fazer os nomes das categorias voltarem imediatamente nas metas por categoria.
2. Fazer pagamento de parcela de dívida refletir no saldo, progresso, agenda e status de atraso.
3. Adicionar drill-down no gráfico de latência para listar os `agent_runs` que mais impactaram P50/P95, com filtros por `model_tier`, `model` e `capability`.
4. Validar com testes automatizados e checagens reais no backend/preview, sem alterar regras financeiras de saldo, receita, despesa, cartão, fatura, patrimônio ou metas.

## Plano de implementação

### 1. Metas por categoria: corrigir cache/read model stale

- Atualizar `my_financial_home_snapshot` para só servir `financial_current_snapshots` quando o `contract_version` materializado for o contrato atual.
- Trocar a chave do cache derivado de `home_snapshot_v2` para `home_snapshot_v3` também no hot path SQL, alinhando com a Edge Function.
- Manter a leitura de categorias globais + do usuário nas Edge Functions que compõem snapshots.
- Forçar recomputação segura dos snapshots afetados:
  - marcar snapshots atuais antigos como stale/pendentes ou invalidar apenas o cache derivado de `home_snapshot_v2`;
  - não alterar valores financeiros, metas ou categorias.
- Adicionar teste cobrindo o caminho servido/cacheado: snapshot antigo sem `categoryName` não pode ser aceito quando o contrato mudou.

### 2. Dívidas: pagamento de parcela precisa abater atraso corretamente

- Ajustar o motor `debt_status.v1` para dívidas com agenda derivada apenas por `due_day`:
  - se existe pagamento registrado cobrindo o ciclo atual, a dívida não deve continuar “em atraso” para o mesmo vencimento;
  - o próximo vencimento deve avançar para o próximo ciclo;
  - se não há pagamento no ciclo vencido, o atraso continua sendo exibido.
- Ajustar `buildDebtSchedule` para a UI mostrar a mesma verdade do motor: parcela atual paga, próxima parcela futura e contador de atraso coerente.
- Fortalecer `record_debt_payment`:
  - usar `coalesce(installments_paid, 0)` no incremento;
  - garantir que pagamento de uma dívida parcelada cubra pelo menos 1 parcela quando o valor aplicado representa uma parcela e a UI/API não informar `installments_covered` corretamente;
  - preservar idempotência e auditoria via `debt_payments`.
- Fazer backfill seguro apenas para casos explícitos: pagamentos existentes em `debt_payments` com valor aplicado e `installments_covered = 0`. Não farei tentativa arriscada de “adivinhar” pagamento antigo a partir de lançamentos livres sem vínculo com dívida.
- Garantir invalidação/read-after-write: após registrar pagamento, recarregar dívidas, pagamentos e snapshots derivados.

### 3. Drill-down de P50/P95 no Admin

- Criar uma RPC admin agregada para drill-down dos `agent_runs`, sem expor conteúdo de conversa:
  - filtros: período, canal, path, `capability`, `model_tier`, `model` e dia selecionado no gráfico;
  - retorno: `run_id`, horário, status, canal, path, capability, model tier, model, latência, tokens, chamadas de IA, custo estimado e erro sanitizado quando existir.
- A RPC deve separar:
  - contribuintes de P50: runs próximos da mediana do recorte/dia;
  - contribuintes de P95: runs no topo da cauda, acima ou próximos do percentil 95;
  - outliers: maiores latências absolutas.
- Adicionar índices se o plano de consulta indicar necessidade, sem mexer em tabelas de negócio.

### 4. UI do painel de eficiência

- Adicionar filtro explícito de `model` junto dos filtros avançados já existentes.
- Tornar o gráfico de latência clicável: selecionar um dia abre/atualiza um painel de drill-down.
- Exibir tabela compacta dos runs que impactaram P50/P95, com ordenação por latência e badges de `model_tier`, `model` e `capability`.
- Adicionar estados de vazio, carregamento e erro, sem dados fictícios.

## Validação

- Testes unitários:
  - metas por categoria com snapshot/cache antigo vs contrato atual;
  - dívida com `due_day = 10`, hoje após o dia 10, pagamento registrado no ciclo atual não permanece em atraso;
  - dívida sem pagamento no ciclo atual continua em atraso;
  - RPC/formatador de drill-down não inclui conteúdo sensível.
- Testes seletivos com Vitest para os módulos alterados.
- Checagem no backend:
  - confirmar que os snapshots novos saem com `contract_version` atual e `activeCategoryGoals[].categoryName` preenchido quando a categoria existe;
  - confirmar que uma dívida com pagamento recente deixa de aparecer como atrasada no mesmo ciclo;
  - confirmar que o drill-down retorna runs reais filtrados por `model_tier`, `model` e `capability`.
- Checagem visual no preview mobile das telas de Metas e Dívidas e no Admin desktop do gráfico de latência.

## Fora de escopo

- Não alterar identidade visual, paleta, logo ou copy institucional.
- Não alterar fórmulas financeiras de saldo, receita, despesa, fatura, patrimônio, projeção, metas ou categorias.
- Não publicar em produção sem autorização explícita.
