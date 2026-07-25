
# Pacote único — Comunicação enxuta + Tools do Assessor para Metas Conjuntas

Objetivo: uma rodada só. Encostar as pontas soltas de comunicação de Rolê/Metas e expor Metas Conjuntas ao assessor, reutilizando integralmente `reminder_jobs`, `outbound_messages`, `split-reminders-dispatch`, `renderMessageTemplate`, `resolveAppPublicUrl` e as RPCs canônicas `shared_goal_*` já entregues no Bloco A. Sem nova arquitetura de filas, sem referral, sem analytics.

## Estado atual verificado

- `supabase/functions/split-reminders-dispatch/index.ts` já claim-a `reminder_jobs`, enfileira em `outbound_messages` com `idempotency_key = split:<kind>:<participant>:<job>`, kicka `whatsapp-send` e retorna estados. Reusável integralmente.
- `supabase/functions/_shared/agent/messageTemplates.ts` já é o único ponto de template (Rolê). Não há templates para Metas Conjuntas.
- `supabase/functions/_shared/messaging/appUrl.ts` só sabe montar link para `/app/assessor`. Não há helper para `/app/role/:id` nem `/app/metas/conjunta/:id`.
- `shared_expense_participants.opt_out_at` existe (respeitado hoje). Metas Conjuntas ainda não têm opt-out — ficará fora deste pacote.
- Tools do assessor em `supabase/functions/_shared/agent/tools.ts`: existem `create_goal_draft`, `add_goal_contribution_draft`, `project_goal_completion`, `simulate_goal_pace` (individuais). Zero cobertura de `shared_goal_*`. RPCs `shared_goal_create/invite/accept/decline/add_contribution/leave/remove_member/update/cancel/pending_invites` já existem no banco.
- `renderMessageTemplate` já diferencia por `contexts.*` administráveis — dá para adicionar chaves novas sem código extra além de defaults.

## Escopo desta rodada (baixa complexidade, uma execução)

### 1) Deep links canônicos (baixa)
Estender `supabase/functions/_shared/messaging/appUrl.ts` com:
- `buildSharedExpenseUrl(env, id, {source})` → `/app/role/{id}`
- `buildSharedGoalUrl(env, id, {source})` → `/app/metas/conjunta/{id}`
- `buildSignupUrl(env, {next, source})` → `/signup?next=<encoded>` (usa `next` para redirecionar depois do login, sem tokens)
Reusa a validação HTTPS/host existente. Retorna `null` graciosamente.

### 2) Templates Rolê — cadastrado vs não cadastrado (baixa)
Em `messageTemplates.ts`:
- Adicionar defaults `split_invite_registered`, `split_invite_guest`, `split_reminder_registered`, `split_reminder_guest`.
- Registered = tem `whatsapp_links` ativo OU `linked_user_id` no participante. Guest = sem vínculo.
- Guest ganha frase adicional com `signup_url`. Registered ganha `deep_link` direto para o rolê.
- Novo placeholder `{{link_sentence}}` resolvido pelo dispatcher.

Em `split-reminders-dispatch/index.ts`:
- Antes do `messageFor`, resolver `is_registered` via 1 select em `whatsapp_links` (ou `linked_user_id` do participante — já preferido). Selecionar kind sufixado `_registered|_guest`.
- Injetar `link_sentence` usando os helpers do item 1.
- Idempotência mantida (`split:<kind>:<participant>:<job>`). Kind sufixado já protege contra colisão com jobs antigos.

### 3) Segunda mensagem simples do Rolê (baixa)
Reusar `reminder_jobs` (nada novo): quando um `invite` é enfileirado com sucesso, agendar automaticamente um único `reminder` com `scheduled_for = now() + interval` (env `SPLIT_SECOND_MESSAGE_HOURS`, default 48h). Implementação:
- Trigger SQL `AFTER UPDATE ON reminder_jobs` quando `status → enqueued` e `kind = 'invite'`: `INSERT INTO reminder_jobs (kind='reminder', scheduled_for=now()+interval, ...)` com `UNIQUE (shared_expense_id, participant_id, kind, followup_of)` para idempotência estrita (nova coluna `followup_of uuid` referenciando o job original).
- Respeita `opt_out_at` automaticamente (já checado no dispatcher).
- Sem alteração no cron: o mesmo tick captura quando `scheduled_for` chega.

### 4) Metas Conjuntas — segunda mensagem e templates (baixa/média)
Não há hoje pipeline de mensagens WhatsApp para Metas Conjuntas. O convite atual é in-app. Para não abrir novo domínio:
- Adicionar apenas emissão opcional de WhatsApp reutilizando `outbound_messages` diretamente (sem `reminder_jobs`), quando `shared_goal_invite` retorna `phone_e164`:
  - Escrever no mesmo `outbound_messages` com `kind='goal_invite'`, `context_type='shared_goal'`, `context_id=goal_id`, `idempotency_key='goal_invite:<goal_id>:<phone>'`.
  - Segunda mensagem: um único registro adicional com `kind='goal_invite_followup'` e `send_after` (env `GOAL_SECOND_MESSAGE_HOURS`, default 72h) — o worker `whatsapp-send` já respeita `send_after` se existir; se não, adicionar filtro `send_after IS NULL OR send_after <= now()` no claim.
  - Templates novos em `messageTemplates.ts`: `goal_invite_registered/guest`, `goal_invite_followup_registered/guest`.
- Opt-out fica fora do pacote (nenhuma tabela hoje). Documentar como "menor mudança necessária" no follow-up: coluna `opt_out_at` em `shared_goal_members`/`shared_goal_invites`.

### 5) Estados de envio (baixa)
`outbound_messages.status` já tem `queued|processing|sent|delivered|failed`. Nenhuma migration nova. Apenas garantir que o path Metas Conjuntas grave `sent_at`/`delivered_at`/`failed_at` reusando o handler existente do `whatsapp-send`. Verificar em teste que a linha percorre `queued → sent → delivered`.

### 6) Tools do Assessor para Metas Conjuntas (média)
Em `supabase/functions/_shared/agent/tools.ts`, seis tools novas, todas chamando RPCs canônicas — zero SQL direto:
- `list_shared_goals(ctx)` → `select` em `shared_goals` (RLS já filtra) + `shared_goal_members`.
- `get_shared_goal_progress(ctx, {goal_id|goal})` → agrega `shared_goal_contributions`.
- `list_shared_goal_ranking(ctx, {goal_id})` → SUM por `user_id` já autorizado.
- `simulate_shared_goal_pace(ctx, {goal_id, monthly_contribution?})` → reusa `simulate_goal_pace` internamente com totais compartilhados.
- `create_shared_goal_draft(ctx, args)` → grava em `pending_confirmations` (pattern já usado por `create_goal_draft`). Confirmação chama `shared_goal_create` + opcional `shared_goal_invite`.
- `contribute_shared_goal_draft(ctx, {goal_id, amount})` → draft → confirm chama `shared_goal_add_contribution` com `idempotency_key = user_id:goal_id:draft_id`.

Registrar no `ToolSpec[]` e no `confirm_pending_action` (extensão do switch já existente).

### 7) Testes enxutos (baixa)
- `src/test/messageTemplates.test.ts`: matriz kind × registered/guest, snapshot dos textos e presença de `deep_link`/`signup_url`.
- `supabase/tests/split_second_message.sql` (ou `_test_split_second_message()` função test-only, seguindo padrão dos `_test_*` já existentes): validar que aceite/enfileiramento de invite cria followup único e idempotente.
- `src/test/shared-goal-tools.test.ts`: mock de RPCs — cada tool devolve shape esperado; `contribute_shared_goal_draft` gera `idempotency_key` estável.
- `bun test`, `tsgo`, `bun lint`, `bun run build`. Sem E2E, sem publicação.

## Arquivos reutilizados (sem refactor)
- `supabase/functions/split-reminders-dispatch/index.ts` — apenas branch de kind sufixado + `link_sentence`.
- `supabase/functions/_shared/agent/messageTemplates.ts` — novas defaults, mesma API.
- `supabase/functions/_shared/messaging/appUrl.ts` — novos helpers, mesma validação.
- `supabase/functions/_shared/agent/tools.ts` + `pending_confirmations` — pattern de draft existente.
- `src/lib/db/sharedGoals.ts` — nenhum toque; frontend permanece como está.

## Migrations mínimas necessárias
1. `reminder_jobs`: coluna `followup_of uuid NULL REFERENCES reminder_jobs(id)` + índice único parcial `(shared_expense_id, participant_id, kind) WHERE followup_of IS NOT NULL`.
2. Trigger `after update on reminder_jobs` que agenda o followup de `invite`.
3. `outbound_messages`: coluna `send_after timestamptz NULL` + índice, se ainda não existir (verificar antes; provavelmente aditivo).
4. Ajuste do claim/dispatch do `whatsapp-send` para respeitar `send_after`.

Todas idempotentes e aditivas. Zero alteração em RLS, zero política nova.

## Riscos e dependências reais
- `outbound_messages.send_after` pode já existir com outro nome — validar antes de criar (leitura no schema no início da implementação).
- Detecção "registered vs guest" para Rolê depende de `linked_user_id` já ser preenchido pelo `link_split_participant` da Onda 2. Fallback: consulta `whatsapp_links` por `phone_e164`.
- Sem opt-out em Metas Conjuntas — aceito e documentado.
- Se `APP_PUBLIC_URL` não estiver definida em prod, os deep links serão omitidos e as mensagens caem em variantes sem link. Sem quebra.

## O que fica fora deste pacote
- Referral/attribution, campanhas, analytics.
- Painel admin observacional de mensageria.
- Opt-out de Metas Conjuntas (só apontado).
- E2E multi-papel e publicação.
- Terceira mensagem, sequências longas, escalada por SLA.
- Bloco B.2 (deep-link tokens, expiração, cockpit).

## Complexidade por grupo
- Deep links: baixa
- Templates registered/guest: baixa
- Segunda mensagem Rolê (trigger + followup): média
- WhatsApp de Metas Conjuntas via outbound_messages: média
- Tools do assessor: média
- Testes: baixa

Total: **média baixa em uma única rodada.**

## Prompt final de implementação (para a próxima execução)

> Implemente em UMA rodada, sem parar entre itens, o pacote de comunicação enxuta + tools de Metas Conjuntas:
>
> 1. Em `supabase/functions/_shared/messaging/appUrl.ts`, adicione `buildSharedExpenseUrl`, `buildSharedGoalUrl`, `buildSignupUrl(next)`, reutilizando `resolveAppPublicUrl`.
> 2. Em `supabase/functions/_shared/agent/messageTemplates.ts`, adicione defaults `split_invite_registered/guest`, `split_reminder_registered/guest`, `goal_invite_registered/guest`, `goal_invite_followup_registered/guest`, com placeholder `{{link_sentence}}`.
> 3. Em `supabase/functions/split-reminders-dispatch/index.ts`: resolver `is_registered` por `linked_user_id` (fallback `whatsapp_links`), sufixar `kind` e injetar `link_sentence` (deep link do rolê para registered, signup url para guest).
> 4. Migration aditiva idempotente:
>    - `reminder_jobs.followup_of uuid` + índice único parcial;
>    - trigger `after update` que, quando `invite` vira `enqueued`, cria job `reminder` com `scheduled_for = now() + make_interval(hours := coalesce(current_setting('app.split_second_message_hours', true)::int, 48))` e `followup_of` do original;
>    - `outbound_messages.send_after timestamptz` (se ainda não existir) + índice; ajustar claim de `whatsapp-send` para respeitar.
> 5. RPCs `shared_goal_invite` (ou wrapper em Edge Function chamado pelo frontend/agent): quando `phone_e164` presente, inserir em `outbound_messages` `goal_invite` + `goal_invite_followup` (send_after = +72h por default), com idempotency keys `goal_invite:<goal_id>:<phone>` e `goal_invite_followup:<goal_id>:<phone>`. Não criar reminder_jobs para meta.
> 6. Em `supabase/functions/_shared/agent/tools.ts`, adicione as tools `list_shared_goals`, `get_shared_goal_progress`, `list_shared_goal_ranking`, `simulate_shared_goal_pace`, `create_shared_goal_draft`, `contribute_shared_goal_draft`. Mutações só via `pending_confirmations` + `confirm_pending_action`, chamando RPCs canônicas `shared_goal_*` já existentes. Idempotency key da contribuição = `user_id:goal_id:pending_confirmation_id`.
> 7. Testes: `messageTemplates.test.ts` (matriz kind × registered/guest), `shared-goal-tools.test.ts` (shapes + idempotência), função Postgres `_test_split_second_message()` seguindo padrão dos `_test_*` já existentes no repo, com 3+ asserts.
> 8. Rodar `bunx vitest run`, `tsgo`, `bun lint`, `bun run build`. **Não publicar.**
>
> Restrições: não alterar arquitetura de filas, não introduzir opt-out de Metas Conjuntas (apenas TODO comentado), não tocar em RLS existente, não refatorar `sharedGoals.ts` do frontend, não criar sistema de tokens/referral.
