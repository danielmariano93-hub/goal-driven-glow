
# Plano Único — Fechamento Meu Nino + Painel Admin + Divisão do Rolê + Metas Conjuntas

## 1. Diagnóstico do estado atual (por domínio)

**Confirmado no código (leituras deste turno):**
- `supabase/migrations/20260727120000_wave1_bill_payment_and_orphan_sweep.sql`: contém `CREATE TRIGGER trg_transactions_fill_competence_date` **sem** `DROP TRIGGER IF EXISTS` antes — quebra em ambiente já migrado se reexecutar. Tem `GRANT/REVOKE` parcial, snapshot em `wave1_pre_snapshot`, flags `use_wave1_bill_payment` e `use_v2_artifact_normalizer` criadas como colunas.
- `src/lib/db/finance.ts` (742 linhas): read-after-write parcial; ainda há divergência de query keys `credit_cards` vs `credit-cards` conforme histórico.
- `supabase/functions/_shared/agent/core/adapters/AppAdapter.ts` (314 linhas): já persiste `artifact_ids`; NÃO usa RPC unificada de movimentação.
- `supabase/functions/_shared/agent/core/ConversationHistory.ts` (62 linhas): reidrata artefatos.
- Edge Functions ativas: `agent-run`, `agent-chat`, `artifact-render`, `whatsapp-webhook`, `whatsapp-send`, `whatsapp-ack-watchdog`, `split-reminders-dispatch` etc.
- `supabase/config.toml`: `whatsapp-webhook`, `whatsapp-ack-watchdog`, `split-reminders-dispatch` com `verify_jwt=false`.
- `src/pages/DivisaoDoRole.tsx`: telefone digitado manualmente; sem separação criado/participado; sem notificação in-app; sem deep link.
- Não existe `commit_movement` RPC nem tabelas `shared_goals`.

**Hipóteses a validar antes de codar (Onda 0):**
- Estado real das flags em produção (`SELECT * FROM financial_feature_flags`).
- Cron `pg_cron` jobs atuais (nome, schedule, secret): consultar `cron.job`.
- Existência de índice em `agent_runs(status, started_at)` para sweep.
- Se `_exec_credit_card_bill_payment` aceita alias `from1_account` (o histórico sugere que sim).
- Universo real de clientes (`v_client_universe` existe? divergência com `platform_admins`?).

**Pendências confirmadas:**
- RPC `commit_movement` (Ondas 2.1/2.2) — não implementada.
- Feature flags são colunas mas não são LIDAS por nenhum ponto crítico.
- Migration Wave1 não é idempotente para `CREATE TRIGGER`.
- Guardrail por canal (App vs WhatsApp) ainda misturado em `ResponseValidator`.
- FastLog lifecycle depende de exceção de topo.
- Fila WhatsApp sem dead-letter formal nem alerta >60s.
- Divisão do Rolê: sem Contact Picker, sem vínculo por telefone, sem notificação, sem convite duplo.
- Metas conjuntas: inexistente.
- Admin: `v_client_universe` provavelmente aplicado, mas KPIs de fluxo x estoque não separados visualmente; falta cockpit operacional de fila/artefatos/FastLog.

## 2. Arquitetura-alvo

```text
┌──────────────────────────────────────────────────────────────┐
│  App (React)         WhatsApp (WAHA)         Admin Console   │
└─────────┬────────────────────┬──────────────────────┬────────┘
          │                    │                      │
          ▼                    ▼                      ▼
     AppAdapter          WhatsAppAdapter        admin_v2_* RPCs
          │                    │                      │
          └────────► AgentCore (IntentRouter, PolicyEngine, ToolRuntime)
                              │
                              ▼
              ┌──────────────────────────────┐
              │  RPC commit_movement (única) │◄── feature flag effective
              │  RPC agent_execute_confirm.  │
              │  RPC shared_goal_*, split_*  │
              └───────────────┬──────────────┘
                              ▼
                         Postgres + RLS
                              │
                    OutboundQueue (cron+lease+DLQ)
                              │
                          WAHA provider
```

**Princípios:**
- Toda escrita financeira passa por `commit_movement(payload jsonb)` — SECURITY DEFINER, valida ownership via `auth.uid()`, idempotência por `idempotency_key`.
- Contrato de artefato canônico `chart.artifact.v2` validado com Zod tanto no App quanto na Edge Function.
- Guardrail por canal: `ChannelGuard.assertRenderable(channel, artifact)` antes de qualquer afirmação de "gerei/enviei".
- Feature flags lidas via `getEffectiveFlags(user_id)` cacheadas 60s no runtime.

## 3. Modelo de dados

**Alterações aditivas:**
- `financial_feature_flags`: já existe. Nenhuma alteração.
- `agent_runs`: adicionar `trace_id text`, `channel text`, índice `(status, started_at)`.
- `outbound_messages`: adicionar `dead_letter_at timestamptz`, `attempts int`, `last_error text`, `sla_breach_at timestamptz`.
- `shared_expenses`: adicionar `referral_source text`, `invite_message_id_secondary uuid`.
- `shared_expense_participants`: adicionar `linked_user_id uuid REFERENCES auth.users`, `invite_status text`, `viewed_at timestamptz`, `notified_in_app_at timestamptz`.

**Novas tabelas:**
- `shared_goals(id, title, target_amount, deadline, created_by, referral_source, created_at, updated_at)`
- `shared_goal_members(goal_id, user_id, phone_e164, role[owner|member], invite_status, joined_at, contribution_total, unique(goal_id, user_id or phone_e164))`
- `shared_goal_contributions(id, goal_id, user_id, amount, occurred_at, transaction_id, note)`
- `shared_goal_invites(id, goal_id, phone_e164, invited_by, status, token, expires_at, accepted_by_user_id)`
- `notifications` (se ainda não abrangente): tipos `split_created`, `split_paid`, `goal_invite`, `goal_contribution`, `goal_milestone`.

**Views/RPCs:**
- `v_client_universe` (excluir `platform_admins`).
- `commit_movement(payload jsonb) returns jsonb`.
- `shared_goal_create/invite/accept/decline/contribute/leave/remove_member`.
- `split_link_participant_to_user(participant_id)` — chamado quando usuário cadastra com telefone que já é participante.
- Trigger `AFTER INSERT ON profiles`: procurar `shared_expense_participants` e `shared_goal_invites` com telefone match e vincular.

## 4. Migrations (ordem exata)

1. `20260728000000_wave1_migration_hardening.sql`
   - `DROP TRIGGER IF EXISTS trg_transactions_fill_competence_date ON public.transactions;` antes do `CREATE TRIGGER`.
   - Idempotência para todos os `CREATE POLICY` via `DO $$ IF NOT EXISTS`.
   - `REVOKE EXECUTE ... FROM PUBLIC` em `_exec_credit_card_bill_payment`, `agent_execute_confirmation*`, `sweep_orphan_agent_runs`.
   - `GRANT EXECUTE ... TO service_role` explícito.
   - Índice `agent_runs(status, started_at)`.

2. `20260728010000_commit_movement_rpc.sql`
   - `commit_movement(payload jsonb)` SECURITY DEFINER, valida `auth.uid()`, valida UUID/data/valor, idempotência por `idempotency_keys`, aceita apenas nomes canônicos (`account_id`, não `from1_account`), retorna linha final. Trata `movement_kind IN ('income','expense','transfer','credit_card_bill_payment','investment_movement')`.
   - `REVOKE FROM PUBLIC`; `GRANT EXECUTE TO authenticated`.

3. `20260728020000_client_universe_and_admin_flow_metrics.sql`
   - `v_client_universe` (auth.users − platform_admins).
   - RPCs `admin_v2_flow_by_period(_from,_to,_tz)`, `admin_v2_daily_lifecycle(_from,_to,_tz)`.
   - `admin_v2_ops_cockpit()` (queue depth, artifact failures, fastlog error rate, edge fn latencies).

4. `20260728030000_shared_goals.sql`
   - Cria tabelas `shared_goals`, `shared_goal_members`, `shared_goal_contributions`, `shared_goal_invites` com GRANTs e RLS (owner/member podem ler; só owner edita meta; membro registra própria contribuição).

5. `20260728040000_split_link_and_referral.sql`
   - Colunas aditivas em `shared_expenses` e `shared_expense_participants`.
   - Função `link_participants_on_profile_created()` + trigger em `profiles`.
   - RPC `create_secondary_invite_message(participant_id)` idempotente por `(participant_id, kind='invite')`.

6. `20260728050000_outbound_dlq_and_observability.sql`
   - Colunas em `outbound_messages`; view `v_outbound_sla_breach`; RPC `admin_v2_outbound_queue()`.
   - `cron.schedule('outbound-dispatch-1m', '* * * * *', ...)` versionado no arquivo mas usando Vault para o secret — o próprio schedule é criado apenas se não existir.

7. `20260728060000_notifications_extension.sql`
   - Enum `notification_type` acrescido de `goal_invite`, `goal_contribution`, `goal_milestone`, `split_participant_linked`.

Cada migration termina com `SELECT ... snapshot pós` em `wave1_pre_snapshot` (label específico) para auditoria.

## 5. Arquivos e funções — inventário completo

**Backend/DB:**
- `supabase/migrations/2026072800000..060000_*.sql` (7 arquivos acima).

**Edge Functions:**
- `_shared/finance/commitMovement.ts` (novo, wrapper cliente da RPC).
- `_shared/artifacts/schema.ts` — endurecer Zod, `contract_version:"v2"` obrigatório, rejeitar séries vazias/labels desalinhados.
- `_shared/artifacts/normalize.ts`, `builder.ts`, `png.ts` — usar Zod strict.
- `_shared/agent/core/ChannelGuard.ts` (novo).
- `_shared/agent/core/ResponseValidator.ts` — usar `ChannelGuard`.
- `_shared/agent/core/adapters/AppAdapter.ts` — usar `commit_movement`.
- `_shared/agent/core/adapters/WhatsAppAdapter.ts` — usar `commit_movement`; afirmar entrega apenas após provider ack.
- `_shared/agent/core/FeatureFlags.ts` (novo) — leitura efetiva.
- `_shared/agent/core/FastLogLifecycle.ts` — `try/finally` real, marca `done|error`, `ended_at`, `error_sanitized`.
- `_shared/observability/traceId.ts` (novo).
- `artifact-render/index.ts` — usar schema Zod strict; timeout 25s; retry 2×; persistir `media_path`, `media_mime`, `rendered_at`.
- `whatsapp-send/index.ts` — vincular `outbound_messages.artifact_id`, retornar apenas após provider accept.
- `whatsapp-webhook/index.ts` — normalizar telefone; disparar `link_participants_on_profile_created` indiretamente via profile creation.
- `split-reminders-dispatch/index.ts` — segunda mensagem de convite com espaçamento; idempotência.
- `agent-run/index.ts` — trace_id, channel.

**Novas Edge Functions:**
- `shared-goal-invite/index.ts` — cria convite + envia mensagem (WhatsApp/in-app).
- `outbound-dispatch/index.ts` — worker de fila com lease/DLQ (invocado por cron).

**Frontend:**
- `src/lib/db/finance.ts` — todos os saves via `supabase.rpc('commit_movement', ...)`; read-after-write; `setQueryData` + invalidação.
- `src/lib/db/queryKeys.ts` (novo) — chaves padronizadas.
- `src/lib/db/invalidation.ts` — refactor para chaves padronizadas.
- `src/components/assessor/AssessorPanel.tsx` — hidratação artefato + guardrail por canal.
- `src/components/assessor/artifacts/ChartArtifactRenderer.tsx` — Zod validation.
- `src/pages/Lancamentos.tsx` — banner "salvo mas oculto" + botão limpar filtros.
- **Divisão do Rolê:**
  - `src/pages/DivisaoDoRole.tsx` — abas "Criados por mim" / "Estou participando".
  - `src/pages/DivisaoDoRoleNova.tsx` — `ContactPickerButton` + fallback manual.
  - `src/components/split/ContactPickerButton.tsx` (novo) — usa Contact Picker API com fallback.
  - `src/components/split/ParticipatingList.tsx` (novo).
  - `src/pages/DivisaoDoRoleDetalhe.tsx` — timeline visual, status, ações.
- **Metas conjuntas:**
  - `src/pages/Metas.tsx` — filtro individual/conjunta, badge.
  - `src/pages/MetaConjuntaNova.tsx` (novo).
  - `src/pages/MetaDetalhe.tsx` (novo/refactor) — avatares, contribuições por pessoa, ritmo, próximo marco.
  - `src/components/metas/SharedGoalCard.tsx` (novo).
  - `src/components/metas/InviteMemberSheet.tsx` (novo).
- `src/components/NotificationBell.tsx` — novos tipos `goal_*` e `split_participant_linked`.
- **Admin:**
  - `src/pages/admin/Cockpit.tsx` — adicionar filtros temporais completos, cards "estoque vs fluxo vs acumulado vs evento diário".
  - `src/pages/admin/Clientes.tsx` — busca, paginação, lifecycle.
  - `src/pages/admin/operacao/WhatsApp.tsx` — dashboard de fila (depth, SLA breach, DLQ).
  - `src/pages/admin/operacao/Artefatos.tsx` (novo).
  - `src/pages/admin/operacao/FastLog.tsx` (novo).
  - `src/lib/admin/periodPresets.ts` — Hoje/Ontem/7d/30d/mês atual/mês anterior/dia/intervalo.

**Testes:** ver seção 10.

## 6. Sequência de implementação (ondas internas, sem deixar P0 aberto)

**Onda 0 — Validação prévia (30min, sem código):**
- `psql` reads: `financial_feature_flags`, `cron.job`, `pg_indexes` em `agent_runs`, contagem admins vs clients, existência `v_client_universe`.
- Gate: só prossegue com relatório em `.lovable/pre-flight-snapshot.md`.

**Onda 1 — Migrations de hardening (P0, backend puro):**
- Executar migrations 1, 2, 3 acima.
- Snapshot pós em `wave1_pre_snapshot`.

**Onda 2 — Core financeiro unificado (P0):**
- `commit_movement` wrapper + refactor de `finance.ts` + read-after-write + query keys unificadas.
- Banner de filtros ocultos em `Lancamentos.tsx`.
- Testes 5.1 verdes antes de continuar.

**Onda 3 — Artefatos e guardrails (P0):**
- Zod strict em `schema.ts`; `ChannelGuard`; refactor `ResponseValidator`; `artifact-render` com timeout/retry.
- Pipeline único: detectar → tool → validar → persistir → renderizar → entregar.
- Testes 5.2 verdes.

**Onda 4 — FastLog + fila WhatsApp (P0):**
- `FastLogLifecycle` com try/finally.
- `outbound-dispatch` worker + DLQ + alerta SLA >60s.
- Cron versionado.
- Testes 5.3 verdes.

**Onda 5 — Feature flags efetivas (P0):**
- `FeatureFlags.ts` lido por `AppAdapter`, `WhatsAppAdapter`, `artifact-render`, `finance.ts`.
- Toggle admin no cockpit.
- Testes on/off por flag.

**Onda 6 — Admin (P1):**
- Migration 3 (`v_client_universe`, `admin_v2_flow_by_period`, `admin_v2_daily_lifecycle`, `admin_v2_ops_cockpit`).
- Refactor páginas admin; período completo; cockpit operacional; tela Clientes.
- Testes 5.4.

**Onda 7 — Divisão do Rolê v2 (P1):**
- Migrations 4/5 + link on profile create.
- `ContactPickerButton` + fallback.
- Abas criados/participados.
- Segunda mensagem (convite) idempotente com espaçamento.
- Notificação in-app + realtime.
- Testes 5.5.

**Onda 8 — Metas conjuntas (P1):**
- Migration 4 (shared_goals) + 6 (notifications).
- CRUD, convite, aceite, contribuições.
- Assessor: tools `create_shared_goal_draft`, `contribute_shared_goal_draft`, `explain_shared_goal_progress`.
- Home + Metas com badge e filtro.
- Testes 5.6.

**Onda 9 — QA, deploy, publicação (P0 encerra):**
- Suíte completa verde + typecheck + lint + build.
- Deploy Edge Functions afetadas.
- Publicação frontend.
- Comparar SHAs.

## 7. Dependências e riscos

- **Risco alto:** refactor de `finance.ts` para `commit_movement` pode quebrar Home/Lançamentos se query keys não forem migradas juntas. Mitigar: fazer Onda 2 num único passo atômico com testes.
- **Risco médio:** Contact Picker API não é suportada em iOS Safari. Aceito: fallback manual sempre disponível.
- **Risco médio:** cron do `outbound-dispatch` conflita com watchdog existente. Antes de criar, verificar em Onda 0.
- **Risco baixo:** Zod strict pode rejeitar artefatos legados em histórico. Mitigar: normalizer v1→v2 no path de leitura.

## 8. Rollback

- Cada migration é aditiva; rollback via flag `use_wave1_bill_payment=false`, `use_v2_artifact_normalizer=false`.
- `commit_movement`: fallback lê flag `use_commit_movement_rpc` (nova coluna); se `false`, `finance.ts` cai no path direto (mantido por 1 sprint).
- Novas tabelas (`shared_goals*`) — remover via migration reversa se necessário; sem dado legado a preservar.
- Frontend: reverter deploy anterior via SHA registrado no checklist.

## 9. Testes por etapa

Ver seções 5.1–5.7 do prompt do usuário — adotadas integralmente. Adições:
- `commit_movement.test.ts` — todos os payloads inválidos.
- `channel_guard.test.ts` — App vs WhatsApp separados.
- `fastlog_lifecycle.test.ts` — done/error paths.
- `outbound_queue.test.ts` — lease/retry/DLQ.
- `shared_goal_flow.test.ts` — convite → aceite → contribuição.
- `split_link_on_signup.test.ts` — trigger de vínculo.
- `admin_client_universe.test.ts` — admins fora das métricas.
- `contact_picker.test.tsx` — presença de fallback.

## 10. Deploy/publicação

1. Aplicar migrations 1→7 em ordem.
2. Deploy Edge Functions afetadas: `artifact-render`, `agent-run`, `agent-chat`, `whatsapp-send`, `whatsapp-webhook`, `split-reminders-dispatch`, `outbound-dispatch` (novo), `shared-goal-invite` (novo).
3. `bun test` full + typecheck + build.
4. Frontend publish via `preview_ui--publish`.
5. Registrar SHA repo, SHA edge, SHA frontend em `.lovable/wave2-release.md`.

## 11. Homologação

Cenários E2E manuais (checklist gravado):
- Fluxo compra R$120 no cartão + pagamento fatura R$4639,73 → consumo não sobe.
- Pedido "me mostra um gráfico dos últimos 30 dias" no App e no WhatsApp.
- FastLog `!ja 25 café` → transação salva, run `done`.
- Criar rolê com contato existente → participante vê rolê ao logar.
- Criar rolê com número novo → convidado recebe mensagem 1 e mensagem 2 espaçadas.
- Meta conjunta com dois usuários → ambos veem contribuições.
- Admin: dois clientes reais aparecem, admin excluído.

## 12. Critérios objetivos de `COMPLETED`

Todos os itens abaixo verdes:
- [ ] Migrations 1–7 aplicadas e re-executáveis (`bun run migrate` sem erro em ambiente limpo).
- [ ] `commit_movement` cobre 5 kinds e rejeita 8 payloads inválidos (testes).
- [ ] `chart.artifact.v2` Zod strict — 0 uso de `any` no contrato público.
- [ ] Guardrail por canal com testes App e WhatsApp separados.
- [ ] FastLog `done|error` sempre gravado; sweep sem itens presos.
- [ ] Fila WhatsApp com DLQ + alerta >60s + cron versionado.
- [ ] Admin: dois clientes reais, filtros completos, cockpit operacional.
- [ ] Divisão do Rolê com Contact Picker + fallback + abas + convite duplo + vínculo automático.
- [ ] Metas conjuntas com convite/aceite/contribuição/RLS + comandos do agente.
- [ ] Suíte completa verde + typecheck + lint + build.
- [ ] SHAs registrados.

## 13. Tabela final

| Bloco | Estado atual | Alteração | Evidência esperada | Aceite |
|---|---|---|---|---|
| Migration Wave1 | `CREATE TRIGGER` sem guard | Migration 1 idempotente | Rerun limpo | `psql` reexecuta OK |
| commit_movement | Inexistente | Migration 2 + refactor `finance.ts` | RPC + 5 kinds | Testes 5.1 verdes |
| Feature flags | Colunas mortas | `FeatureFlags.ts` + gating | flag off ↔ path antigo | Toggle admin funcional |
| Read-after-write | Parcial | `.select().single()` obrigatório | Home imediata | Teste visibilidade |
| Query keys | `credit_cards` vs `credit-cards` | `queryKeys.ts` central | Grep zero divergência | Build limpo |
| Artefatos | Zod fraco | Schema strict + normalizer | 0 `any` público | Teste 5.2 |
| Guardrail canal | Misto | `ChannelGuard` | Testes separados | 5.2 |
| FastLog | Depende de exceção | try/finally | `agent_runs.ended_at` sempre | 5.3 |
| Fila WA | Sem DLQ | `outbound-dispatch` + cron | `outbound_messages.dead_letter_at` | 5.3 |
| Admin clientes | Mistura admin | `v_client_universe` | 2 clientes reais | 5.4 |
| Filtros temporais | Parcial | `periodPresets.ts` completo | 8 presets | 5.4 |
| Cockpit ops | Ausente | `admin_v2_ops_cockpit` | Nova página | 5.4 |
| Divisão contatos | Manual | Contact Picker + fallback | Botão + input | 5.5 |
| Divisão vínculo | Ausente | Trigger + notificação | Aba "Participando" | 5.5 |
| Convite duplo | Ausente | 2ª mensagem espaçada | outbound registros | 5.5 |
| Metas conjuntas | Ausente | Migration 4 + UI + agente | Tabelas + telas | 5.6 |

## 14. Estimativa de esforço/créditos

- Onda 0: baixo (leituras).
- Onda 1: médio (migrations).
- Onda 2: alto (refactor `finance.ts`).
- Onda 3: médio-alto (artefatos).
- Onda 4: médio (fila).
- Onda 5: baixo (flags).
- Onda 6: médio (admin).
- Onda 7: alto (divisão do rolê).
- Onda 8: alto (metas conjuntas).
- Onda 9: baixo-médio (QA + deploy).

## 15. Prompt interno de execução (auto-suficiente pós-aprovação)

> Executar plano em 9 ondas sem parar entre elas. Ordem: 0→1→2→3→4→5→6→7→8→9. Não pular P0. Cada onda:
> 1. Ler arquivos afetados.
> 2. Aplicar migrations/edits em paralelo quando independentes.
> 3. Rodar `bunx vitest run` da suíte relevante.
> 4. Só avançar quando verde.
> 5. Registrar em `.lovable/wave2-progress.md`.
>
> Regras de segurança: nunca alterar migrations históricas; toda RPC nova com `REVOKE FROM PUBLIC` + `GRANT` explícito; nenhum `any` em contrato público; toda escrita financeira via `commit_movement`; toda afirmação de "gerei/enviei gráfico" passa por `ChannelGuard`; toda mensagem outbound tem idempotency key; FastLog sempre finaliza status.
>
> Ao final da Onda 9: `preview_ui--publish` + registrar SHAs em `.lovable/wave2-release.md`. Não considerar COMPLETED sem checklist da Seção 12 100% verde.
