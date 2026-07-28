> Verificações feitas no banco real antes deste plano (leituras somente): `cron.job` (7 jobs, nenhum chama `agent-proactive-tick`), `agent_settings.proactive_enabled = false`, `pending_proactive_suggestions` (9 `duplicate_expense` + 1 `goal_at_risk` em `pending`, nenhum `dispatched`), `communication_deliveries` (4 linhas, todas de `advisor_review_*`), `behavior_hypotheses` (0), `advisor_reviews` (2 linhas, **todas do usuário de teste `7f18c7ba…`**, nenhuma do usuário real), `agent_memory` (13 linhas, várias com `{"category": null, ...}` e 2 com payload técnico de review), `user_insights` (25 linhas, 25 do tipo categorização, 10 com `not_useful`), `transactions` com `category_id IS NULL` = 19, `category_source` preenchido = 0, `user_edited_at` preenchido = 0, `merchant_aliases` = 48.

# 1. Diagnóstico técnico — causa raiz por problema

| # | Problema relatado | Veredito | Causa raiz confirmada |
|---|---|---|---|
| — | Motor nunca roda | **Confirmado** | Não existe cron para `agent-proactive-tick` (os 7 jobs existentes são documentos, split, produto, whatsapp-send, sweep). Além disso `proactive_enabled=false` faz a função retornar `disabled` sem `force`. As 10 sugestões pendentes foram criadas por execuções manuais e nunca despachadas. |
| 1 | Tela "O que o Nino sabe" mostra JSON cru | **Confirmado** | `src/pages/NinoContexto.tsx` renderiza `memory.key` normalizado por regex e edita `JSON.parse(draft)`. Não há camada de apresentação por tipo de memória. Pior: memórias operacionais (`weekly:2026-07-27`, `monthly:2026-07-01`, com payload inteiro da review) estão na mesma listagem. |
| 2 | Memórias desatualizadas com `category:null` | **Confirmado** | 8 de 13 memórias têm `{"category": null}`. `MemoryStore` grava snapshot no momento do lançamento e nada reconcilia depois que a transação/alias ganha categoria. Não há trigger nem job de reconciliação. |
| 3 | "Acompanhamento" vazio com "está sendo preparada" | **Confirmado** | O usuário real tem 0 linhas em `advisor_reviews`; as 2 existentes são do usuário de teste. `generateAdvisorReviews` só roda dentro de `agent-proactive-tick`, que não tem cron. A UI não distingue "nunca gerada" de "em processamento" e não oferece botão de geração. |
| 4 | Categorização aprende pouco | **Confirmado** | `_shared/categorization/pipeline.ts` casa alias por **igualdade exata** de `normalizedPattern`, histórico exige `>=3` ocorrências do padrão exato e as regras são 8 regex fixos. Não há fuzzy/token-overlap, nem uso de correções manuais como sinal. |
| 5 | `category_source/reason/confidence/user_edited_at` inconsistentes | **Confirmado (pior que o relatado)** | 0 transações com `category_source` preenchido e 0 com `user_edited_at`. As colunas existem mas o caminho de escrita canônico (`commitMovement` / edição manual) não as popula; só o pipeline documental as usaria. |
| 6 | Dica de categorização volta após "Agora não" | **Confirmado** | `insights-generate/index.ts` linhas 197–219: sempre que existe qualquer `uncategorized_tx`, retorna **antes** da IA um card de categorização. E em `force=true` (linhas 148–151) dispensa todos os ativos e gera outro na hora — só evita repetir a transação do último insight ativo (`previousTxId`), que acabou de ser dismissado. Não existe cooldown por transação nem consumo de `feedback='not_useful'` (10 registros ignorados). |
| 7 | Dois sistemas paralelos | **Confirmado** | `user_insights` (+ `insights-generate`) e `pending_proactive_suggestions` → `communicationPolicy` → `communication_deliveries` → `notifications` são pipelines independentes: política de dedup/frequência e feedback só existem no segundo; o Admin (`admin_v2_proactive_summary`) só enxerga o segundo. |
| 8 | Admin proativo é só analytics | **Confirmado** | `src/pages/admin/ComunicacaoProativa.tsx` (231 linhas) consome apenas a RPC de resumo; não há catálogo, templates, prévia, simulação, fila, kill switch nem status do cron. |
| — | Bônus encontrado | **Novo** | Nas 2 reviews existentes, `indicators` = todos zero (`estimated_income: 0`, `net_worth: 0`, `months_observed: 0`) com headline "orçamento equilibrado". `AdvisorReviewService` está produzindo revisão vazia porém convincente — risco de alucinação numérica. Entra como P0.

---

# 2. Arquitetura-alvo e decisão sobre unificação

**Decisão: unificar por baixo, preservar as duas tabelas.** Não migramos `user_insights` para `pending_proactive_suggestions` (quebraria Home, feedback e histórico). Em vez disso criamos uma **camada única de política e feedback** que ambos os produtores obrigatoriamente atravessam.

```text
 PRODUTORES                CAMADA ÚNICA                    SUPERFÍCIES
 ---------------------     ------------------------        ----------------
 InsightsEngine      \                                  /  Home (Dicas)
 ProactiveDetectors   \    communication_policy_v2      /   Notificações
 BehaviorDetectors     >-- (elegibilidade, dedup,   ---<    WhatsApp (fila
 AdvisorReviewService /     cooldown, cap, diversidade)\    existente)
 insights-generate   /      + communication_feedback    \   Admin
                                                          
                    grava sempre em communication_ledger
                    (view unificada sobre as 2 tabelas)
```

Peças:
- **`communication_catalog`** (nova tabela): 1 linha por `kind` — rótulo humano, família (categorização/metas/evolução/recorrências/gastos/emoções/alertas), ativo, prioridade base, canais permitidos, cooldown, cap, público elegível, exige aprovação manual, é determinístico ou template.
- **`communication_feedback`** (nova tabela): fonte única de `useful | not_useful | dismissed | acted`, referenciando `(source_table, source_id, kind, dedup_key)`. `user_insights.feedback` continua sendo escrito por compatibilidade, mas o motor lê a tabela nova.
- **`v_communication_ledger`** (view): `UNION ALL` de `user_insights` e `communication_deliveries` normalizados em `(user_id, kind, family, channel, status, dedup_key, created_at, feedback)`. É a fonte do Admin e das regras de frequência/diversidade — resolve "o feedback e as métricas do Admin não representam tudo".
- **Fila de mensagens**: nenhuma nova. Continua `outbound_messages` + `whatsapp-send-dispatch-1m`.
- **Orquestração**: um único cron chamando `agent-proactive-tick`, que já encadeia perfil → comportamento → reviews → scan → dispatch.

---

# 3. Plano faseado

## P0 — Motor vivo, revisões reais, dicas que não repetem (maior valor imediato)

### P0.1 Ativação e orquestração
- Migration aditiva: `cron.schedule('agent-proactive-tick-hourly', '17 * * * *', ...)` via `net.http_post` com header `x-cron-secret` (usa `INTERNAL_CRON_SECRET`, com fallback já implementado). Job criado **inativo** (`active=false`) e ligado só após smoke.
- Migration em `agent_settings`: colunas `proactive_channels text[] default '{app}'`, `proactive_rollout_user_ids uuid[]`, `last_tick_at`, `last_tick_duration_ms`, `last_tick_users`, `last_tick_errors jsonb`, `next_tick_at`. `proactive_enabled` continua o kill switch global.
- `agent-proactive-tick/index.ts`: 
  - respeita `proactive_channels` — enquanto for só `{app}`, `CommunicationDispatcherV2` marca WhatsApp como `suppressed/reason=rollout_app_only` (não envia, mas registra). **Esta é a garantia de "não disparar WhatsApp indevidamente".**
  - respeita `proactive_rollout_user_ids` quando não vazio;
  - grava telemetria de execução em `agent_settings` + `job_heartbeats`;
  - `dry_run: true` no body para simulação sem persistir entregas.
- **Processar a conta real agora**: RPC `admin_proactive_run_now(_user_id uuid, _dry_run bool)` (SECURITY DEFINER, exige permissão admin) que chama a função via `net.http_post` — botão no Admin, sem esperar cron. Idempotência: `pending_proactive_suggestions` já tem `onConflict user_id,dedup_key`; adicionamos unique em `communication_deliveries (user_id, channel, dedup_key)` com `ON CONFLICT DO NOTHING`.
- Backfill: primeira execução em lotes de 25 usuários, `channels={app}`, sem WhatsApp.

Arquivos: `supabase/functions/agent-proactive-tick/index.ts`, `_shared/agent/core/CommunicationDispatcherV2.ts`, `_shared/intelligence/communicationPolicy.ts`, nova migration `..._proactive_orchestration.sql`.

### P0.2 Dicas do Nino — parar o loop
- `insights-generate/index.ts`:
  - remover o *short-circuit* incondicional de categorização (linhas 197–219). Categorização passa a ser **um candidato entre outros**, com peso reduzido se já houve dica de categorização nas últimas 48h.
  - remover o `update status='dismissed'` em massa no `force`; `force` passa a significar "quero outra dica **de outro assunto**", nunca gerar imediatamente após dismiss (janela mínima de 30 min por usuário, exceto ação explícita "ver outra dica" que respeita diversidade).
  - "Agora não" (`dismiss`) → cooldown de 7 dias para aquele `dedup_key`; `not_useful` → 30 dias para o `kind` inteiro e -50% de prioridade permanente naquele `kind` para o usuário.
  - `dedup_key` determinístico por dica: `categorize:{transaction_id}`, `goal_pace:{goal_id}`, etc.
  - **Diversidade obrigatória**: no máx. 1 dica da mesma família em 72h; roda um seletor que ordena por `prioridade_base × recência × penalidade_feedback` sobre `v_communication_ledger`.
  - **Auto-encerramento**: ao categorizar a transação, insights ativos com `evidence.transaction_id = X` viram `status='resolved'` (trigger em `transactions` ou no caminho de escrita de categoria).
- Migration: colunas `dedup_key`, `family`, `resolved_at` em `user_insights`; tabela `communication_feedback`; view `v_communication_ledger`.

Arquivos: `supabase/functions/insights-generate/index.ts`, `_shared/insights/fallbacks.ts`, `_shared/intelligence/communicationPolicy.ts`, `src/components/home/AssistantTipCard.tsx`.

### P0.3 Acompanhamento do Nino
- Nova Edge Function **não**; reaproveitar `agent-run`/nova rota `nino-context` já existente + RPC `advisor_review_generate(_period text)` chamando a mesma lógica? → Decisão: expor `POST /functions/v1/agent-proactive-tick` com `{ user_id, only: ["advisor"] }` restrito ao próprio usuário via JWT, para "Gerar/Atualizar revisão" sob demanda. Cooldown: semanal 24h, mensal 72h (coluna `last_generated_at` em `advisor_reviews`).
- `AdvisorReviewService.ts`: **guarda de dados mínimos** — exige ≥ 20 lançamentos confirmados no período e ≥ 1 mês observado; se não atingir, grava `status='insufficient_data'` com os critérios faltantes em vez de headline genérica com indicadores zerados (bug encontrado).
- `AssessorAcompanhamento.tsx`: três estados distintos — **sem dados suficientes** (lista os critérios), **pronta para gerar** (botão), **gerando** (só quando existe job real em andamento). Mostra "atualizada em <data>". Ações preservam `status` na regeneração via merge por `action.key`.

Arquivos: `_shared/agent/core/AdvisorReviewService.ts`, `src/pages/AssessorAcompanhamento.tsx`, `src/lib/nino/client.ts`, `contracts.ts`, migration aditiva em `advisor_reviews`.

## P1 — Categorização aprendiz e Nino Contexto humano

### P1.1 Categorização
- `_shared/categorization/normalize.ts`: normalização robusta (remove `*`, sufixos de adquirente, códigos numéricos, cidade/UF, acentos, `pix `/`tef `/`compra `), gera `pattern` + `tokens`.
- `pipeline.ts`: novos estágios entre `history` e `rule`:
  - **alias fuzzy**: token-overlap Jaccard ≥ 0.8 sobre `merchant_aliases` (48 linhas disponíveis) → conf 0.88;
  - **histórico por token**: ≥ 2 correções manuais do usuário com mesmo token dominante → conf 0.9;
  - **similaridade** com limiar duplo: ≥ 0.85 aplica, 0.6–0.85 vira **sugestão** (`category_suggested_id`), nunca aplica silenciosamente.
- **Guarda de movimentos especiais**: bloquear recategorização quando `movement_kind` ∈ {transfer, card_bill_payment, investment_in/out, loan_*} ou `transfer_group_id`/`settles_card_id` presentes ou origem `split`. Implementado como função pura compartilhada + `CHECK`-equivalente em trigger.
- **Escrita canônica**: `src/lib/db/commitMovement.ts` e a edição manual passam a preencher `category_source`, `category_reason`, `category_confidence`, `previous_category_id`, `user_edited_at`. Edição manual sempre `source='user'`, `confidence=1`.
- **Reaplicação retroativa**: ao corrigir manualmente, RPC `recategorize_similar(_pattern, _category_id, _limit)` mostra prévia ("15 lançamentos parecidos"), aplica só com confirmação e registra `previous_category_id` para rollback.
- **Os 19 lançamentos sem categoria** (relatados como 9): script de backfill em 3 faixas — (a) alias/histórico com conf ≥ 0.85 → aplica com `source='alias|history'`; (b) 0.6–0.85 → cria sugestão, não aplica; (c) < 0.6 → permanece sem categoria e entra na fila de dicas com cooldown. **Nenhuma categoria inventada.**

### P1.2 Nino Contexto
- Reescrita de `NinoContexto.tsx` + camada de apresentação `src/lib/nino/memoryPresenter.ts`:
  - agrupamento em **Preferências, Estabelecimentos, Categorias, Hábitos, Objetivos, Confirmações**;
  - frase humana por tipo: `souk4u {"category":null,"last_amount":11.89}` → *"Você costuma gastar na Souk4U — última compra R$ 11,89. Ainda sem categoria."*;
  - **memórias técnicas** (`weekly:*`, `monthly:*`, payloads de review, chaves de sistema) recebem `visibility='internal'` e somem da tela — aparecem só no Admin;
  - memórias com `confidence < 0.6` ou sem uso em 90 dias vão para "Menos relevantes" (colapsado);
  - **edição por formulário**: categoria via `CategorySelect`, apelido do estabelecimento por texto, toggle "isso não é verdade". `JSON.parse` sai da UI de usuário.
  - explica origem (`inferido pelos seus lançamentos` / `você confirmou`), confiança em linguagem e impacto ("usado para categorizar automaticamente").
- **Reconciliação de memória**: job dentro do tick + hook pós-alteração de categoria que atualiza `agent_memory.value.category` a partir de `merchant_aliases`/última transação — resolve os 8 `category:null`. Hipóteses `pending` continuam proibidas de virar memória (guarda já existente em `BehaviorService`).

## P2 — Admin operacional
- `communication_catalog` editável: por `kind` → ativo, prioridade, canais, frequência, cooldown, público elegível, aprovação manual.
- `communication_templates` (app/whatsapp) com variáveis permitidas por `kind`, validação de placeholders desconhecidos e **prévia por canal** renderizada com dados fictícios.
- Painel de motor: ligado/desligado, última execução, próxima (`cron.job` + `agent_settings`), duração, usuários processados, erros por estágio.
- Fila e bloqueios: pendentes, entregues, suprimidos com `reason` legível (`quiet_hours`, `weekly_frequency_cap`, `rollout_app_only`…).
- Simulação: usuário específico, `dry_run=true`, mostra o que seria enviado sem gravar nem enviar.
- Aprovação manual para `kind` sensíveis (emocionais) antes do dispatch.
- Métricas por tipo: entregues, úteis, não úteis, ação, custo (`cost_usd` já existe).
- Rótulo explícito por tipo: **determinístico | template | personalizado por IA**.
- Permissões via `_require_perm` existente + auditoria em `platform_admin_audit` para toda alteração de catálogo/template.

---

# 4. Backfill e reconciliação
1. Reconciliar `agent_memory.value.category` a partir de `merchant_aliases`/transações (13 linhas) e marcar as 2 memórias de review como `internal`.
2. Backfill de `category_source='legacy'` nas transações já categorizadas (para auditoria não ficar nula) — sem alterar `category_id`.
3. Classificar os 19 sem categoria nas 3 faixas acima.
4. Recalcular `dedup_key`/`family` para os 25 `user_insights`; aplicar cooldown retroativo aos 10 `not_useful`.
5. Despachar (canal app) as 10 sugestões pendentes já existentes, respeitando cap diário — em lote controlado, não todas de uma vez.

# 5. Rollout e rollback
- Ordem: migrations aditivas → deploy funções → backfill em dry-run → backfill real → cron criado inativo → `run_now` na conta real → observação 24h → cron ativo → só então `proactive_channels={app,whatsapp}`.
- Rollback: `proactive_enabled=false` (kill switch imediato); `UPDATE cron.job SET active=false`; catálogo permite desligar `kind` individual; migrations são aditivas (drop de colunas/tabelas novas restaura o estado anterior); `previous_category_id` permite reverter recategorizações.

# 6. Testes
- **Unitários**: normalização de merchant; fuzzy match e limiares; guarda de `movement_kind`; seletor de diversidade; cooldown de dismiss/not_useful; presenter de memória; guarda de dados mínimos da review.
- **Contrato**: schemas Zod de `nino-context`, catálogo e templates; validação de variáveis de template.
- **Integração**: tick idempotente (2 execuções seguidas → 0 entregas duplicadas); rollout `{app}` nunca gera `outbound_messages`; dry-run não persiste.
- **Smoke**: `run_now` na conta real com `dry_run`, depois real; conferir `communication_deliveries`, `advisor_reviews` e ausência de WhatsApp.

# 7. Critérios de aceite
- **Home/Dicas**: dispensar uma dica não gera outra imediatamente; a mesma transação não reaparece por 7 dias; `not_useful` bloqueia o tipo por 30 dias; em 5 dispensas seguidas aparecem ≥ 3 famílias diferentes; ao categorizar, a dica correspondente some sozinha.
- **Acompanhamento**: usuário real com 285 lançamentos vê revisão semanal e mensal com números não-zerados e data de atualização; usuário sem dados vê critérios objetivos, nunca "está sendo preparada".
- **Nino Contexto**: zero JSON visível; zero memória `weekly:*`/`monthly:*`; nenhuma memória exibindo "sem categoria" quando a transação/alias já tem categoria; edição só por formulário.
- **Categorização**: 100% das novas transações com `category_source` preenchido; nenhuma transferência/fatura/investimento/rolê recategorizada; sugestões de confiança média nunca aplicadas sozinhas.
- **Motor**: Admin mostra última e próxima execução; kill switch corta em < 1 min; nenhum WhatsApp durante rollout app-only.
- **Admin**: é possível desligar um tipo, editar template, ver prévia e simular sem envio.

# 8. Riscos e trade-offs
- **Fuzzy match errado** → mitigado por limiar duplo, guarda de movimentos especiais e `previous_category_id`.
- **Manter duas tabelas de comunicação** custa uma view e escritas duplicadas de feedback; o ganho é não migrar histórico nem quebrar a Home. Aceito.
- **Cron horário** pode gerar carga; mitigado por lotes de 25 e `next_tick_at`.
- **Reescrita do Nino Contexto** pode esconder memória que o usuário queria ver; mitigado pelo bloco "Menos relevantes" e exportação completa preservada.
- **Guarda de dados mínimos** deixa alguns usuários sem revisão — preferível a indicadores zerados apresentados como diagnóstico.

# 9. Complexidade
| Fase | Complexidade | Observação |
|---|---|---|
| P0.1 Orquestração | Média | Migration de cron + telemetria + rollout por canal |
| P0.2 Dicas | Média-Alta | Reescrita do seletor de `insights-generate` + camada de feedback |
| P0.3 Acompanhamento | Média | Guarda de dados + 3 estados de UI + geração sob demanda |
| P1.1 Categorização | Alta | Pipeline, guardas, retroativo e backfill |
| P1.2 Nino Contexto | Média | Presenter + formulários + reconciliação |
| P2 Admin | Alta | Catálogo, templates, prévia, simulação, fila, auditoria |
