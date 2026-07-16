
# Correção integral do painel /admin — NoControle.ia

Escopo: apenas rotas `/admin/*` e as RPCs/functions que as alimentam. O app financeiro do usuário permanece intacto.

## 1. Diagnóstico

Auditei o código atual e as funções no banco:

- `admin_dashboard_stats` conta `auth.users` diretamente → hoje retorna `total_users = 1` porque existe apenas o founder (Daniel Assis), que é `platform_owner`. Nenhum consumidor real. Fonte da distorção confirmada em SQL: `auth.users=1, profiles=1, platform_admins=1, user_financial_settings=1` (o próprio founder tem `user_financial_settings` porque a migration criou default; precisa ser explicitamente excluído).
- `admin_users_list` faz `FROM auth.users` sem filtrar platform admins → Daniel aparece na listagem "Usuários".
- `admin_engagement_stats` conta ativações contra `transactions/goals/whatsapp_links` sem excluir admins.
- `admin_agent_stats` inclui runs originadas por qualquer conta, inclusive testes internos.
- `src/pages/admin/Agente.tsx` mostra: nomes de secrets (`WAHA_API_URL`, `WAHA_API_KEY`, `WAHA_WEBHOOK_SECRET`, `CRON_SECRET`, `LOVABLE_API_KEY`), texto "Adicione os secrets em Project Settings → Secrets", modelo, temperatura, tokens, timeout, e status `UNKNOWN`.
- `src/pages/admin/WhatsApp.tsx` + `WhatsAppSessionPanel.tsx` usam título "WhatsApp / WAHA", mostram `STATUS_COLORS.UNKNOWN`, `secrets`, instruções técnicas e alertas amarelos com nomes de env vars.
- `src/pages/admin/Operacao.tsx` lista `POST /functions/v1/<fn> · header: x-cron-secret` e instrui configurar `cron-job.org/GitHub Actions` com `CRON_SECRET` — literalmente proibido pelo brief.
- `whatsapp-session/index.ts` devolve `secrets: Record<string, boolean>` no payload — precisa parar de vazar isso ao frontend.
- Não existe fonte única de verdade para "consumidor", status operacional ou erros humanizados.

## 2. Arquivos e artefatos que serão criados/alterados

### Banco (nova migration)

`supabase/migrations/<ts>_admin_consumer_source_of_truth.sql`:

1. **Fonte única de "consumidor"** — view `admin_consumer_users`:
   - `user_id` de `auth.users` que **não** seja `platform_admins.active=true`
   - **E** tenha perfil financeiro ativado: existir linha em `user_financial_settings` **com `approximate_monthly_income` não nulo** OU `profiles.onboarding_completed_at IS NOT NULL` OU existir pelo menos 1 transação/meta/conta/dívida/investimento/whatsapp_link ativo para o `user_id`.
   - Regra: "existência apenas em auth.users/profiles não conta". `onboarding_completed_at` marca ativação explícita → conta. Dupla papel (admin + consumidor ativado) é contado uma vez.
2. Recriar RPCs derivadas apenas dessa view:
   - `admin_dashboard_stats()` → `total_users`, `new_users_7d`, `new_users_30d`, `onboarded_users` a partir de `admin_consumer_users`; agregados (`total_transactions/accounts/…`) filtrados por `user_id IN (SELECT user_id FROM admin_consumer_users)`.
   - `admin_engagement_stats()` idem para DAU/WAU/MAU/ativações.
   - `admin_agent_stats()` filtra `agent_runs.user_id` pela mesma view.
   - `admin_users_list()` faz `JOIN admin_consumer_users` (não lista admins puros); ordenação preservada.
3. Nova RPC `admin_platform_status()` — fonte única de status operacional consumida por Agente, WhatsApp e Operação:
   - `whatsapp`: `connected | awaiting_qr | connecting | disconnected | needs_attention | unavailable | not_configured` (derivado no server chamando WAHA via edge function OU lendo o último `provider_health_events` + `whatsapp_links` ativos — usar heartbeat com TTL de 2 min como fallback).
   - `agent`: `working | attention | unavailable | not_setup` (derivado de: existe `agent_prompt_versions.status='active'` + WhatsApp status + falhas 24h em `agent_runs`).
   - `jobs`: para cada job (`whatsapp-send`, `whatsapp-ack-watchdog`, `split-reminders-dispatch`, `recurring-generate`) → `healthy | delayed | failing | idle | not_scheduled` derivado de heartbeats reais (últimas execuções em `outbound_messages`, `reminder_jobs`, `provider_health_events`, `recurring_occurrences`) e não da mera existência de código.
4. Nova tabela `job_heartbeats(job_key text pk, last_run_at timestamptz, last_ok boolean, last_error_code text, processed int, failed int, updated_at)` + GRANT + RLS (somente `is_platform_admin()` lê; edge functions escrevem via service role). Preenchida pelas próprias edge functions em cada execução.
5. RPC `admin_reprocess_failed(job_key)` e `admin_run_check(job_key)` — chamáveis apenas por platform admin; enfileiram/marcam sem executar diretamente aqui.

Todas com `GRANT EXECUTE ... TO authenticated`, `SECURITY DEFINER`, guard `is_platform_admin()`.

### Frontend — mapeadores centrais (novos)

- `src/lib/admin/statusMapper.ts` — traduz códigos técnicos para labels pt-BR + tone (`success | warn | danger | neutral | info`) e microcopy de impacto. Único ponto que conhece códigos internos.
- `src/lib/admin/errorMapper.ts` — recebe `error` de RPC/edge function, devolve `{ title, hint, code }`. Nunca expõe `error.message` bruto.
- `src/components/admin/StatusChip.tsx` — chip semântico.
- `src/components/admin/AdminErrorBoundary.tsx` — envolve `AdminLayout` para não vazar stack.
- `src/hooks/useAdminPlatformStatus.ts` — consome `admin_platform_status` com refetch de 30s.

### Edge functions

`supabase/functions/whatsapp-session/index.ts`:
- Remover o campo `secrets` das respostas retornadas ao cliente (mantém internamente para logs sanitizados apenas em `service_role`).
- Novo response shape público (capability-based):
  ```
  { status: 'connected'|'awaiting_qr'|'connecting'|'disconnected'|'needs_attention'|'unavailable'|'not_configured',
    capabilities: { can_connect, can_send, needs_session, temporarily_unavailable },
    phone_masked, last_seen_at, latency_ms, error_code }
  ```
- Nunca retornar `UNKNOWN`; mapear para `needs_attention` + `error_code`.
- Nunca gravar QR em log.

`supabase/functions/whatsapp-send`, `whatsapp-ack-watchdog`, `split-reminders-dispatch`, `recurring-generate` (se existir; caso contrário criar stub que só grava heartbeat):
- Ao final de cada execução, `upsert` em `job_heartbeats`.

### Frontend — reescrita das páginas admin

- `src/pages/admin/VisaoGeral.tsx` — usa `admin_platform_status` no topo (banner executivo se WhatsApp/Agente não estiver ok) + `admin_dashboard_stats` já corrigido. Empty state honesto ("Nenhum usuário por aqui ainda"). Sem exibir contagem herdada.
- `src/pages/admin/Usuarios.tsx` — usa `admin_users_list` já corrigido, sem exibir platform admins; empty state "Nenhum usuário por aqui ainda".
- `src/pages/admin/Engajamento.tsx` — consome nova RPC.
- `src/pages/admin/Agente.tsx` — reescrita completa como painel executivo:
  - Cabeçalho: `StatusChip` humano + microcopy de impacto.
  - Cards: conversas/vínculos ativos, fila de mensagens, entregues 24h, falhas 24h, última atividade.
  - Seção "Comportamento do assistente" (accordion) com nome, tom, regras e versão publicada. Sem modelo, temperatura, timeout, tokens.
  - Seção "Diagnóstico avançado" (accordion colapsado, visível só para `platform_owner`) com `code` de referência, latência, contagens — nunca valores de secrets.
  - Remover completamente: `secrets`, `Object.entries(health.secrets)`, "Configuração pendente", nomes `WAHA_*`, `Modelo/Temp/Passos/Timeout`.
- `src/pages/admin/WhatsApp.tsx` (+ substituir/refatorar `WhatsAppSessionPanel.tsx`):
  - Título "WhatsApp" (sem "WAHA").
  - `StatusChip` humano usando statusMapper: `Conectado`, `Aguardando leitura do QR Code`, `Conectando`, `Desconectado`, `Atenção necessária`, `Integração ainda não concluída`. Nunca `UNKNOWN`.
  - Se `capabilities.can_connect === false && not_configured` → card "Integração ainda não concluída" + CTA "Revisar conexão" (leva ao suporte interno). Sem instruções de secrets.
  - Se `needs_session` → botão "Conectar WhatsApp" → cria/inicia sessão → mostra QR + polling → "Conectado".
  - Telefone mascarado, última conexão, latência humana ("responde em ~120ms").
  - Ações destrutivas (Desconectar, Reiniciar) com `AlertDialog` de confirmação. "Parar/Logout/Sync webhook" agrupadas em menu "Ações avançadas" (owner only), com labels humanas.
  - Envio de teste em seção secundária: só campo de telefone + toggle consentimento + botão. Resultado humano.
  - Remover alertas amarelos técnicos e listagem de env vars.
- `src/pages/admin/Operacao.tsx` — reescrita:
  - 4 cards por job: envio de mensagens, lembretes, recorrências, processamento. Cada card lê `admin_platform_status.jobs[key]` e mostra: `StatusChip`, última execução (relative), próxima execução (se conhecida), pendentes/processados/falhas.
  - Botões: "Executar verificação" (`admin_run_check`), "Reprocessar falhas" (`admin_reprocess_failed` com confirmação), "Ver eventos" (drawer com últimos `provider_health_events`/agent_runs falhos, sanitizados).
  - Remover: array `CRON_ENDPOINTS`, texto `/functions/v1/…`, `x-cron-secret`, instrução `cron-job.org`, `CRON_SECRET`, `pg_cron`.
  - Se `job.status === 'not_scheduled'` → "Automação ainda não ativada" + CTA interna.

### Testes

- `src/test/admin-consumer.test.ts`: cenários — apenas platform owner (Total 0); admin + consumidor ativado (Total 1); consumidor puro (Total 1); usuário sem `user_financial_settings` nem transações (Total 0).
- `src/test/admin-status-mapper.test.ts`: nunca produz `UNKNOWN`; todo código técnico vira label pt-BR.
- `src/test/admin-error-mapper.test.ts`: `error.message` bruto nunca aparece no retorno humano; sempre há `code`.
- SQL sanity queries executadas pós-migration.

## 3. Ordem de implementação

1. Migration: view `admin_consumer_users` + reescrita das 4 RPCs de métricas + `admin_platform_status` + tabela `job_heartbeats` + RPCs `admin_reprocess_failed`/`admin_run_check` + GRANTs + RLS. Aprovar migration.
2. Edge function `whatsapp-session`: remover `secrets` do payload público, normalizar status, mapear `UNKNOWN → needs_attention`. Adicionar heartbeat.
3. Demais edge functions de job: adicionar upsert em `job_heartbeats`.
4. Frontend: criar `statusMapper.ts`, `errorMapper.ts`, `StatusChip.tsx`, `AdminErrorBoundary.tsx`, `useAdminPlatformStatus.ts`.
5. Reescrever páginas admin nesta ordem: `Agente.tsx`, `WhatsApp.tsx` + `WhatsAppSessionPanel.tsx`, `Operacao.tsx`, `VisaoGeral.tsx`, `Usuarios.tsx`, `Engajamento.tsx`.
6. Envolver `AdminLayout` com `AdminErrorBoundary`.
7. Testes + typecheck + build. Grep final por termos proibidos no bundle admin.

## 4. Decisões de UX e copy

- Status labels (pt-BR): "Funcionando", "Atenção necessária", "Indisponível", "Ainda não configurado", "Conectado", "Aguardando leitura do QR Code", "Conectando", "Desconectado", "Não foi possível verificar agora".
- Copy de impacto (exemplos): "O assistente ainda não pode responder pelo WhatsApp"; "Envios de lembretes estão atrasados"; "Nenhum usuário por aqui ainda — quando alguém entrar no NoControle.ia, você vê aqui."
- Erros: banner `"Não foi possível carregar agora. Código de referência: XY7-42."` — nunca `error.message`.
- Sem emojis. `StatusChip` com ícone lucide + cor semântica.
- Ações destrutivas: `AlertDialog` com resumo do impacto no negócio, não instruções técnicas.

## 5. Riscos, migração e RLS

- **Compat de tipos**: RPCs mantêm mesmo shape JSON — apenas números mudam. `admin_users_list` mantém colunas.
- **RLS**: `job_heartbeats` protegida por `is_platform_admin()` para leitura; escrita apenas via service role dentro de edge functions. Nenhuma exposição a `anon`.
- **Backfill**: nada a migrar (métricas são calculadas ao vivo).
- **Fallback**: se `admin_platform_status` falhar, `AdminErrorBoundary` mostra estado degradado por seção, não tela branca.
- **Não expor secrets**: audit final `rg -n "WAHA_|CRON_SECRET|LOVABLE_API_KEY|Project Settings|/functions/v1|x-cron-secret|pg_cron|UNKNOWN"` só pode acender fora de `src/pages/admin/**` (permitido em `.md`/docs; proibido em `src/`).

## 6. Critérios de aceite

- `admin_dashboard_stats().total_users = 0` no estado atual (confirmado via `supabase--read_query` após migration).
- Daniel Assis (platform owner) não aparece em `admin_users_list()` nem é contado.
- Se Daniel for platform admin **e** tiver `onboarding_completed_at` ou renda financeira → conta 1 vez.
- Todas as telas admin usam a mesma definição de consumidor (única view).
- Nenhuma ocorrência dos termos proibidos em `src/pages/admin/**` e `src/components/admin/**`: "Project Settings", "Secrets", "WAHA_API_KEY", "WAHA_API_URL", "WAHA_BASE_URL", "WAHA_WEBHOOK_SECRET", "CRON_SECRET", "LOVABLE_API_KEY", "x-cron-secret", "/functions/v1", "pg_cron", "UNKNOWN".
- Response de `whatsapp-session` (POST/GET) não contém chave `secrets`.
- Agente e WhatsApp exibem o mesmo status (mesma fonte `admin_platform_status`).
- Operação deriva status de heartbeats reais, não da existência de código.
- Empty state de Usuários = "Nenhum usuário por aqui ainda".
- `AdminErrorBoundary` captura crashes; UI nunca mostra stack ou `error.message`.
- Testes novos passam; typecheck e build limpos.
- Nenhuma publicação/deploy executada.
