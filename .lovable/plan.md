# Nino: de lista de detectores para inteligência editorial

## 1. Diagnóstico confirmado (evidências reais)

Consultei os itens do usuário Daniel em produção. O que está na tela hoje:

- **9 riscos ativos**, dos quais **8 são "Confira 2 lançamentos de X"** (Uber, 99, Market4you, PAY Souk4, UltraFestival, Pay Hirot, jim.com, Autopass) — todos com `priority = 72` e `severity = attention`, ou seja, competindo em pé de igualdade com risco real.
- **14 recomendações ativas**, todas com `priority = 58` e rota `/app/nino` (auto-referência: o botão volta para a própria tela). Entre elas: **7 variações de "Categorizar N lançamento(s) do período"**, duas "Sua revisão semanal está pronta" e duas "Seu fechamento mensal está pronto" (duplicadas por janela), e **"Entender os R$ 507,05 a mais em Energia"**.
- `Suas despesas superam a renda` sem período, sem diferença, sem categorias, rota `/app/alertas/grow:overall`.
- Rotas de duplicidade apontam para `/app/alertas/dup%3Auber%3A%3A12.95...`. A rota `alertas/:dedupKey` existe (`ProactiveAlertDetail`), mas o alvo é um alerta proativo, não um par de lançamentos — o destino não resolve o contexto prometido.
- **`anticipation_opportunities` = 0 linhas** e `behavioral_patterns` = 5 linhas. Logo a aba "Prepare-se" está vazia por ausência real de oportunidades, não por bug de leitura.
- Formatação BRL já está corrigida no banco (`R$ 3.313,81`, `R$ 1.170,54`) — a migration de `nino_brl` funcionou. O problema remanescente é **semântica e curadoria**, não locale.
- O bind de `supabase.rpc` **já está corrigido** no HEAD (`(supabase.rpc as any).call(supabase, ...)` em `src/lib/nino/intelligence.ts`). Não é mais causa raiz; será apenas coberto por teste de regressão.

### Causas raiz

1. **Adaptação sem curadoria**: `nino_rebuild_items` copia 1:1 detectores legados (`user_insights`, `pending_proactive_suggestions`, `advisor_reviews`, `financial_reports`) para o artefato canônico. Não há agregação, nem gate semântico, nem consolidação por tópico.
2. **Prioridade constante por fonte**: prioridade é atribuída pelo tipo da fonte (72 para risco, 58 para recomendação), não por impacto/urgência/confiança. Resultado: nada é realmente "principal".
3. **Sem `logical_topic_key`**: dedup é por `dedup_key` de evento, então a mesma meta ou a mesma revisão de período aparece várias vezes.
4. **Sem separação inteligência vs. pendência operacional**: duplicidades e itens sem categoria são renderizados como insights.
5. **`temporal_role` fixo em `now`** para quase tudo, inclusive conteúdos de janelas antigas.
6. **Um único componente de card** para todos os tipos, com borda/selo de atenção genérico.

## 2. O que será construído

### A. Camada de curadoria no banco (`nino_contract.v2`)

Nova migration:

- Colunas em `nino_intelligence_items`: `logical_topic_key text`, `category text` (`intelligence` | `operational` | `closing`), `group_key text`, `group_size int`, `impact_amount numeric`, `impact_pct numeric`, `selection_reason jsonb`, `suppression_reason text`, `narrative_version int`.
- Índice único parcial em (`user_id`, `logical_topic_key`) para status `active`, garantindo **uma ação ativa por tópico**.
- Função `nino_semantic_gate(kind, category_name, movement_kind, evidence)` → rejeita promoção quando a categoria é Estornos/Reembolsos/Transferências/Aplicações/Resgates/Pagamento de fatura/Amortização/Ajuste de conciliação, ou quando amostra/cobertura são insuficientes. Itens rejeitados viram `data_quality` ou são descartados com `suppression_reason`.
- Função `nino_group_duplicates(user_id)` → substitui os N cards "Confira 2 lançamentos de X" por **um item agregado**: total de pares, valor envolvido, comerciantes, par mais recente, severidade derivada de impacto × confiança. Pares individuais ficam em `evidence.pairs`.
- Função `nino_score_item(...)` → prioridade determinística e versionada a partir de impacto absoluto, impacto %, urgência, acionabilidade, confiança, qualidade de dados, novidade, relevância temporal, exposições anteriores, feedback anterior e fadiga.
- Função `nino_consolidate_topics(user_id)` → agrupa recomendações do mesmo `logical_topic_key` (ex.: `goal_recalibration:<goal_id>`, `weekly_review:<period>`, `uncategorized_cleanup`), mantendo a evidência mais recente e marcando as anteriores como `superseded` sem renovar validade.
- Reescrita de `nino_curate_items` para orquestrar: gate → agrupar → consolidar → pontuar → classificar `temporal_role` → expirar fora de janela.
- Narrativas corrigidas: título de padrão obrigatoriamente coerente com o sinal do delta; Energia/Moradia/essenciais recebem copy contextual ("gasto pontual de R$ 507,05 — confirme se foi habitual, acumulado ou extraordinário") em vez de corte percentual.
- Insight composto por categoria: delta absoluto, delta %, participação no aumento total e top comerciantes que explicam a diferença; e reescrita de "Suas despesas superam a renda" com período, receitas, despesas, diferença, categorias explicativas e nota sobre resgates.

### B. Contrato do RPC

`my_nino_intelligence_context` passa a retornar seções separadas e limitadas:

```text
primary_item        -> 1
secondary_changes   -> até 5
learnings           -> até 3
anticipations       -> até 3
operational_tasks   -> agrupado por tipo (1 card resumo + detalhe)
history             -> paginado
```

`my_nino_refresh` passa a retornar `{ ok, facts_processed, created, updated, expired, grouped, suppressed, at, warnings }`.

Novo RPC `my_nino_duplicate_decision(pair_id, decision)` para "São diferentes" / "É duplicado" / "Ignorar", persistindo a decisão para o detector não reapresentar o par.

Grants revistos: `EXECUTE` apenas para `authenticated`, removendo `PUBLIC`/`anon`.

### C. Frontend

- Componentes novos em `src/components/nino/`: `NinoPrimaryInsightCard`, `NinoChangeRow`, `NinoOperationalSummaryCard`, `NinoPatternCard`, `NinoAnticipationCard`, `NinoHistoryRow`.
- `NinoItemCard` fica restrito ao detalhe.
- Regras visuais: vermelho apenas para risco crítico real, âmbar para revisão, roxo para padrão, verde para evolução; secundários compactos, sem borda lateral colorida.
- Feedback contextual por tipo (duplicidade / padrão / recomendação), fora da hierarquia da ação principal.
- CTAs por intenção, nunca "Ver detalhes" genérico; "Como calculamos" traduzido (período, ocorrências, comparação, cobertura, confiança) sem chave técnica nem JSON.
- Botão Atualizar com os 4 estados: idle, "Analisando seus dados…" com spinner + `aria-busy` + conteúdo preservado, sucesso com horário e resumo ("31 leituras analisadas · 3 mudanças atualizadas"), erro com "Tentar novamente" preservando o último dado válido.
- Estados: `isLoading`, `isRefreshing`, `isError`, `error`, `data`, `lastSuccessfulData`. Erro nunca renderiza empty state.
- "Prepare-se" vazio explica o estado real do motor ("o Nino acompanha 5 padrões, nenhum com confiança e impacto suficientes agora"), lido de contagem real de `behavioral_patterns`.
- Home (`AssistantTipCard`) e aba Mais passam a consumir o mesmo `primary_item` canônico.

### D. Antecipações

`anticipation_opportunities` está vazia. O plano inclui: revisar rollout/flags e crons, e homologar **uma oportunidade válida em dry run com fixture controlada** (`upcoming_cash_pressure`), sem alterar dados financeiros reais e sem baixar threshold para preencher a tela.

### E. Backfill corretivo (idempotente e auditável)

Migration de backfill que: reclassifica `temporal_role`, expira conteúdo de junho/julho, agrupa duplicidades, consolida recomendações por tópico, remove itens semanticamente inválidos com `suppression_reason`, corrige títulos contraditórios e preserva histórico. Nenhuma alteração em saldo, transação, conta ou fatura. Rollback via `nino_backfill_rollback`.

### F. Admin e observabilidade

Painel do item em `/admin/nino-ia`: fonte, fatos usados, prioridade e componentes do score, motivo de seleção, motivo de supressão, `logical_topic_key`, validade, exposições, feedback, ação, rota, status e versão da narrativa. Listas de diagnóstico: duplicados, antigos, rotas quebradas, padrões contraditórios, semântica inválida, excesso de itens por usuário.

### G. Testes

Unitários (score, gates, agrupamento, consolidação, direção de padrão, pt-BR, limites por seção), integração (RPC com contexto, erro não vira vazio, refresh nos 4 estados, decisão de duplicidade), contrato de rotas (teste que percorre todos os tipos de ação e confirma que a rota existe no router), E2E mobile/desktop e regressão explícita: "Estornos nunca gera recomendação de corte", "Energia não recebe corte genérico", "fatura/transferência/aplicação/resgate fora de consumo ajustável", "backfill idempotente", "nenhuma alteração de saldo".

## 3. Ordem de execução (rodada única)

1. Migration de schema `nino_contract.v2` (colunas, índices, gates, agrupamento, score, consolidação).
2. Reescrita de `nino_rebuild_items` / `nino_curate_items` e novos RPCs de contrato.
3. Backfill corretivo idempotente + validação SQL antes/depois.
4. Frontend: contratos Zod, hooks, componentes especializados, botão Atualizar, estados.
5. Home + aba Mais + Relatórios no mesmo item canônico.
6. Admin/observabilidade.
7. Antecipação: rollout + homologação dry run.
8. Testes completos + typecheck.
9. Deploy das Edge Functions (`nino-intelligence-tick`, `anticipation-tick`, `insights-generate`) e publicação do frontend.
10. Validação em produção com o usuário Daniel e relatório antes/depois com itens selecionados, suprimidos e motivos.

## 4. Riscos e rollback

- Curadoria agressiva pode suprimir item legítimo → todo descarte grava `suppression_reason` e é auditável; nada é deletado.
- Índice único por tópico pode conflitar em backfill → aplicado após consolidação, com `ON CONFLICT` tratado.
- Rollback: `nino_backfill_rollback` restaura status/prioridade anteriores; flags de rollout permitem voltar ao contrato v1 sem redeploy.

## 5. Critérios de validação em produção

Com o usuário Daniel: 1 item principal + no máximo 3 secundários em "Agora"; duplicidades em um único card agrupado; nenhuma recomendação com rota `/app/nino` auto-referente; uma única "Recalibrar a Meta Financeira"; nenhuma menção a corte em Estornos/Energia; todos os valores em pt-BR; botão Atualizar com resumo real; "Prepare-se" explicando o motor.

Nenhum arquivo do projeto foi alterado nesta etapa — apenas este plano foi escrito.
