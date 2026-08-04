# Plano único e fechado — Uma inteligência, várias superfícies (aba Mais, Nino, Relatórios)

## 1. Diagnóstico do estado atual (verificado no HEAD e na produção)

Rotas hoje em `src/App.tsx`: `relatorios`, `relatorios-inteligentes`, `relatorios-inteligentes/:id`, `assessor`, `assessor/acompanhamento` (→ `NinoHub`), `nino-contexto`, `antecipacoes`, `alertas/:dedupKey`, `notificacoes`. Não existe rota `/app/pulso` — o Pulso aparece só como `PulseHero` (componente Home) via `usePulse` → Edge Function `pulse-compute`; a aba Mais **não** lista Pulso.

Superfícies que respondem à mesma pergunta com motores diferentes:

| Superfície | Fonte | Texto gerado por |
|---|---|---|
| Home `AssistantTipCard` | `user_insights` (56 linhas, apenas **4 ativas**) + `buildAssistantFacts` (cálculo local) + `src/lib/insights/fallbacks.ts` | motor de insights + fallback local |
| `NinoHub` → `AssessorAcompanhamentoV2` | RPC `my_nino_context` + `my_advisor_readiness` → `advisor_reviews` (10) | narrativa do advisor |
| `Antecipacoes.tsx` | consulta direta a `behavioral_patterns` (5) e `anticipation_opportunities` (**0**) | copy da antecipação + labels técnicos na superfície |
| `Relatorios.tsx` | snapshot + `computeCashBridge` + `spendingHighlights` local (regex de categoria essencial/flexível) | highlights locais no frontend |
| `RelatoriosInteligentes` / detalhe | `financial_reports` (8) + `reports/intelligent/highlights.ts` + `narrative.ts` | terceiro pipeline de narrativa |
| WhatsApp / notificações | `communication_catalog/templates/deliveries` (56), `notifications` (35), `pending_proactive_suggestions` (39) | quarto pipeline |

Crons ativos relacionados: `insights-generate-hourly`, `agent-proactive-hourly`, `financial-reports-weekly/monthly`, `anticipation-facts-nightly`, `anticipation-dispatch-15m`, além dos crons de split/WhatsApp.

Problemas confirmados:
1. Quatro pipelines de narrativa independentes (`spendingHighlights`, `reports/intelligent/highlights+narrative`, `insights/fallbacks`, advisor review, copy de antecipação).
2. Home fica “sem dicas” porque depende de `user_insights` ativos (só 4), mesmo existindo 10 reviews, 8 relatórios e 5 padrões.
3. `anticipation_opportunities` e `anticipation_outcomes` estão vazias → seção “Prepare-se” nasceria vazia; o motor existe (`cashPressure.ts`, `outcomes.ts`) mas nunca produziu item aprovado.
4. `Antecipacoes.tsx` expõe `detector`, `confidence` decimal, `sample_size` e `block_reasons` na superfície principal.
5. `Relatorios.tsx` calcula highlights e buckets no cliente; `RelatoriosInteligentes` calcula outro conjunto no motor de relatórios.
6. Aba Mais faz várias consultas independentes e nenhum card é dinâmico; Desafios está em destaque fixo; “Organizar” vem antes de “Entender”.
7. Não há `last_seen_at` por seção, nem `unread_count`, nem continuidade entre visitas.

Camada financeira: `finance_contract.v4` (`src/lib/engine/metrics.ts`) + `financial_snapshot_contract.v5` já é canônica e **não será alterada** — nenhum número financeiro muda.

## 2. Arquitetura alvo

```text
finance_contract.v4 (verdade financeira, intocada)
        │
        ▼
financial_insight_facts        ← fatos derivados auditáveis (sem copy)
        │
        ▼
nino_intelligence_items        ← artefato canônico único (com narrativa aprovada)
        │
   NinoRelevanceOrchestrator   ← ranking por superfície/canal
        │
 ┌──────┼───────┬───────────┬────────────┬──────────┐
Home   /app/nino  Relatórios  Notificações  WhatsApp  Admin
```

Fontes atuais (`user_insights`, `advisor_reviews`, `financial_reports`, `behavioral_patterns`, `anticipation_opportunities`, `pending_proactive_suggestions`) passam a ser **produtoras/adaptadores**, nunca fontes de leitura das telas.

## 3. Modelo de dados e migrations

Migration `20260805_nino_intelligence_core.sql`:

1. `public.financial_insight_facts` — campos exatamente como no pedido (`period_start/end`, `as_of`, `fact_type`, `metric_key`, `current_value`, `comparison_value`, `absolute_delta`, `percentage_delta`, `category_id`, `merchant_normalized`, `transaction_ids uuid[]`, `evidence jsonb`, `coverage`, `confidence`, `formula_version`, `source_snapshot_id`, `valid_from/until`, timestamps). Único: `(user_id, fact_type, metric_key, period_start, period_end, coalesce(category_id,…), coalesce(merchant_normalized,''))`.
2. `public.nino_intelligence_items` — campos do pedido; enums `nino_item_kind`, `nino_temporal_role`, `nino_item_status`; único `(user_id, dedup_key)`; FKs opcionais para `behavioral_patterns`, `financial_reports`, `anticipation_opportunities`, `advisor_reviews`.
3. `public.nino_narrative_catalog` — `kind`, `variant` (short/medium/detailed), `title_template`, `body_template`, `tone`, `caution_level`, `default_cta_label/route`, `required_evidence text[]`, `allowed_terms/forbidden_terms text[]`, `allowed_channels text[]`, `narrative_version`, `active`.
4. `public.nino_item_exposures` — `item_id`, `surface`, `rank`, `selection_reason`, `blocked_reason`, `shown_at`, `acted_at`, `feedback`, `channel`, `outcome`.
5. `public.nino_surface_state` — `user_id`, `surface`, `section`, `last_seen_at`, `last_item_id`, `continuity_topic`.
6. GRANTs em todas (authenticated conforme política + `service_role` ALL), RLS `user_id = auth.uid()` e políticas de escrita apenas por `service_role`; `nino_narrative_catalog` com `GRANT SELECT` a `authenticated` e escrita só admin.
7. Triggers `_touch_updated_at` em todas as tabelas com `updated_at`.
8. Flags em `financial_feature_flags`: `nino_unified_intelligence`, `nino_home_orchestrator`, `reports_unified`, `more_menu_v2` (criadas ligadas para os 2 usuários reais, com kill switch).

## 4. RPCs

- `my_more_menu_context()` → `split_summary`, `report_summary`, `nino_summary`, `uncategorized_count`, `recurring_summary`, `debt_summary`, `investment_summary`, `active_challenge`, `updated_at`. Uma única chamada para a aba Mais.
- `my_nino_intelligence_context(_section text default null)` → `{updated_at, now, changes, patterns, anticipations, history, data_quality, primary_action, unread_count, continuity}`; padrões já traduzidos (`maturity`, `plain_language_reason`, `next_validation_condition`, `evidence_summary`), com bloco `how_we_calculate` separado contendo threshold/confidence/sample.
- `my_nino_home_item()` → item principal + até 2 secundários, com fallback em cascata (risco → pendência → mudança → padrão → conquista → qualidade de dados → continuidade → estabilidade).
- `my_reports_current_context(_start date, _end date)` → resumo executivo + fatos + comparação + ações, derivados de `nino_intelligence_items`/`financial_insight_facts` (sem highlights locais).
- `my_nino_mark_seen(_surface text, _section text)`; `my_nino_item_feedback(_item_id uuid, _feedback text)`; `my_nino_item_act(_item_id uuid)`.
- Admin: `admin_v2_nino_item_trace(_item_id uuid)` → fatos, fórmula, ranking, exposições, canais, feedback, resultado; `admin_v2_nino_surface_health()` → por que a Home ficou vazia.

Todas `security definer`, `set search_path = public`, escopadas em `auth.uid()` (exceto admin via `_require_perm`).

## 5. Serviços backend (Edge / `_shared`)

Novo diretório `supabase/functions/_shared/nino/`:

- `facts.ts` — deriva `financial_insight_facts` do snapshot canônico (`finance-core`), sem fórmulas novas: gasto x período anterior, contribuição por categoria/comerciante, cartão vs ritmo, formação do saldo, dívida, qualidade de dados, pendências de split, maturidade de padrão.
- `items.ts` — converte fatos + fontes legadas em `nino_intelligence_items`, aplicando `dedup_key` e validade.
- `narrative.ts` — renderiza a narrativa a partir do `nino_narrative_catalog`; responde às 5 perguntas obrigatórias; guardrails numéricos reutilizando `numericGuard`; IA só seleciona/resume variante aprovada (proibido criar número, período, causalidade ou ação).
- `orchestrator.ts` — `NinoRelevanceOrchestrator` com os critérios do pedido; retorna ranking + `selection_reason`/`blocked_reason` por superfície (home/nino/reports/whatsapp/notifications) e grava `nino_item_exposures`.
- `adapters/` — `fromUserInsights.ts`, `fromAdvisorReviews.ts`, `fromFinancialReports.ts`, `fromBehavioralPatterns.ts`, `fromAnticipations.ts`, `fromProactiveSuggestions.ts`.

Nova Edge Function `nino-intelligence-tick` (stages: `facts`, `items`, `narrative`, `expire`), idempotente, com `EdgeRuntime.waitUntil` e envelope de erro padrão. Funções existentes (`insights-generate`, `financial-reports-generate`, `anticipation-tick`, `agent-proactive-tick`, `pulse-compute`, `agent-chat`) passam a **escrever** itens canônicos via `items.ts` em vez de criar copy própria; `agent-chat`/WhatsApp lê itens do orquestrador com canal `whatsapp`.

Cron novo: `nino-intelligence-30m` (`*/30`), mais `nino-intelligence-nightly` (após `anticipation-facts-nightly`). Nenhum cron existente é removido nesta rodada.

## 6. Backfill

Script idempotente `nino_backfill_items` (RPC admin + stage do tick), com `--dry-run`, retomada por cursor e `rollback` por `source` (delete de itens com `created_by='backfill'`): converte `user_insights`, `advisor_reviews`, `financial_reports` (+highlights), `behavioral_patterns`, `anticipation_opportunities`, `pending_proactive_suggestions` em itens canônicos, preservando IDs de origem, respeitando validade, sem gerar `communication_deliveries` nem enviar WhatsApp (guard explícito `dispatch=false`), e sem tocar em `transactions`/saldos. Métricas gravadas em `nino_item_exposures`/log de execução.

## 7. Frontend

**Nova aba Mais** (`src/pages/MaisMenu.tsx`, consumindo só `my_more_menu_context`):
1. Em destaque: **Divisão do Rolê** (pagamentos pendentes, a receber, comprovantes aguardando confirmação, próximo ponto de atenção) e **Relatórios** (relatório atual, último fechamento, principal highlight, status de leitura, nº de ações). Desafios sai do destaque.
2. Entender meu dinheiro: **Nino** (descrição dinâmica: “2 mudanças desde sua última visita”, “1 antecipação para hoje”, “nada urgente mudou”), **Movimentos e categorias**. Pulso **não** volta como tela: seu conteúdo já é resumo de inteligência e passa a ser bloco dentro de `/app/nino` (o `PulseHero` da Home permanece).
3. Organizar meu dinheiro: Contas e cartões (entrada agrupada, telas internas mantidas), Recorrências, Dívidas, Investimentos, Categorias — com estado dinâmico só quando útil.
4. Outros recursos: Antes de comprar, Desafios (destaque contextual apenas com desafio ativo/progresso/recomendação), Emocional, Importar dados.
5. Conta e preferências: Perfil, Notificações, Integrações, Configurações; Sair separado e discreto.

**Nova experiência Nino** — `src/pages/Nino.tsx` + `src/components/nino/` (`NinoAgoraCard`, `NinoChangesList`, `NinoPatternsList`, `NinoPrepareList`, `NinoHistoryList`, `HowWeCalculateSheet`, `NinoEmptyState`, skeletons). Seções: Agora, O que mudou (máx. 3), O que o Nino aprendeu (Aprendendo/Em observação/Confirmado, linguagem humana, thresholds só em “Como calculamos”), Prepare-se (só oportunidade válida; estado vazio explicativo), Histórico (highlights, antecipações enviadas, recomendações, ações, feedback, resultado). Preferências de antecipação (`AnticipationPreferencesCard`) migram para cá. `AssessorAcompanhamentoV2` e `Antecipacoes.tsx` deixam de ser páginas: viram componentes internos/legado removido do menu.

**Relatórios unificados** — `src/pages/Relatorios.tsx` com tabs `Atual` e `Fechamentos` (`?tab=`). Atual consome `my_reports_current_context` + snapshot; `spendingHighlights` é removido da renderização (função mantida apenas até o teste de paridade, depois deletada). Fechamentos absorve `RelatoriosInteligentes`. Detalhe passa a `/app/relatorios/:reportId`. Nomenclatura “Relatórios inteligentes” eliminada da UI e de `copy/strings.ts`.

**Home** — `AssistantTipCard` passa a consumir `my_nino_home_item` (com flag `nino_home_orchestrator`), com fallback em cascata; `buildAssistantFacts` e `insights/fallbacks` deixam de decidir conteúdo (mantidos como último recurso offline até a validação). Nunca mais “Sem dicas novas” havendo item relevante.

**Rotas e redirects** (`src/App.tsx`):
- `/app/nino` (nova), `/app/relatorios?tab=`, `/app/relatorios/:reportId`.
- `/app/assessor/acompanhamento` → `/app/nino`
- `/app/antecipacoes` → `/app/nino?section=prepare-se`
- `/app/relatorios-inteligentes` → `/app/relatorios?tab=fechamentos`
- `/app/relatorios-inteligentes/:id` → `/app/relatorios/:id`
- `/app/alertas/:dedupKey` continua e ganha link para o item canônico.
- `appUrl.ts` (deep links de WhatsApp/notificações) atualizado mantendo os antigos válidos.

## 8. Design system e estados

Tokens adicionados em `src/index.css` + `tailwind.config.ts` como variáveis HSL semânticas (nunca hex em componentes): `--nino-purple-700/600/100/50`, `--ink-900/700/500`, `--border`, `--background`, `--positive(-soft)`, `--attention(-soft)`, `--critical(-soft)`, `--information(-soft)` com os valores informados. Cards radius 22–24px, borda 1px, sombra discreta, padding 18–20px; listas agrupadas em container único com divisórias, linhas 68–76px, ícone 38px, chevron pequeno. Proibido: degradê generalizado, borda grossa, muitos badges, gráfico na primeira dobra, linguagem de threshold.

Skeletons estruturais (`src/components/nino/skeletons.tsx`, aba Mais e Relatórios) substituem spinners centrais; conteúdo anterior é preservado com selo “Atualizando”. Estados vazios explicam o que foi analisado, por que está vazio, quando muda e o que fazer.

## 9. Observabilidade

Cadeia rastreável fato → item → ranking → superfície → visualização → ação → feedback → resultado via `financial_insight_facts.id` ↔ `nino_intelligence_items.facts` ↔ `nino_item_exposures`. Nova seção no Admin (`src/pages/admin/NinoIA.tsx`): busca de item, trilha completa, motivo de seleção/bloqueio, superfícies, canais, feedback e resultado, além do diagnóstico “por que a Home ficou vazia”.

## 10. Testes

Vitest (somando à suíte atual de 989): paridade de valor/evidência/ação/validade entre Home, Nino e Relatórios para o mesmo fato; ausência de cálculo local de highlights; orquestrador (ranking, fadiga, fallback em cascata, cap por canal); narrativa (5 perguntas, termos proibidos, sem número inventado); tradução de padrões; validade de oportunidade; `my_more_menu_context` (split/relatório dinâmicos, Desafios fora do destaque, ordem Entender→Organizar); redirects legados; backfill idempotente/sem envio/rollback; regressão de Home, Movimentos, Cartões, Contas, Dívidas, Investimentos, Recorrências, Divisão do Rolê, WhatsApp, Relatórios, notificações e admin. `deno check` nas funções novas.

## 11. Ordem exata de execução (rodada única)

1. Migration `nino_intelligence_core` (tabelas, enums, RLS, GRANTs, flags) + seed do `nino_narrative_catalog`.
2. `_shared/nino/*` (facts, items, narrative, orchestrator, adapters) + Edge `nino-intelligence-tick`.
3. RPCs (`my_more_menu_context`, `my_nino_intelligence_context`, `my_nino_home_item`, `my_reports_current_context`, seen/feedback/act, admin trace).
4. Adaptar `insights-generate`, `financial-reports-generate`, `anticipation-tick`, `agent-proactive-tick`, `agent-chat` para escrever itens canônicos.
5. Backfill dry-run → backfill real (sem dispatch) → conferência de contagens.
6. Frontend: tokens/design system → `/app/nino` → Relatórios unificados → aba Mais → Home no orquestrador → redirects.
7. Crons `nino-intelligence-30m` e `nino-intelligence-nightly`.
8. Testes + typecheck + `deno check`.
9. Deploy das Edge Functions; publicação do frontend (com autorização explícita, conforme a regra do projeto).
10. Validação em produção com os 2 usuários reais: Mais dinâmica, Nino com 5 seções preenchidas, Relatórios com números idênticos ao snapshot, links antigos, WhatsApp e notificações; relatório final antes/depois.

## 12. Rollout e rollback

Flags `nino_unified_intelligence`, `nino_home_orchestrator`, `reports_unified`, `more_menu_v2`: desligar qualquer uma restaura a superfície anterior (código legado permanece atrás da flag nesta rodada). Rollback de dados = `nino_backfill_rollback` (itens de backfill) sem tocar nas fontes legadas. Nenhuma tabela legada é apagada; a descontinuação de `user_insights` como fonte primária da Home, das rotas separadas e da nomenclatura “Relatórios inteligentes” acontece por flag, com remoção física do código morto no fim desta mesma rodada apenas para o que os testes de paridade cobrirem.

## 13. Arquivos afetados (principais)

Novos: migration; `supabase/functions/_shared/nino/*`; `supabase/functions/nino-intelligence-tick/index.ts`; `src/pages/Nino.tsx`; `src/components/nino/*`; `src/lib/nino/intelligence.ts`; `src/lib/more/context.ts`; testes.
Editados: `src/App.tsx`, `src/pages/MaisMenu.tsx`, `src/pages/Relatorios.tsx`, `src/pages/RelatoriosInteligentes.tsx` (→ tab), `src/pages/RelatorioInteligenteDetalhe.tsx`, `src/pages/Antecipacoes.tsx` (→ componente), `src/pages/AssessorAcompanhamentoV2.tsx`, `src/pages/NinoHub.tsx` (→ redirect), `src/components/home/AssistantTipCard.tsx`, `src/components/BottomTabBar.tsx`, `src/components/DesktopSidebar.tsx`, `src/lib/copy/strings.ts`, `src/lib/reports/aggregations.ts`, `src/lib/insights/fallbacks.ts`, `src/lib/nino/client.ts|contracts.ts`, `src/index.css`, `tailwind.config.ts`, `src/pages/admin/NinoIA.tsx`, `supabase/config.toml`.

Nenhum arquivo de `src/lib/engine/*` (verdade financeira) é alterado.
