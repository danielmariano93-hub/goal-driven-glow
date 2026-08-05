# Plano fechado — Nino Diagnosis v1.1: diagnóstico único, ação real e cards padronizados

Base: HEAD da `main` após o Financial Situation Core v1 (migrations `20260805091213_*` = evaluators, `20260805091440_*` = assembler/projeções). Tudo abaixo foi verificado em código e no banco de produção.

## 1. Diagnóstico do estado atual (verificado)

**Frontend**
- `src/pages/Nino.tsx` consome `useNinoContext()` (`src/lib/nino/intelligence.ts` → RPC `my_nino_intelligence_context`), ou seja, **a aba Nino ainda lê a projeção legada `nino_intelligence_items`**, não o contrato de diagnóstico. `useNinoDiagnosisContext()` (`src/lib/nino/diagnosis.ts`) hoje só é usado por `src/pages/Relatorios.tsx`.
- Cards divergentes por seção: `NinoPrimaryInsightCard` (Agora), `NinoChangeRow` (secundários), `NinoOperationalSummaryCard` (operacional) e `NinoItemCard` (mudanças/aprendizados/prepare-se/histórico) têm raio, tipografia, badges, feedback e CTA próprios.
- `NinoChangeRow` aplica `truncate` em título e subtítulo (linhas 19–25) → é a causa do corte no card de meta em "Também vale saber".
- CTA genérico: `NinoPrimaryInsightCard` usa fallback `"Resolver agora"` (linha 83) e `actionLabel`/`DEFAULT_ACTION_LABEL` em `intelligence.ts` mapeia por `kind`, sem considerar `status`/maturidade da situação — por isso um padrão `observed` recebe "Resolver agora".
- Nav de seções (`Nino.tsx`, `<nav className="-mx-1 ... overflow-x-auto px-1">`) tem padding menor que a margem negativa e nenhum scroll-padding, o que corta o primeiro/último chip.

**Banco / motor**
- `nino_assemble_diagnosis` **apenas ranqueia**: escolhe 1 primária por severidade+score, agrega até `max_supporting` por score, pega 1 ação por prioridade. Não há detecção de conflito, nem narrativa causal combinada, nem lifecycle/timeline.
- `nino_project_diagnosis` reescreve `nino_intelligence_items` e é o que a aba Nino realmente exibe; ele achata a estrutura editorial (`consequence_summary` + `forecast_summary` concatenados em `explanation`) e perde `status` da situação.
- Estado real das situações (`financial_situations`, `run_mode='live'`) mostra **contradição persistida**: duas linhas com o mesmo `situation_key='spending_pace:2026-08'`, uma `worsening` ("Sem categoria explicou 57,31% do aumento", score 77) e outra `improving` ("Seus gastos caíram R$ 3.317,81", score 70). Idem `duplicate_review` com duas linhas de mesma chave. Logo, a chave de upsert de `nino_diag_put_situation` não é única por `(user_id, run_mode, situation_key)`.
- `anticipation_opportunities` está **vazia** (zero linhas). `behavioral_patterns`: 1 `validated` com confiança 0,65 e 4 `candidate` (0,26–0,76). O evaluator 4.10 só lê `anticipation_opportunities` com `status in ('scheduled','ready','revalidating')` e janela 30 dias → sem oportunidades, "Prepare-se" fica vazio mesmo com 5 padrões acompanhados. Nenhum evaluator transforma `recurring_rules`, `credit_card_statements`, `credit_card_installments`, `debts` ou `goals` em situação **futura** (`temporal_scope='future'`); os detectores 4.5/4.8 os leem como pressão do "agora".
- Ação da situação principal: `nino_diag_put_situation(... 'title','Revisar a formação do saldo','route','/app/relatorios' ...)` — explicativa, não acionável.

## 2. Causa raiz por problema observado

| Observado | Causa raiz |
|---|---|
| 2. Parece curadoria de insights antigos | Aba Nino lê a projeção legada, não o snapshot de diagnóstico |
| 3. Cards diferentes por aba | Quatro componentes independentes; falta família compartilhada |
| 4. Leituras contraditórias separadas | Assembler sem regras de conflito + upsert duplicando `situation_key` |
| 5. CTA genérico | Ação criada como "revisar/relatório"; sem ActionSelector |
| 6. "Resolver agora" em padrão | `actionLabel` decide por `kind`, ignorando `status` |
| 7. 5 padrões, 0 antecipações | Nenhuma oportunidade gerada; nenhum evaluator futuro sobre recorrências/faturas/parcelas/metas |
| 8. Histórico como arquivo | Não existe tabela de eventos de ciclo de vida da situação |
| 9. Fechamentos como paredes de texto | `closed_period_summary` renderizado por `NinoItemCard` sem camada resumo/detalhe |
| 10. Truncamento | `truncate` em `NinoChangeRow` |

## 3. Arquitetura final (sem motor paralelo)

```text
Financial Truth (finance_contract.v4)
  -> Evaluators (nino_evaluate_financial_situations)
  -> financial_situations (+ evidence, actions, NOVO: events)
  -> nino_assemble_diagnosis  (conflito + narrativa + ActionSelector)
  -> nino_diagnosis_snapshots (nino_diagnosis_contract.v1.1)
  -> Surfaces: Home, Nino, Relatórios, AgentCore(App/WhatsApp)
  -> nino_project_diagnosis  = PROJECTION-ONLY (compatibilidade/comms)
```
Regras: nenhuma superfície interpreta; `nino_intelligence_items`, `user_insights`, `advisor_reviews` e `pending_proactive_suggestions` permanecem só como projeção/histórico/fila. Nenhum envio proativo novo no WhatsApp nesta fase (`communication_mode` permanece como está).

## 4. Arquivos e migrations a alterar

**Migrations (novas, aditivas)**
1. `nino_diagnosis_v1_1_conflict_and_actions.sql` — unicidade de `situation_key`, resolução de conflito, ActionSelector SQL, campo `one_line_summary`.
2. `nino_diagnosis_v1_1_lifecycle_timeline.sql` — tabela `financial_situation_events` + trigger + timeline no contrato.
3. `nino_diagnosis_v1_1_future_evaluators.sql` — evaluators futuros (recorrências, fatura/parcelas, metas, dívidas, projeção de caixa) e ponte padrão→antecipação.

**Frontend**
- `src/lib/nino/diagnosis.ts` (contrato v1.1, hooks, tipos canônicos)
- `src/lib/nino/actions.ts` (novo — rótulo/intenção derivados de tipo+status)
- `src/components/nino/NinoCardShell.tsx` (novo — base compartilhada)
- `src/components/nino/NinoSituationCard.tsx`, `NinoSupportingSituationCard.tsx`, `NinoPatternCard.tsx`, `NinoAnticipationCard.tsx`, `NinoHistoryEventCard.tsx`, `NinoOperationalTaskCard.tsx`, `NinoClosingSummaryCard.tsx` (novos/derivados dos atuais)
- `src/pages/Nino.tsx` (passa a consumir diagnóstico; nav corrigida)
- `src/components/home/AssistantTipCard.tsx` (Home lê a mesma primária)
- `src/pages/Relatorios.tsx` (remover qualquer leitura local remanescente)
- `src/lib/nino/intelligence.ts` (mantido apenas para operacional/telemetria; `DEFAULT_ACTION_LABEL` deprecado)
- Testes em `src/test/`

**Edge**
- `supabase/functions/_shared/agent/core/AgentCore.ts` (bloco de diagnóstico completo: causa, consequência, forecast, ação, suporte, conflito)

## 5. Alterações propostas por arquivo/função

### 5.1 Situações: chave única e conflito
- `nino_diag_put_situation`: índice único `(user_id, run_mode, situation_key)` + upsert real; `situation_key` de `spending_pace` passa a incluir direção somente quando forem fatos distintos, caso contrário uma única linha com `severity`/`status` recalculados.
- Nova função `nino_diag_resolve_conflicts(_user_id, _run_mode)`: para situações do mesmo domínio (`spending_pace`, `cash_flow`, `category_shift`) marca a de menor score como `role='counterpoint'` (nova coluna `narrative_role`: `primary|support|counterpoint|operational`), nunca suprimindo o sinal positivo.

### 5.2 `nino_assemble_diagnosis` → narrativa causal
- Selecionar primária como hoje; então montar `narrative` no payload:
  `conclusion` (headline primária), `cause` (causa primária + top-1 suporte com maior contribuição), `counterpoint` (situação positiva conflitante, ex. "gastos caíram R$ 3.317,81, mas o consumo ainda supera a renda em R$ 432,67"), `consequence`, `forecast`, `action`.
- Suporte: máximo 3, ordem fixa — (1) causa da primária (mesma família), (2) contraponto, (3) maior impacto restante. `patterns`, `anticipations`, `operational_tasks` seguem em coleções separadas.
- `rationale` passa a registrar `conflict_resolution` e `supporting_roles` para auditoria.

### 5.3 ActionSelector determinístico
- Nova função SQL `nino_diag_select_action(situation)` aplicada na criação/atualização das ações, com mapa por `situation_type` + `status`:
  - `behavioral_pattern` `observed` → "Entender o padrão" (`/app/nino?section=aprendizados`); `confirmed` → "Ver os gastos do padrão" (`/app/lancamentos?...`)
  - `data_quality_issue` → "Classificar lançamentos" (`/app/lancamentos?filtro=sem-categoria`)
  - `goal_feasibility` → "Recalibrar meta" (`/app/metas/{goal_id}`)
  - `cash_flow_imbalance` → "Ver o que mais pressionou o mês" (`/app/relatorios?foco=categorias&periodo=atual`)
  - `card_cycle_pressure` → "Revisar fatura e parcelas" (`/app/cartoes/{card_id}`)
  - `anticipation` → "Planejar agora" (`/app/antecipacoes/{id}`)
  - `duplicate_review` → "Revisar duplicidades"; `spending_pace_change` `improving` → "Ver o que melhorou" (sem CTA de risco)
  - `resolved`/`expired` → sem CTA (apenas leitura)
- Cada ação passa a gravar `estimated_impact` e `explanation` ("por que esta ação").
- Frontend nunca inventa rótulo: `src/lib/nino/actions.ts` só faz fallback seguro por `situation_type+status` e **remove** "Resolver agora".

### 5.4 Padrões → previsão → antecipação
- Definições: padrão = `behavioral_pattern` (histórico); previsão = `forecast_summary`/projeção; antecipação = situação `temporal_scope='future'` com `opportunity_date`, `valid_from`, `valid_until`.
- Novos evaluators futuros, todos determinísticos e sem dependência do motor comportamental:
  - `upcoming_bill_due`: `credit_card_statements` com `due_date` em D+1..D+15 e saldo > 0.
  - `upcoming_installments`: `credit_card_installments` com parcelas nos próximos 30 dias.
  - `upcoming_recurring_load`: `recurring_rules`/`recurring_occurrences` planejadas nos próximos 15 dias vs. saldo projetado.
  - `upcoming_debt_payment`: `debt_payments`/`debts` com vencimento na janela.
  - `goal_contribution_window`: aporte necessário no mês corrente ainda não feito.
- Ponte padrão→antecipação: só quando `behavioral_patterns.status in ('validated','active')` **e** `confidence >= 0.70` **e** `sample_size >= 8` **e** existe janela futura ≤ 14 dias; caso contrário o padrão fica em Aprendizados. Dedup por `situation_key='anticipation:{detector}:{date}'`; revalidação a cada tick; encerramento em `resolved`/`expired` quando a janela passa.
- `anticipation_opportunities` continua sendo fonte quando existir, mas deixa de ser a **única** fonte de "Prepare-se".

### 5.5 Histórico como timeline
- Nova tabela `public.financial_situation_events` (`situation_id`, `event_type` em `detected|confirmed|worsened|improved|resolved|expired|superseded|acted|feedback`, `from_status`, `to_status`, `delta_amount`, `narrative`, `occurred_at`) com GRANTs (`select` para `authenticated`, `all` para `service_role`), RLS por `user_id` e trigger em `financial_situations` que grava a transição.
- Contrato ganha `timeline: [{ situation_key, headline, events[] }]` agrupado por situação; fechamentos (`financial_reports`) entram como marcos anexos, não como itens competindo.

### 5.6 Cards padronizados
- `NinoCardShell`: largura total, raio 22px, padding 20px, `border: var(--home-hairline)`, `background: var(--home-surface)`, slots `badge / headline / metric / body / expandable / actions / feedback`, seção "Como o Nino chegou aqui" fechada, CTA em pílula 46px, cor por semântica (`severity`), tokens do design system (nada hardcoded).
- Todos os cards da família consomem o shell: Agora vira a referência; "O que mudou" usa o mesmo par principal/secundário mudando só a semântica; "Aprendizados" mostra maturidade + evidência + CTA de entendimento; "Prepare-se" mostra data/janela, risco, impacto, confiança e ação preventiva; "Histórico" usa timeline compacta; fechamentos resumem conclusão/causas/variação com detalhes recolhidos.
- Remover `truncate` de `NinoChangeRow` (substituído por `NinoSupportingSituationCard` com `line-clamp-2` só no corpo).
- Nav: `px-4 -mx-4` simétricos + `scroll-px-4` + `snap-x` para não cortar o primeiro/último chip.

### 5.7 Contrato e tipos
- `nino_diagnosis_contract.v1.1` (aditivo, campos novos opcionais): `narrative`, `situation.narrative_role`, `situation.one_line_summary`, `situation.lifecycle`, `action.explanation`, `action.estimated_impact`, `timeline`, `closings`.
- `src/lib/nino/diagnosis.ts` aceita `v1` e `v1.1` (`z.enum`), tornando-se a fonte única de tipos; `NinoItem` em `intelligence.ts` fica restrito a operacional/telemetria e é reexportado como deprecado.

### 5.8 Superfícies
- `AssistantTipCard` (Home) e `Nino.tsx` passam a usar `useNinoDiagnosisContext` (Home: apenas primária + ação; Nino: profundidade completa).
- `AgentCore.ts`: bloco `[DIAGNÓSTICO ATUAL]` com conclusão, causa, contraponto, consequência, forecast, ação e até 3 suportes — nunca reinterpretando.
- `nino_project_diagnosis` mantido como projection-only para `nino_intelligence_items` (compatibilidade de telemetria/exposições).

## 6. Ordem de implementação (etapas atômicas)
1. Migration 1: unicidade + `narrative_role` + `one_line_summary` + `nino_diag_resolve_conflicts` + ActionSelector; recalcular ações existentes.
2. Migration 2: `financial_situation_events` + trigger + backfill do estado atual como `detected`.
3. Migration 3: evaluators futuros + ponte padrão→antecipação + ajuste do 4.10.
4. `nino_assemble_diagnosis` narrativa + contrato v1.1 + `nino_diagnosis_context_for_user` (timeline/closings).
5. `nino_refresh_diagnosis` reexecuta conflito antes do assemble; tick revalida antecipações.
6. Frontend: `diagnosis.ts` v1.1 + `actions.ts`.
7. `NinoCardShell` + família de cards.
8. `Nino.tsx` migrado para diagnóstico (5 abas), nav corrigida.
9. Home e Relatórios na mesma fonte; `AgentCore.ts` com diagnóstico completo.
10. Testes + homologação.

## 7. Migração, compatibilidade e rollback
- Todas as migrations são aditivas; nada é dropado. Contrato v1.1 é superset do v1 e o frontend aceita ambos.
- `nino_diagnosis_config` ganha `assembler_version` (`v1`|`v1_1`); rollback = voltar para `v1` e o assembler antigo continua respondendo.
- `nino_diagnosis_rollback()` existente permanece válido (volta a rollout `shadow`).
- Antes de aplicar a unicidade, deduplicar as linhas conflitantes existentes (`spending_pace:2026-08`, `duplicate_review`) mantendo a de maior `relevance_score` e registrando a outra como `counterpoint`.
- Legado (`user_insights`, `advisor_reviews`, `pending_proactive_suggestions`) intocado, apenas projeção.

## 8. Testes e homologação
Automatizados (`src/test/`, vitest):
- `nino-diagnosis-contract-v1_1.test.ts`: aceita v1 e v1.1, rejeita contrato antigo de detector→card.
- `nino-action-selector.test.ts`: cada `situation_type`+`status` gera rótulo/rota esperados; nenhum caminho produz "Resolver agora"; `observed` de padrão → "Entender o padrão"; `resolved` → sem CTA.
- `nino-card-family.test.ts`: todos os cards importam `NinoCardShell`; nenhum `truncate` em título; nenhuma classe de cor hardcoded.
- `nino-surface-single-source.test.ts`: `Nino.tsx`, `AssistantTipCard.tsx` e `Relatorios.tsx` usam `useNinoDiagnosisContext`.

Homologação SQL/manual (cenários exigidos):
1. gastos caíram, mas consumo > renda → uma conclusão de déficit com contraponto positivo visível;
2. categoria específica explica a piora → aparece como causa, não como item solto;
3. meta pede mais que a sobra → CTA "Recalibrar meta" com rota da meta;
4. fatura + parcelas nos próximos 15 dias → antecipação em "Prepare-se";
5. padrão com confiança baixa → fica em Aprendizados, sem antecipação;
6. padrão confirmado + janela → antecipação válida com `valid_until`;
7. sem evento futuro → empty state verdadeiro (sem citar contadores contraditórios);
8. timeline de uma mesma situação (detectada → piorou → melhorou);
9. Home, Nino, Relatórios, App e WhatsApp com a mesma conclusão e mesmo `snapshot_id`;
10. feedback/ação registram evento de lifecycle sem alterar valores financeiros.

## 9. Critérios de aceite
Técnicos: um único `snapshot_id` corrente por usuário; zero `situation_key` duplicada por `run_mode`; toda ação com rota válida (`safeRoute`) e `explanation`; zero CTA "Resolver agora"; `Nino.tsx` sem `useNinoContext` para inteligência; nenhuma superfície derivando conclusão local; typecheck/lint/testes verdes.
Visuais: cards de todas as abas com mesma largura, raio, padding, badge e CTA; nenhuma informação relevante truncada; abas horizontais com primeiro e último chip inteiros; fechamento com resumo ≤ 3 linhas e detalhes recolhidos; hierarquia conclusão → causa → consequência → ação em todos os cards; mobile 360px sem overflow.

## 10. Riscos e mitigação
- **Deduplicar situações pode apagar leitura válida** → dedup preserva a segunda linha como `counterpoint`, nunca `delete`.
- **Evaluators futuros gerando falso positivo** → limiares mínimos (valor, janela, confiança) + `valid_until` curto + dedup por chave; começar com `communication_mode` desabilitado (só app).
- **Migração da aba Nino para o diagnóstico perder itens operacionais** → operacional continua vindo de `operational_tasks` do próprio contrato.
- **Regressão de telemetria/exposição** (hoje baseada em `nino_intelligence_items.id`) → projection-only mantida; exposições passam a enviar `situation_id` com fallback ao item projetado.
- **Contrato quebrando Relatórios** → v1.1 aditivo e aceito por `z.enum(["v1","v1.1"])`.

## 11. Correção necessária vs. evolução futura
Correção necessária (este escopo): conflito/unicidade, ActionSelector, migração da aba Nino para o diagnóstico, família de cards, truncamento e nav, evaluators futuros mínimos, timeline de situações, AgentCore com diagnóstico completo.
Evolução futura (fora deste escopo): envio proativo no WhatsApp das antecipações, aprendizado de peso por feedback (`relevance_score` adaptativo), narrativa gerada por LLM sobre o snapshot, backtest histórico da timeline, desativação definitiva de `nino_intelligence_items`.
