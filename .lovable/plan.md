# Plano fechado — Admin estável, Divisão do Rolê e Comunicações Proativas v1

Diagnóstico feito lendo `usePlatformPermissions.ts`, `ProactiveEngine.ts`, `CommunicationDispatcherV2.ts`, `ChannelGuard.ts`, `communicationPolicy.ts`, `agent-proactive-tick`, `split-reminders-dispatch`, `messageTemplates.ts`, `Cockpit.tsx`, `Clientes.tsx`, `AdminLayout.tsx` e páginas `operacao/*`. Nada nesta seção é especulação — cada afirmação corresponde a um trecho confirmado nos arquivos citados.

---

## 1. Estado atual por feature

### Frente 1 — Admin
- `usePlatformPermissions`: já corrigido — `permissions` é `Set` estável e `can` é `useCallback([permissions])`. Único consumidor com `useEffect` é `Clientes.tsx`, que agora depende de flags primitivas (`canReadIdentity`, `canReadMaskedIdentity`). `AdminLayout.tsx` usa `can` no filtro do render (estável). **≈ 80%**.
- Cockpit / Crescimento / Operação (WhatsApp, Saúde, IaOcr, Assistente) / IA / Governança: RPCs `admin_v2_*` chamados diretos via `callAdminRpc`. Falta padrão consistente de `Promise.allSettled`, EmptyState e mensagem de erro (Cockpit já usa; demais telas ainda derrubam a tela num único `throw`). **≈ 60%**.
- Universo de clientes reais: migration `20260726120000_client_universe_excludes_test.sql` aplicada, mas ainda não há relatório versionado consolidando 1 admin / 3 teste / 2 reais com evidência SQL. **≈ 50%**.
- E2E autenticado das 8 telas do Admin: **inexistente**. **0%**.
- Instrumentação temporária: restam `console.warn` em `Cockpit.tsx:83` (aceitável, é fallback) e um punhado em módulos do agente que precisam ser auditados. **≈ 70%**.

### Frente 2 — Divisão do Rolê
- Migration de templates com `participants_count`, `total_amount` e `split_context_sentence` está em `messageTemplates.ts` (DEFAULTS) e `split-reminders-dispatch/index.ts` (função `messageFor` + `getSplitContext`). Código presente. **≈ 85%**.
- Não há evidência de deploy da Edge Function após a última alteração nem envio real registrando o novo texto em `outbound_messages`.
- Templates administráveis (`agent_prompt_versions.structured_config.contexts.split_*`) têm precedência sobre os DEFAULTS: se um template ativo antigo não contém `{{split_context_sentence}}`, o contexto não aparece. Isso é um risco silencioso.

### Frente 3 — Comunicações Proativas
- `ProactiveEngine.scanUser` cria `pending_proactive_suggestions` (`≈` 80%).
- `InsightsEngine` implementa detectores base; a cobertura real dos 5 casos-alvo precisa auditoria explícita.
- `CommunicationDispatcherV2` entrega in-app e enfileira WhatsApp, grava `communication_deliveries`, respeita `notification_preferences`. **≈ 70%**.
- `communicationPolicy.decideCommunication` faz cooldown/quiet-hours/quota — precisa validar dedup por `dedup_key` e limite diário (hoje há apenas semanal).
- `agent-proactive-tick` roda por cron; não há painel Admin de comunicações proativas com KPIs. **0%**.
- Métricas de utilidade (respondida, ação executada, custo estimado) ainda não são registradas no fluxo — `communication_deliveries` guarda status/reason mas não interação.

---

## 2. Causas raiz e riscos

- **Admin flicker (Clientes)**: causa raiz confirmada era `can` recriada por render entrando em `useEffect`. Corrigido; risco residual = qualquer novo consumidor voltar a colocar `can` como dep. Mitigação: teste unitário de estabilidade + lint local (regra ad hoc em revisão de PR).
- **RPCs sem allSettled** em Crescimento/Operação: uma RPC quebrada derruba a página inteira. Risco de regressão médio.
- **Template ativo pisando fallback** na Divisão do Rolê: sem migração/checagem, admins que já publicaram um template antigo continuarão enviando texto sem contexto.
- **Proativas — spam WhatsApp**: sem dedup real por `dedup_key` no dispatcher (hoje o `record` faz upsert por `suggestion_id,channel`, mas a política não checa entrega prévia com mesmo `dedup_key`). Risco alto se `scanUser` gerar nova sugestão com mesmo dedup após expiração.
- **Custo IA**: nada mede custo por sugestão hoje. Precisa gancho em `agent_runs`/logger.
- **Segurança**: `agent-proactive-tick` está atrás de `CRON_SECRET` + admin JWT — ok. Precisa manter.

---

## 3. Plano de implementação fechado

Ordem estrita, blocos pequenos e verificáveis. Cada bloco só começa depois que o anterior tem evidência.

### Bloco A — Fechamento Admin (Fase 0 residual)
1. **Resiliência das telas Admin** — arquivos: `src/pages/admin/Crescimento.tsx`, `src/pages/admin/InteligenciaProduto.tsx`, `src/pages/admin/GovernancaAuditoria.tsx`, `src/pages/admin/operacao/{WhatsApp,Saude,IaOcr,Assistente}.tsx`.
   - Migrar múltiplas chamadas para `Promise.allSettled` (padrão Cockpit).
   - Falha isolada mostra `EmptyState` com `adminErrorMessage`, resto da tela renderiza.
   - Reaproveitar `EmptyState`, `Section`, `StatCard`, `AdminErrorBoundary`.
2. **Teste unitário de estabilidade** — `src/hooks/__tests__/usePlatformPermissions.test.ts`: mock RPC, renderiza duas vezes com mesma resposta e afirma `Object.is(prev.can, next.can)` e `prev.permissions === next.permissions`.
3. **Relatório de usuários** — `docs/admin-audit-users-2026-07-27.md` já existe; complementar com CSV opcional em `docs/admin-audit-users-2026-07-27.csv` gerado por query determinística (`v_client_universe`, `platform_admins`, `profiles.is_test`). Anexar SQL exato no doc.
4. **Higiene de logs** — grep `console.(log|debug)` em `supabase/functions/_shared/agent/core/*` e `src/pages/admin/*`; remover diagnósticos; manter `console.warn/error` estruturado.
5. **E2E autenticado (Playwright via shell)** — script em `/tmp/browser/admin-e2e/` que:
   - Restaura sessão Supabase do admin injetada;
   - Navega Cockpit → Crescimento → Clientes → Operação (WhatsApp/Saúde/OCR/Assistente) → IA → Governança;
   - Espera cada tela ficar estável 3s (sem novas requests em `page.on('request')`);
   - Falha se surgir "Erro"/"Algo deu errado" ou console.error;
   - Salva screenshots em `/mnt/documents/admin-e2e/*.png` e um `report.json`.

### Bloco B — Divisão do Rolê comprovada
1. **Auditoria de templates ativos** — script SQL read-only listando `agent_prompt_versions` com `status='active'` cujo `structured_config->'contexts'->'split_*'` não contenha `split_context_sentence`. Documentar em `docs/split-templates-audit-2026-07-27.md`.
2. **Migração de templates ativos (não-destrutiva)** — se a auditoria mostrar templates antigos, criar migration idempotente que insere uma nova versão `draft` com placeholders atualizados (nunca sobrescreve `active`). Admin publica manualmente.
3. **Redeploy `split-reminders-dispatch`** via `supabase--deploy_edge_functions`.
4. **Teste real E2E de envio** — criar rolê de teste com 2 participantes fictícios (números do time), disparar `claim_reminder_jobs`, verificar em `outbound_messages` o campo `body` contendo `total do rolê:` e `dividido entre N pessoas`. Guardar `outbound_messages.id` + screenshot do WhatsApp.
5. **Teste unitário `messageFor`** — novo `supabase/functions/_shared/agent/__tests__/splitMessage.test.ts` cobrindo invite/reminder/due_soon/overdue com N=1/2/5 e pagamento parcial.
6. **Singular/plural + BRL**: já implementado (`participantsCount === 1 ? 'pessoa' : 'pessoas'`, `formatBRL`). Coberto pelo teste unitário acima.

### Bloco C — Comunicações Proativas v1
Reaproveita 100% do que existe. Nada de motor paralelo.

1. **Cobertura dos 5 gatilhos em `InsightsEngine`** — auditar `runAllDetectors`. Para cada gatilho ausente (gasto atípico, vencimento, meta em risco, engajamento, padrão recorrente), adicionar detector puro (função `Insight`) com evidência e `dedup_key` determinístico (`kind:user:contexto:janela`). Amostra mínima ≥ 10 tx / 21 dias para evitar falso positivo.
2. **Política reforçada** — em `supabase/functions/_shared/intelligence/communicationPolicy.ts`:
   - checar `dedup_key` nos últimos 14 dias (não apenas 7);
   - `daily_cap` novo (default 1);
   - respeitar `opt_out` granular por tipo (nova coluna? ou usar `notification_preferences`).
3. **Métricas de utilidade** — adicionar em `communication_deliveries` colunas (via migration idempotente `ALTER TABLE ADD COLUMN IF NOT EXISTS`): `interacted_at`, `action_taken`, `cost_usd`. Dispatcher preenche `cost_usd` a partir de `agent_runs` quando aplicável.
4. **Feedback loop** — evento no app quando o usuário clica na notificação → `notifications.action_url` → registrar `interacted_at` via RPC `notifications_mark_interacted`.
5. **Admin — tela "Comunicação Proativa"** — nova página `src/pages/admin/ComunicacaoProativa.tsx` reutilizando `Section`, `KpiCard`, `DataTable`, `FilterBar`. Consome nova RPC `admin_v2_proactive_summary(_days, _type, _channel)` retornando: gerada / bloqueada / enfileirada / entregue / falhou / respondida / opt_out / ação / custo. Rota adicionada em `AdminLayout` (item `Proatividade` sob "Operação").
6. **Deploy** `agent-proactive-tick` e verificação manual: chamar com `force=true` para um `user_id` de teste, conferir `pending_proactive_suggestions` + `communication_deliveries` + notificação in-app.

---

## 4. Plano de testes e evidências

- **Unitários** (Vitest):
  - `usePlatformPermissions.test.ts` — estabilidade de referência.
  - `splitMessage.test.ts` — 6 kinds × 3 cenários de N + parcial.
  - `communicationPolicy.test.ts` — daily cap, dedup 14d, opt-out por tipo.
  - `InsightsEngine.test.ts` — cada detector com/sem amostra suficiente.
- **Integração**: script `deno test` em `supabase/functions/_shared/agent/__tests__/proactiveFlow.test.ts` com Supabase mock cobrindo `scanUser → dispatchSuggestions`.
- **Contratos RPC**: `supabase--read_query` executando `select * from admin_v2_*(...)` com args reais e conferindo shape esperado.
- **E2E autenticado** (Playwright, headless, sessão admin injetada): 8 telas Admin + Comunicação Proativa nova. Screenshots em `/mnt/documents/admin-e2e/`.
- **Teste real WhatsApp**: envio de convite Divisão do Rolê + captura em `outbound_messages` (`body` contendo campos novos) + screenshot do WhatsApp real. Guardar em `docs/split-evidencia-2026-07-27.md`.
- **Evidência de deploy**: output de `supabase--deploy_edge_functions` para `split-reminders-dispatch` e `agent-proactive-tick`.

---

## 5. Critérios de aceite por frente

**Admin**
- Nenhuma tela quebra por RPC única com erro; degradação parcial visível.
- Aba Clientes carrega 1× por mudança real (verificado via `page.on('request')`).
- E2E aprovado com 8 telas + screenshots anexados.
- Teste unitário de estabilidade de `usePlatformPermissions` passa.
- Relatório de usuários versionado com SQL rastreável.

**Divisão do Rolê**
- Template ativo contém `{{split_context_sentence}}` OU fallback usado.
- Envio real registra em `outbound_messages` texto com `total do rolê: R$ ...` e `dividido entre N pessoas`.
- Testes unitários dos 6 kinds passam.
- Edge function redeployada (log de deploy anexado).

**Proativas**
- 5 gatilhos executando em ao menos 1 usuário real com evidência (`pending_proactive_suggestions` + `communication_deliveries`).
- Dedup 14d funcionando (mesmo `dedup_key` não gera 2 entregas).
- Daily cap + opt-out respeitados em teste manual.
- Tela Admin renderiza KPIs com dados reais.
- Custo IA registrado em `communication_deliveries.cost_usd` (mesmo que 0 quando puramente determinístico).

---

## 6. Checklist final de execução

Admin
- [ ] `Promise.allSettled` + EmptyState em Crescimento, InteligenciaProduto, GovernancaAuditoria, operacao/{WhatsApp,Saude,IaOcr,Assistente}.
- [ ] Teste `usePlatformPermissions.test.ts` verde.
- [ ] `console.log`/`debug` removidos de `agent/core/*` (mantendo `warn`/`error`).
- [ ] Relatório de usuários + CSV + SQL versionado.
- [ ] Playwright E2E autenticado passando; screenshots anexados.

Divisão do Rolê
- [ ] Auditoria de templates ativos documentada.
- [ ] Testes unitários `splitMessage.test.ts` verdes.
- [ ] `split-reminders-dispatch` redeployado.
- [ ] Envio real registrado com evidência (`outbound_messages` + screenshot).

Proativas
- [ ] 5 detectores confirmados em `InsightsEngine`.
- [ ] `communicationPolicy` com dedup 14d + daily cap + opt-out por tipo (teste verde).
- [ ] Migration idempotente para `communication_deliveries.interacted_at/action_taken/cost_usd`.
- [ ] RPC `admin_v2_proactive_summary` criada + GRANT.
- [ ] Tela `ComunicacaoProativa.tsx` no AdminLayout, com dados reais.
- [ ] `agent-proactive-tick` redeployado; run manual com `force=true` documentado.

---

## 7. Estimativa

| Bloco | Complexidade | Depende de | Paraleliza com |
|---|---|---|---|
| A. Admin resiliência + logs | M | — | B1, B5 |
| A5. E2E Playwright | M | A1 | C6 |
| B. Divisão do Rolê | S | — | A1 |
| C1–C4. Proativas backend | L | — | A1 |
| C5. Admin Proatividade UI | M | C1–C4 | A5 |

Ordem recomendada: **A1 ∥ B1–B5 ∥ C1–C4** → **A2/A3/A4** → **C5** → **A5 (E2E) cobrindo tudo**.

Percentual esperado ao final: **Admin 100%**, **Divisão do Rolê 100% (com evidência)**, **Proativas v1 100%** (v2 — reinforcement/aprendizado — fica para próxima rodada explicitamente fora deste plano).
