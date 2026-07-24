
# Patch consolidado — Meu Nino: telefone, entrega, canônico, templates, deploys

Objetivo: um único patch coordenado que resolve os 10 achados, sem publicar, sem aplicar migration nem redeploy neste passo. Nada do legado é removido nesta rodada.

## Causa raiz por eixo

1. **Telefone (Divisão do Rolê)**: `DivisaoDoRoleNova.tsx` grava `phone_e164` cru; não há CHECK regex em `shared_expense_participants.phone_e164`; `waha.ts` faz apenas `to.replace(/^\+/,"")` — aceita "11 9…" e monta `chatId` inválido. `normalizeBrPhone` só está no client, não na fronteira RPC/DB nem no provider.
2. **Falso positivo de entrega**: `outbound_messages.status='sent'` é gravado por `mark_outbound_sent` após HTTP 2xx da WAHA. A UI e o painel tratam `sent` como entregue. ACK só sobe para `delivered/read` via webhook, mas não há estado intermediário `accepted` nem watchdog explícito para "aceito sem ACK". Enum livre (text) permite evolução compatível.
3. **Pipeline 24/7**: Já OK depois do PR#2 (sem janela 08–22, `SKIP LOCKED`, leases). Falta apenas: distinguir aceito/entregue no diagnóstico e evitar duplicação no reenvio manual.
4. **Fundação canônica**: `refresh_financial_daily_facts` existe (v2), mas nunca é chamada por usuário; `financial_feature_flags` vazia; `financial_current_snapshots` vazio; assistente/relatórios consomem só `transactions` diretamente. Falta baseline, backfill em lotes, dual read e observabilidade de diferença.
5. **Templates decorativos**: `spending_trend/monthly_comparison/weekly_one_page` inseridos em `financial_report_templates`, mas o roteador do agente (`IntentRouter/AppAdapter`) não os consulta; `ChartArtifactRenderer` usa `type="linear"` implícito em `<Line>` do Recharts (não aplica `monotone`).
6. **Deploys**: PR#2 republicou só 2 funções. Módulos compartilhados alterados (`_shared/messaging/waha.ts`, `_shared/heartbeats.ts`, `_shared/agent/*`, `_shared/analytics/*`, `_shared/artifacts/*`) são embarcados no bundle Deno de cada função que os importa e exigem redeploy explícito.
7. **Migrations**: `20260724023000_canonical_finance_and_split_delivery_hardening.sql` existe no repo. Histórico remoto tem o timestamp `20260724021636` (a Lovable registrou com hash diferente). Precisa reconciliação de metadata sem reaplicar SQL e sem apagar histórico.
8. **Segurança**: RLS já cobre operacionais; falta CHECK regex no telefone, mascaramento em logs do provider e revisão de `SECURITY DEFINER` das novas funções (`claim_reminder_jobs*`, `is_behavioral_consumption`, `refresh_financial_daily_facts`) para `SET search_path = public, pg_temp`.

## Escopo — arquivos e mudanças

### A. Normalização de telefone (frontend + fronteira + provider)

- `src/pages/DivisaoDoRoleNova.tsx`
  - Importar `normalizeBrPhone` e aplicar no `onChange` (formatar máscara) e no submit; bloquear salvar se algum participante tem telefone digitado e `normalizeBrPhone` retornar `null`; exibir erro inline por linha.
  - Mostrar `+55 (11) 9xxxx-xxxx` já formatado no `input` após blur.
- `src/pages/DivisaoDoRoleDetalhe.tsx` (edição de participante): idêntico.
- `src/lib/phone.ts`: expor `formatBrDisplay(e164)` para exibição consistente (não altera storage).
- `supabase/functions/_shared/messaging/waha.ts`
  - `sendText/sendImage`: chamar `normalizeBrPhone(to)` antes de montar `chatId`; se `null`, lançar erro `invalid_phone_e164` (não enviar).
  - Log sanitizado (`***` + 4 últimos dígitos) já existe em partes; padronizar helper `maskE164`.
- **Migration (novo arquivo `20260725010000_phone_e164_hardening.sql`)**
  - `ALTER TABLE public.shared_expense_participants ADD CONSTRAINT chk_phone_e164 CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+55[1-9][0-9]{9,10}$') NOT VALID;`
  - RPC `normalize_and_fix_phone_e164()` SECURITY DEFINER que, para cada linha inválida, tenta reconstruir via `normalize_br_phone` (função pl/pgsql equivalente ao client, idempotente) e grava; linhas irrecuperáveis vão para `shared_expense_participants.phone_e164 = NULL` + `notes` com motivo (mantém histórico).
  - `VALIDATE CONSTRAINT chk_phone_e164` depois do fix.
  - Trigger `BEFORE INSERT OR UPDATE` que roda `normalize_br_phone` no `phone_e164` (defesa em profundidade contra caller antigo).
  - Idêntico para `conversations.phone_e164` (constraint NOT VALID, sem fix automático — apenas trigger de normalização em novos inserts).

### B. Estados semânticos de entrega + ACK

- **Migration `20260725011000_delivery_state_semantics.sql`**
  - Coluna `outbound_messages.status` continua `text`. Adicionar:
    - `accepted_at timestamptz` (preenchido em `mark_outbound_sent`, hoje mapeado como `sent`).
    - Manter `status='sent'` como sinônimo de "accepted pela WAHA" para compatibilidade histórica; novo derivado:
    - View `public.outbound_delivery_v` expõe `delivery_state` computado: `queued|processing|accepted|delivered|read|failed|dead`.
  - RPC `mark_outbound_sent`: atualizar também `accepted_at = now()`.
  - Ranking do webhook (`whatsapp-webhook`) permanece `sent < delivered < read`; adicionar promoção idempotente de `queued/processing → sent` quando ACK inicial `sent` chega antes do POST-back.
  - Watchdog `whatsapp-ack-watchdog`: já existe; ampliar para marcar `last_error='no_ack_after_5m'` em rows com `status='sent'` e `accepted_at < now()-'5 min'`, sem alterar `status` (recuperável, não regressivo). Log estruturado inclui `provider_message_id` mascarado.
- **Frontend**
  - `src/pages/DivisaoDoRoleDetalhe.tsx` e cards de status: consumir `outbound_delivery_v`; label:
    - `accepted` → "Aguardando entrega no WhatsApp"
    - `delivered` → "Entregue"
    - `read` → "Lido"
    - `no_ack_after_5m` → "Sem confirmação — reenviar?"
  - Botão "reenviar" chama RPC `resend_split_reminder(participant_id)` idempotente (usa `idempotency_key=split:resend:{participant_id}:{yyyymmddhh}` — não duplica no mesmo bloco de hora).
- **Testes** (`src/test/split-delivery-tracking.test.ts` já existe): estender casos accepted→delivered→read, no-ACK, timeout, dead-letter (attempts>=6), reenvio manual duplicado.

### C. Pipeline 24/7 — apenas guardrails

- Nenhuma mudança de schema; adicionar teste read-only que garante ausência de `local_time`/`make_timestamptz` em `claim_reminder_jobs*` e ausência da janela 08–22 (`src/test/split-flow-contract.test.ts`).

### D. Fundação canônica — rollout aditivo

- **Migration `20260725012000_canonical_rollout_scaffolding.sql`**
  - RPC `financial_baseline(user_id, until date)` SECURITY DEFINER: calcula snapshot legado (via `facts.ts` equivalente em SQL — reusa `is_behavioral_consumption`) e grava em `financial_current_snapshots` com `formula_version='legacy.baseline'`.
  - RPC `financial_backfill_batch(user_id, from date, to date, batch int default 15)`: percorre dias em lotes; chama `refresh_financial_daily_facts`; grava `financial_backfill_checkpoints`.
  - RPC `financial_dual_read(user_id, day)` retorna `{legacy, canonical, diff}` — persiste em `financial_metric_diffs` quando |diff| > tolerância (1 centavo).
  - Índices auxiliares em `financial_daily_facts(user_id, day)`.
- **Feature flag**: `financial_feature_flags(user_id, flag='use_canonical_financial_snapshot', enabled bool, rollout_stage text default 'off')`. Nada é ligado agora.
- **Backend consumidor** (`src/lib/hooks/useFinancialSnapshot.ts` + `src/lib/engine/facts.ts` e `supabase/functions/_shared/engine/facts.ts`):
  - Introduzir função `readSnapshot(userId)` que **por padrão retorna legado**; se flag ligada, faz `dual read` e loga diff; nunca substitui legado no client sem flag `stage='canonical_only'`.
- **Piloto**: `financial_feature_flags` gerenciado por RPC admin — fora do escopo de UI neste patch.
- **Rollback**: `UPDATE financial_feature_flags SET enabled=false` desliga tudo; migrations são aditivas.

### E. Templates + gráficos do assistente

- `supabase/functions/_shared/agent/IntentRouter.ts`: mapear intents `tendencia_gastos`, `comparativo_mensal`, `one_page_semanal` a `template_key` correspondente e usar `_shared/analytics/*` para preencher; passar `template_key` como campo do `agent_artifacts`.
- `supabase/functions/_shared/artifacts/builder.ts`: aceitar `template_key`; garantir contrato consistente app/PNG.
- `src/components/assessor/artifacts/ChartArtifactRenderer.tsx`:
  - `<Line type="monotone" />` explícito; `<Area type="monotone">` para faixas de previsão; garantir tipos `bar|line|forecast_band|donut|progress` renderizados; incluir chip de proveniência com `formula_version` e `template_key`.
- `supabase/functions/artifact-render/index.ts`: mesmo `type: monotone` na renderização PNG (SVG server-side) e mesmo fallback textual determinístico com os números exatos do motor.
- **Testes** `src/test/artifact-contract.test.ts` + `src/test/agent-chart-routing.test.ts`: cobrir os 3 templates, PNG e fallback textual (mesmos números).

### F. Deploys — lista real

Após a migration D aplicada, redeploy destas Edge Functions (todas importam módulos compartilhados alterados):

Ordem sugerida:
1. `whatsapp-send` (waha.ts + heartbeats.ts + artifact-render deps).
2. `whatsapp-webhook` (waha.ts + mediaFallback + ACK ranking).
3. `whatsapp-ack-watchdog` (heartbeats + novo aviso `no_ack_after_5m`).
4. `split-reminders-dispatch` (waha.ts + idempotência resend).
5. `artifact-render` (builder.ts + template_key).
6. `agent-run` e `agent-chat` (IntentRouter + template_key + facts.ts leitor canônico opcional).

Não redeployar: `admin-*`, `assistant-*`, `documents-cleanup`, `pulse-compute`, `insights-generate`, `user-*` (não tocados).

Validação de secrets (sem expor valores): `fetch_secrets` para confirmar `WAHA_API_URL`, `WAHA_API_KEY`, `INTERNAL_CRON_SECRET`, `LOVABLE_API_KEY` presentes.

### G. Reconciliação de histórico de migrations

- **Não** renomear nem apagar `20260724023000_canonical_finance_and_split_delivery_hardening.sql`.
- **Não** editar `supabase_migrations.schema_migrations`.
- Novas migrations desta rodada usam timestamps `20260725010000..20260725012000` — nunca menores que o último registrado, evitando reordenação.
- Se a ferramenta Lovable detectar que `20260724023000` está registrado com hash divergente, aceitar como já aplicado (skip). Documentar em `.lovable/plan.md` que a reconciliação é resolvida ao aplicar as novas migrations acima (a ferramenta registra pelo nome do arquivo).

### H. Segurança

- Todas as novas RPCs: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM public/anon`, `GRANT EXECUTE TO authenticated` só onde há uso client (ex.: `resend_split_reminder`). Backfill/baseline/dual-read: `GRANT EXECUTE TO service_role` apenas.
- Mascaramento em `waha.ts` sendText/sendImage error logs.
- Confirmar RLS `financial_daily_facts`, `financial_daily_category_facts`, `financial_current_snapshots` restritas a `auth.uid()=user_id` (SELECT) + `service_role` full.

## Testes obrigatórios (novos/atualizados)

- `src/test/phone.test.ts` ✓ já existe — adicionar casos de fixture com os 6 telefones corrompidos do banco (via factory local, sem tocar banco).
- `src/test/split-flow-contract.test.ts`: form→RPC→banco→dispatcher→outbound com chatId `5511...@c.us`.
- `src/test/waha-image-payload.test.ts`: garantir rejeição de telefone inválido.
- `src/test/split-delivery-tracking.test.ts`: novos casos ACK/no-ACK/dead-letter/resend idempotente.
- `src/test/canonical-financial-foundation.test.ts`: dual-read com fixture `financial_ecosystem_v2.json` (cartão, fatura, transferências, investimentos, empréstimos, refunds, planejados). Tolerância 1 centavo.
- `src/test/agent-chart-routing.test.ts`: 3 templates; App e WhatsApp produzem o mesmo número.
- `src/test/artifact-contract.test.ts`: PNG e fallback textual determinístico.
- RLS: `src/test/whatsapp-permissions.test.tsx` + novo `canonical-rls.test.ts`.
- Pipeline local: `npm ci && npm test -s && npx tsgo --noEmit && npm run build`.

## Sequência de implementação (uma execução)

```text
1. Migrations (aprovar via ferramenta, uma a uma):
   1a. 20260725010000_phone_e164_hardening
   1b. 20260725011000_delivery_state_semantics
   1c. 20260725012000_canonical_rollout_scaffolding
2. Patch de código (frontend + edge functions + shared):
   - normalizeBrPhone no form + provider
   - accepted_at + outbound_delivery_v consumo na UI
   - IntentRouter/template_key + monotone no renderer
   - readSnapshot com dual-read opt-in
3. Testes: rodar suite completa localmente; corrigir regressões.
4. Deploy edge functions (ordem acima) — SÓ após 1+2+3 verdes.
5. Smoke tests read-only (queries):
   - SELECT count(*) FROM shared_expense_participants
     WHERE phone_e164 IS NOT NULL AND phone_e164 !~ '^\+55[1-9][0-9]{9,10}$';  -- deve ser 0
   - SELECT status,count(*) FROM outbound_messages
     WHERE created_at>now()-'1 day' GROUP BY 1;
   - SELECT count(*) FROM financial_metric_diffs;  -- 0 até flag ligada
6. Rollout: manter TODOS os usuários em legacy. Ligar flag apenas para 1 usuário-piloto (founder) em passo separado, fora deste patch.
```

## Riscos e mitigação

- **CHECK phone_e164 falhando em produção**: por isso `NOT VALID` + fix RPC antes de `VALIDATE`. Se o fix não recuperar linhas, nulificar phone_e164 preservando `name/amount` (não perde histórico financeiro).
- **UI mostrando "Aguardando" após WAHA rápida**: aceitável; ACK típico chega em segundos. `no_ack_after_5m` só aparece após 5 min.
- **Backfill pesado**: 15 dias/lote + checkpoint garante reentrância; nunca roda automaticamente para usuários — só via RPC admin.
- **Templates novos ainda "decorativos" se roteador não casar intent**: testes `agent-chart-routing` bloqueiam merge se roteamento não usar `template_key`.
- **Deploys parciais**: script único chama `supabase--deploy_edge_functions` com array das 6 funções.

## Critérios de aceite verificáveis

- [ ] `(11) 9xxxx-xxxx` no form persiste como `+5511…`; RPC rejeita inválidos.
- [ ] 6 telefones corrompidos: corrigidos ou nulificados (contagem = 0 na query smoke).
- [ ] UI mostra "Aguardando entrega" enquanto `accepted_at` mas sem ACK; muda para "Entregue" apenas com ACK real.
- [ ] Reenvio manual dentro do mesmo bloco de hora não gera segundo outbound (idempotency_key).
- [ ] `financial_metric_diffs` recebe linhas somente para o piloto após ligar a flag; diff médio ≤ R$0,01.
- [ ] "meu gasto médio está diminuindo?" no app e WhatsApp: mesmo `template_key='spending_trend'`, mesma série, PNG + fallback textual coincidem.
- [ ] `ChartArtifactRenderer` renderiza linhas com `type="monotone"`.
- [ ] Todas as 6 edge functions redeployadas com heartbeat ok.
- [ ] `npm test`, `tsgo --noEmit`, `npm run build` verdes.
- [ ] Nenhum publish disparado; nenhum backfill executado; nenhuma flag ligada.

## O que NÃO faz

- Não remove cálculo legado.
- Não liga `use_canonical_financial_snapshot` para nenhum usuário.
- Não executa backfill.
- Não publica frontend.
- Não altera `supabase_migrations.schema_migrations`.
- Não muda WAHA config nem cria secrets.
