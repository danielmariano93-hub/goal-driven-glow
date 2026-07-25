# Plano — Finalizar implantação do commit `a7afd7e` (Meu Nino.IA)

Somente plano. Nada será executado nesta etapa.

## 1. Correção mínima do bloqueio do banco

**Origem do bloqueio (confirmada em leitura):**
- Tabela allowlist: `public.product_event_types` (PK `event_name`), criada e semeada em `supabase/migrations/20260724133602_8cc4b59d-39f3-4db5-b5b9-840525ec5721.sql` (linhas 19–58).
- Trigger `product_events_validate` chama `public.validate_product_event()` (mesma migration, linhas 92–130). O `RAISE EXCEPTION 'event_name % not in allowlist'` dispara porque `user_registered` não está em `product_event_types`.
- Uso de `user_registered` no PR #5:
  - `20260725030000_nino_intelligence_core_admin_metrics.sql` linha 103 (trigger `on_new_user` que insere em `product_events`) e linha 116 (backfill histórico).
  - `20260725043000_nino_intelligence_core_hardening.sql` linhas 32, 33, 41 (apenas filtros SELECT — não inserem).

**Correção proposta — nova migration aditiva `supabase/migrations/20260725050000_product_events_allowlist_user_registered.sql`:**

Conteúdo pretendido (idempotente, sem tocar migrations históricas, sem remover triggers/policies/constraints):

```sql
INSERT INTO public.product_event_types
  (event_name, category, requires_value_bucket, description)
VALUES
  ('user_registered', 'onboarding', false, 'Novo usuário cadastrado (evento de ciclo de vida)')
ON CONFLICT (event_name) DO NOTHING;
```

Nada além disso. Sem alterar `validate_product_event()`, sem alterar a categoria existente (`onboarding` já é aceita pela coluna `category text` sem CHECK constraint — confirmado na leitura da migration original).

**Rollback operacional:** `DELETE FROM public.product_event_types WHERE event_name='user_registered';` (só remove a linha semeada; não afeta eventos já inseridos, que passariam a falhar em novos INSERTs — usar apenas se decidirmos abandonar o PR #5).

## 2. Testes obrigatórios antes de aplicar

Adicionar `src/test/product-events-allowlist.test.ts` (Vitest com fixtures — sem tocar banco), cobrindo:

1. **Regressão da allowlist canônica:** os 20 `event_name` semeados originalmente continuam presentes e válidos.
2. **Novo evento aceito:** `user_registered` está na allowlist após aplicar a migration nova.
3. **Evento inválido rejeitado:** `foo_bar_baz` continua fora da allowlist (guarda o contrato).
4. **Idempotência:** aplicar o `INSERT ... ON CONFLICT DO NOTHING` duas vezes não duplica nem altera a linha existente.

Depois: `bunx vitest run` (suíte completa) + build (`bun run build`) verdes antes de qualquer aplicação.

## 3. Ordem correta das migrations e validações

Sequência exata via `supabase--migration` (uma migration por chamada, aprovação humana em cada):

1. `20260725050000_product_events_allowlist_user_registered.sql` (nova, item 1).
2. `20260725030000_nino_intelligence_core_admin_metrics.sql` (já no repo).
3. `20260725043000_nino_intelligence_core_hardening.sql` (já no repo).

Validações pós-aplicação (via `supabase--read_query`):

- `SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ('20260725050000','20260725030000','20260725043000');` → 3 linhas.
- `SELECT event_name FROM public.product_event_types WHERE event_name='user_registered';` → 1 linha.
- `SELECT count(*) FROM public.product_events WHERE event_name='user_registered';` > 0 (backfill executou).
- Contratos:
  - `SELECT admin_v2_clients_list(50)::jsonb->>'formula_version';` → `clients.live.v5`.
  - `SELECT formula_version FROM public.intelligence_metric_definitions WHERE metric_key='weekday_typical_spend';` → `weekday.robust.v2`.
- Trigger `on_new_user` existe em `auth.users` (`SELECT tgname FROM pg_trigger WHERE tgname='on_new_user_product_event';` ou nome equivalente definido na migration).
- Policies e grants das novas tabelas/views existem (`pg_policies`, `has_table_privilege`).

## 4. Edge Functions a redeployar

Baseado em `grep` por importações de módulos compartilhados alterados (`_shared/agent/**`, `_shared/intelligence/**`, `_shared/analytics/**`, `semanticQuery`, contexto temporal):

| Função | Motivo do redeploy |
|---|---|
| `agent-chat` | Usa `AgentCore` (`handleTurn`) e `_shared/intelligence/semanticQuery.ts` (novo padrão semanal `weekday.robust.v2` + correção contextual "eu digo na média"). |
| `whatsapp-webhook` | Usa `WhatsAppAdapter` → `AgentCore`; entrega gráficos via `artifact-render` e fallback de mídia. |
| `agent-proactive-tick` | Usa `ProactiveEngine`/`AgentCore` e escreve `product_events` (`agent_response_delivered`, etc.). |
| `agent-run` | Executa `AgentCore.handleTurn` para simulador admin — precisa do novo IntentRouter/Analytics. |
| `insights-generate` | Usa `InsightsEngine` do `_shared/agent/core` alterado e emite `insight_delivered` (não afetado por `user_registered`, mas depende dos novos módulos). |
| `split-reminders-dispatch` | Importa `_shared/agent` para telemetria/eventos consolidados no PR #5. |
| `user-ai-preferences` | Importa `PersonalizationEngine`/`MemoryStore` do core unificado. |
| `artifact-render` | Renderiza PNG dos novos artefatos `weekday_*`; entrega no App e WhatsApp. |

Não redeployar: `whatsapp-send`, `whatsapp-session`, `whatsapp-official-number`, `whatsapp-ack-watchdog`, `assistant-ingest-document`, `assistant-review-actions`, `documents-cleanup`, `finance-backfill-runner`, `pulse-compute`, `user-data-export`, `admin-*` — não importam módulos alterados no PR #5 (grep negativo).

Ferramenta: `supabase--deploy_edge_functions` com o array das 8 funções acima em uma única chamada.

## 5. Publicação do frontend

- Republicar via `preview_ui--publish` **após** migrations + edge deploy verdes.
- SHA publicado deve ser `a7afd7e6889fc2373f5774976dc7359d1f5afb22`. Se o Lovable exigir commit corretivo (ao mesclar a nova migration do item 1), publicar o commit resultante e registrar o SHA no relatório final.
- Sem mudanças de layout adicionais.

## 6. Homologação em produção (após publicar)

Via Playwright headless em `https://meunino.com.br` autenticado como owner e via `supabase--read_query`:

- **Admin → Cockpit:** cartões `Cadastros hoje` e `Usuários totais` renderizam; alerta de integridade visível; consumir `admin_v2_cockpit()` retorna `formula_version` das novas versões.
- **Admin → Clientes:** total > 0; datas de cadastro visíveis; badges `new | activated | active | dormant` presentes (`admin_v2_clients_list(200)` → contagem por `lifecycle_status`).
- **Novo cadastro:** criar usuário de teste e confirmar em `< 60s` que aparece em Clientes como `new` (não `active`). SQL: `SELECT lifecycle_status FROM (admin_v2_clients_list(50)->'clients')…` para o pseudo do novo user.
- **Assessor App e WhatsApp — padrão semanal:** enviar "qual dia da semana eu mais gasto?" — resposta cita `weekday.robust.v2` (via decision log em `agent_turn_events`).
- **Correção contextual:** enviar "quanto gastei na sexta?" seguida de "eu digo na média" — segunda resposta usa `interpretation=typical_behavior`.
- **Consulta pontual:** "quanto gastei na sexta-feira?" isolada → não roteia para `weekday_pattern` (evidenciado em `agent_decisions`).
- **Gráfico:** ambos os canais entregam PNG do `artifact-render` ou fallback textual honesto (checar `agent_artifacts.status`).
- **Kill switch proativo:** `SELECT value FROM public.financial_feature_flags WHERE key='proactive_enabled';` = `false`.
- **Integridade de dados:** `SELECT count(*) FROM public.transactions;` e `profiles` iguais ao snapshot pré-migration.

## 7. Critérios de aceite + evidências

| # | Aceite | Evidência |
|---|---|---|
| 1 | Suíte + build verdes | Log Vitest + `bun run build` |
| 2 | 3 migrations registradas | `SELECT` em `schema_migrations` |
| 3 | `user_registered` na allowlist | `SELECT` em `product_event_types` |
| 4 | Contratos `clients.live.v5` e `weekday.robust.v2` | `SELECT` nas RPCs/metric defs |
| 5 | 8 edge functions redeployadas | Retorno de `supabase--deploy_edge_functions` |
| 6 | Frontend publicado com SHA correto | Retorno de `preview_ui--publish` |
| 7 | Cockpit + Clientes com dados live | Screenshot Playwright |
| 8 | Novo cadastro classificado `new` | SQL + screenshot |
| 9 | Padrão semanal + correção contextual OK | Logs `agent_decisions` + screenshot |
| 10 | Gráfico entregue nos dois canais | `agent_artifacts.status='delivered'` |
| 11 | Proactive off | SQL feature_flags |
| 12 | Sem perda de dados | Contagens pré/pós migration |

**Riscos residuais:**
- Backfill de `user_registered` em `20260725030000` pode ser lento se `auth.users` tiver muitas linhas — mitigar apenas monitorando; migration é one-shot.
- Se `admin_v2_clients_list` mudar assinatura entre v4→v5, front pode quebrar; contrato foi verificado no auditoria anterior — sem breaking changes esperados.

**Rollback:**
- Migrations Supabase são transacionais; falha em qualquer statement reverte tudo.
- Se pós-aplicação surgir regressão de contrato, criar migration corretiva aditiva (nunca reverter histórico).

**Custo:**
- Consomem créditos: `supabase--migration` (×3), `supabase--deploy_edge_functions` (×1 chamada, 8 funções), `preview_ui--publish`, chamadas Playwright de homologação.
- Apenas operacionais/gratuitas: `supabase--read_query`, `imagegen`-free grep/leitura, testes locais.

## Sequência de execução (após aprovação)

1. Criar `supabase/migrations/20260725050000_product_events_allowlist_user_registered.sql` + teste `product-events-allowlist.test.ts`.
2. Rodar Vitest + build.
3. Aplicar migration `20260725050000` → `20260725030000` → `20260725043000` (nessa ordem).
4. Validar histórico e contratos por SQL.
5. `deploy_edge_functions(["agent-chat","whatsapp-webhook","agent-proactive-tick","agent-run","insights-generate","split-reminders-dispatch","user-ai-preferences","artifact-render"])`.
6. `preview_ui--publish` e registrar SHA.
7. Executar homologação (SQL + Playwright) e preencher checklist do item 7.
8. Entregar relatório final. Sem publicar nada além do que já está aprovado no PR #5 + a migration aditiva do item 1.
