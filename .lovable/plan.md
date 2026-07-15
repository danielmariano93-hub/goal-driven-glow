
# Plano — Conclusão do Beta NoControle.ia

Escopo priorizado com ordem de execução por dependências. Preservar design, banco atual e infraestrutura WAHA. Migrations apenas incrementais. Sem publish/deploy.

## Prioridade 1 — Agente LLM real + segurança/consistência

**Migration incremental** (`agent_hardening`):
- `agent_runs`: adicionar `path text check in ('llm','deterministic_fallback')`, `model`, `prompt_version_id`, `tokens_in/out`, `cost_cents`, `latency_ms`, `error_sanitized`.
- `agent_tool_calls`: nova tabela (run_id, step_index, tool_name, args_jsonb, result_jsonb, ok, duration_ms, error).
- `phone_link_codes`: adicionar `lookup_key` (hash HMAC do código com pepper server-side) + índice único parcial (ativo, não expirado). Manter `code_hash` (bcrypt/argon-like) para verificação.
- `outbound_messages`: adicionar status `processing`, `claimed_at`, `lease_expires_at`. Atualizar `claim_outbound_batch` para NÃO marcar `sent` antecipadamente; nova RPC `mark_outbound_sent(id, provider_message_id)` e `recover_expired_leases()`.
- `pending_confirmations`: adicionar `conversation_id` obrigatório na validação de CONFIRMAR/CANCELAR (já existe; reforçar checagem no executor).
- `profiles.is_sandbox` já existe — validar uso.

**Edge Functions**:
- `supabase/functions/agent-run/index.ts`: reescrever para chamar Lovable AI Gateway (`LOVABLE_API_KEY`) via `@ai-sdk/openai-compatible` + `streamText`/`generateText` com tool calling estruturado. `stopWhen: stepCountIs(8)`, timeout, captura de tokens/custo/latência. Carrega prompt ativo de `agent_prompt_versions`. Se `LOVABLE_API_KEY` ausente OU erro → fallback determinístico rotulado (`path='deterministic_fallback'`). Registra `agent_runs` + `agent_steps` + `agent_tool_calls` a cada passo.
- `_shared/agent/tools.ts`: definir 11 tools (Zod schemas estritos) — `list_accounts`, `list_categories`, `get_financial_summary`, `list_recent_transactions`, `create_transaction_draft`, `create_transfer_draft`, `create_goal_draft`, `add_goal_contribution_draft`, `create_debt_draft`, `run_before_spending`, `cancel_pending_action`. Cada `execute` recebe `user_id` do contexto do servidor (nunca do modelo), valida ownership no SQL, chama RPCs existentes ou `agent_upsert_draft`.
- `run_before_spending` chama motor factual completo (portar `src/lib/engine/facts.ts` para `_shared/engine/facts.ts` reutilizável).
- `whatsapp-webhook`: adicionar limite de body (ex. 128KB), validar timestamp (±5min), rejeitar tipos não suportados, dedupe por `provider_message_id`. Detectar CONFIRMAR/CANCELAR com validação de conversa/telefone antes de executar.
- `whatsapp-send`: usar `processing → sent` após `sendText` OK. `whatsapp-ack-watchdog`: recuperar leases expirados.
- `agent-run` só aceita `user_id` derivado (a) do webhook via `whatsapp_links` verificado ou (b) admin com `profiles.is_sandbox=true`.

**Estado conversacional**: `conversations` já tem coluna? Adicionar `pending_slots jsonb` para follow-up (ex. "quanto?", "que conta?").

## Prioridade 2 — Divisão do Rolê

**Migration** (`shared_expenses`):
- `shared_expenses` (id, owner_user_id, title, total_amount, occurred_at, due_at, note, financial_transaction_id nullable, status, created_at/updated_at).
- `shared_expense_participants` (id, shared_expense_id, name, phone_e164_masked, phone_lookup_hash, amount, status pendente/pago/dispensado, paid_at, opt_out bool, last_reminder_at).
- RLS: só owner acessa; participantes NÃO leem uns aos outros.
- `reminder_jobs` (id, participant_id, scheduled_at, status, sent_at, error, rate_limit_bucket).
- RPCs: `create_shared_expense_draft`, `confirm_shared_expense`, `mark_participant_paid`, `send_participant_reminder` (com rate limit, quiet hours 22h-8h SP, cooldown 24h).

**UI**: `/app/divisao-do-role` — lista + criar (total, participantes com nomes/telefones, divisão igual/custom com validação de centavos = total), revisão, confirmação, histórico, botão reenvio manual.

**Agente**: tool `create_shared_expense_draft`; parser BR entende "dividi 300 entre eu, Ana e João". Pede nomes/telefones ausentes via follow-up. Lembretes só após CONFIRMAR.

**Mensagem de cobrança**: template não revela outros participantes; identifica cobrador/título/valor/vencimento; suporta opt-out ("PARAR").

## Prioridade 3 — Importadores

**Legado real** (`import_legacy_batch`): reescrever para aceitar `lancamentos`, `metas`, `aportes`, `dividas`, `investimentos`, `emocoes`, `contasFixas`, `config`, `categoriasCustom` (string[]). Mapear enums PT→EN (receita→income, despesa→expense, etc.), campos snake_case/PT. Dry-run com prévia por entidade. Erros por linha em `import_rows.notes`. Idempotência via `external_id`.

**CSV/OFX**: nova página `/app/importar` com upload local (limite 5MB), preview com mapeamento de colunas, escolha de conta destino, dedup por (data+valor+descrição) hash, confirmação antes de gravar. Parser CSV client-side (PapaParse) e OFX (regex/parser leve). Sem Open Finance.

## Prioridade 4 — Recorrências

Tabela `recurring_entries` já existe. UI `/app/recorrencias`: CRUD (receita/despesa, valor, conta, categoria, frequência mensal/semanal/anual, próxima data, data final, ativa/pausada). RPC `generate_recurring_planned(user_id, until_date)` idempotente (chave: recurring_id + data_alvo). Exibir próximos 30d no dashboard e no `run_before_spending`. Planned vs confirmed distintos.

## Prioridade 5 — Relatórios

Substituir placeholder `/app/relatorios`: gráficos (receitas x despesas por mês, top categorias, evolução patrimônio, metas/investimentos/dívidas). Filtros por período/conta/categoria. Exportação CSV. Empty states. Sem projeções inventadas — só fatos históricos.

## Prioridade 6 — Desafios

Tabelas `challenges`/`user_challenges` já existem. UI `/app/desafios`: catálogo, aderir/pausar/abandonar/concluir. Progresso derivado de fatos (query em transactions/goal_contributions), idempotente. Streak em `America/Sao_Paulo`. XP/conquistas idempotentes via eventos. Sem ranking.

## Admin / Simulador

- `/admin/agente`: expor path (llm/fallback), modelo, prompt versão, steps, tools chamadas, tokens/custo por run. Métricas agregadas sem PII.
- Editor de prompt: draft → validar → publicar → rollback → diff. Auditoria em `agent_prompt_versions`.
- Botão "Testar WAHA" e "Testar IA" separados, com resposta real.
- Simulador: apenas usuários `is_sandbox=true`.

## Testes

Novos:
- `agent-orchestrator.test.ts`: LLM mockado + fallback rotulado.
- `agent-tools.test.ts`: cada tool com ownership violation.
- `outbox-lease.test.ts`: concorrência claim/recover.
- `phone-link.test.ts`: lookup seguro, TTL, tentativas, cooldown.
- `import-legacy-real.test.ts`: fixture `financial_ecosystem_v2` real.
- `import-csv-ofx.test.ts`: parsers.
- `shared-expense.test.ts`: divisão igual/custom centavos, lembrete rate limit.
- `recurring.test.ts`: idempotência.
- `challenges.test.ts`: progresso factual.
- Isolamento RLS entre 2 users (integração).

Rodar `vitest run`, `tsgo --noEmit`, `vite build`.

## Arquivos principais

**Criar**:
- `supabase/functions/_shared/agent/tools.ts`, `llm.ts`, `prompt.ts`
- `supabase/functions/_shared/engine/facts.ts` (portado)
- `supabase/functions/shared-expense-reminder/index.ts`
- `supabase/functions/recurring-generate/index.ts`
- `src/pages/DivisaoDoRole.tsx`, `Recorrencias.tsx`, `Desafios.tsx`
- `src/pages/Relatorios.tsx` (rewrite)
- `src/pages/Importar.tsx` (extend com CSV/OFX)
- `src/lib/import/{csv,ofx,legacy}.ts`
- `src/lib/engine/before-spending.ts` (motor completo compartilhado)
- Migrations: `agent_hardening`, `shared_expenses`, `outbox_lease`, `phone_link_lookup`

**Editar**:
- `supabase/functions/agent-run/index.ts` (rewrite completo)
- `supabase/functions/whatsapp-webhook/index.ts`, `whatsapp-send/index.ts`, `whatsapp-ack-watchdog/index.ts`
- `src/App.tsx` (rotas), `MaisMenu.tsx`, `DesktopSidebar.tsx`
- `src/pages/admin/Agente.tsx`, `AgenteSimulador.tsx`
- `src/integrations/supabase/types.ts` (regen auto)

## Riscos

- Sem `LOVABLE_API_KEY` configurado o agente opera só em fallback determinístico rotulado — admin exibe estado real.
- Sem `WAHA_*` os lembretes ficam com status `not_sent` explícito.
- Parser OFX simples pode falhar em formatos exóticos — reportar linha.
- LGPD: telefones de participantes armazenados hasheados + máscara para exibição.

## Estimativa de créditos

Alta. Priorização estrita (1→6) garante que interrupção deixe núcleo (agente+segurança+divisão) funcional. Recorrências/relatórios/desafios são incrementais sobre schema existente.

## Ordem de implementação

1. Migration `agent_hardening` + `outbox_lease` + `phone_link_lookup`
2. `_shared/agent/{llm,tools,prompt}.ts` + rewrite `agent-run`
3. Hardening webhook/send/watchdog
4. Testes agente + outbox + phone-link
5. Migration `shared_expenses` + UI + tool no agente + reminder function
6. Importador legado real + CSV/OFX
7. UI Recorrências + generate function
8. Relatórios reais
9. Desafios UI + progresso
10. Admin editor de prompt + métricas
11. Testes finais, typecheck, build

Ao final: relatar em 3 blocos (evidências, entregue, dependências externas: `LOVABLE_API_KEY`, `WAHA_*`).
