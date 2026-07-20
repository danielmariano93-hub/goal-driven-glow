
# Central de Mensagens + Configuração do Agente (Admin)

Dois blocos independentes, entregues no mesmo patch. Sem alterar WAHA, webhook ou sessão de infraestrutura — apenas persistência, RPCs de leitura, UI admin e camada de templates/personas.

---

## Diagnóstico confirmado

- `src/pages/admin/Mensagens.tsx` chama três RPCs (`admin_message_activity`, `admin_message_metrics`, `admin_conversation_activity`) que **não existem no banco** (`\df` retorna 0 linhas). A página exibe o toast de erro "Verifique se a migration deste patch foi implantada" para qualquer admin hoje.
- `outbound_messages` já tem `kind`, `context_type/id`, `participant_id`, `idempotency_key`, `attempts`, `last_error`, `provider_message_id`, `sent_at` — base sólida. Falta apenas garantir que TODAS as origens (assessor no app, insights, régua, notificações que viram WhatsApp) gravem lá antes do envio.
- `notifications` (in-app) e `conversation_messages` (assessor no app) vivem em silos separados de `outbound_messages` (WhatsApp) e `inbound_messages` (webhook). Não há hoje uma visão unificada.
- Templates de mensagens da Divisão do Rolê estão hardcoded em `supabase/functions/_shared/agent/messageTemplates.ts` (`DEFAULTS`). `renderMessageTemplate` já lê `persona.templates[kind]` — só falta um editor administrável.
- `agent_prompt_versions.structured_config jsonb` já existe (persona: name, tone, signature, templates). Falta UI para editar persona por contexto e falta a separação de "prompt geral / regras invioláveis / templates / canais".
- Referências a "Lucas" no código estão apenas na migration histórica; a UI atual (`Agente.tsx`) ainda trata identidade de forma monolítica, sem personas por contexto.

---

## Bloco A — Central de Mensagens (Admin)

### A1. Migration — unificação e RPCs de leitura

Nova migration `20260720_admin_message_center.sql`:

1. **Extensão de `outbound_messages`**: adicionar colunas opcionais `surface text` (`whatsapp` | `app_assessor` | `app_notification` | `app_insight` | `system`) e `feature text` (`agent_chat`, `split_reminder`, `split_invite`, `financial_ruler`, `insight`, `notification`, `document_status`, `manual`). Default `surface='whatsapp'`, `feature=kind`. Backfill a partir de `kind` e `channel`.
2. **Trigger espelho `notifications → outbound_messages`**: quando uma notificação in-app é criada com `channel_hint='app'`, inserir uma linha em `outbound_messages` com `surface='app_notification'`, `channel='inapp'`, `status='delivered'`, `to_phone=''`. Garante que o admin veja tudo num só lugar sem duplicar dado autoritativo.
3. **Espelho `conversation_messages → outbound_messages`**: para mensagens `direction='outbound'` do assessor no app, inserir linha em `outbound_messages` com `surface='app_assessor'`, `channel='inapp'`, `status='delivered'`. Idempotência via `idempotency_key = 'app_assessor:' || conversation_messages.id`.
4. **RPCs SECURITY DEFINER, `EXECUTE TO authenticated`, com `is_current_user_admin()` no corpo**:
   - `admin_message_activity(p_from, p_to, p_status, p_kind, p_surface, p_feature, p_user_id, p_search, p_limit, p_offset)` — retorna linhas mascaradas (telefone, corpo já mascarado por `mask_message_body`) + join opcional com `message_delivery_events` para timeline.
   - `admin_message_metrics(p_from, p_to)` — total, enfileiradas, enviadas, entregues, lidas, falhas, mortas, taxa de entrega, contagem por canal, por feature, tempo médio queued→sent, tempo médio sent→delivered.
   - `admin_conversation_activity(p_from, p_to, p_limit)` — mantém formato atual.
   - `admin_message_timeline(p_message_id)` — devolve criação, envio, ACKs (`message_delivery_events`), erros, tentativas.
   - `admin_message_reprocess(p_message_id)` — apenas admin: valida que status ∈ {failed, dead}, reseta `status='queued'`, zera `next_attempt_at`, incrementa contador de reprocess em `metadata.reprocessed_count`, insere linha de auditoria em `platform_admin_audit`. Não altera `idempotency_key`.
5. Índices: `outbound_messages(surface, created_at DESC)`, `outbound_messages(feature, created_at DESC)`, `outbound_messages(user_id, created_at DESC)`.

Segurança: nenhuma RPC devolve payload cru; corpo passa por `mask_message_body` (já usada hoje). GRANT explícito para `authenticated`; funções bloqueiam não-admin com `raise exception 'forbidden'`.

### A2. Instrumentação — gravar antes de enviar

- **Assessor no app** (`agent-chat`): já persiste `conversation_messages`. O trigger de A1.3 cuida do espelho — nenhuma mudança de código necessária.
- **Notificações in-app** (`insights-generate`, régua financeira, `notifications` inserts): trigger de A1.2 cuida.
- **WhatsApp / Divisão do Rolê / lembretes**: já usam `outbound_messages`. Apenas normalizar `surface` e `feature` no insert. Ajustar `split-reminders-dispatch/index.ts` e `whatsapp-send/index.ts` para preencher `surface='whatsapp'` e `feature=split_<kind>|agent_chat|…`.
- **Enfileiramento vs. envio**: reforçar convenção — todo envio de saída insere em `outbound_messages` com `status='queued'` **antes** de chamar o provider; ACKs do WAHA continuam atualizando via webhook (`message_delivery_events`).

### A3. UI `src/pages/admin/Mensagens.tsx`

Reescrita mobile-first, mantendo o layout Itaú-like já usado:

- Filtros: período (7/30/90/custom), status, canal, superfície, feature, usuário (autocomplete), busca por telefone/corpo mascarado, evento (`context_type`).
- Métricas: cards existentes + novos ("Taxa de entrega", "Por canal", "Por funcionalidade", "Tempo médio de resposta"). Gráfico simples (Recharts, já no projeto) por dia.
- Tabela: linha expansível → timeline (`admin_message_timeline`) com criação, tentativas, envio, ACKs.
- Ação **Reprocessar** para mensagens `failed`/`dead` (chama `admin_message_reprocess`, com confirmação e toast). Auditada.
- Vínculo clicável: quando `context_type='shared_expense'`, link para `/app/divisao-do-role/:id` (abre em nova aba). Quando `feature='insight'`, link para a notificação.
- Painel "Conversas do assessor" mantém, agora unificado com filtro por superfície `app_assessor`.

### A4. Custo/consumo de IA e tempo de resposta

- Métricas de IA lidas de `agent_runs` (`tokens_input`, `tokens_output`, `cost_credits`, `duration_ms` — já existentes). Painel novo dentro de Mensagens ou reaproveitando card de FinOps: custo total, custo por feature (via `agent_runs.context`), tempo médio.

---

## Bloco B — Configuração flexível do Agente (Admin)

### B1. Modelo de dados (mesma migration)

Estender `agent_prompt_versions.structured_config jsonb` com contrato explícito (sem nova tabela — mantém o versionamento único que já temos):

```jsonc
{
  "identity": {
    "name": null,                    // opcional: sem nome por padrão
    "role": "Assessor financeiro",
    "presentation": "…",
    "personality": "…",
    "signature": null
  },
  "voice": {
    "tone": "humano",
    "formality": "informal",
    "emoji_style": "moderado",
    "address_style": "voce",
    "preferred_words": [],
    "forbidden_words": []
  },
  "contexts": {
    "financial_chat":       { "tone_override": null, "template": "…" },
    "transaction_capture":  { "template": "…" },
    "insights":             { "template": "…" },
    "split_invite":         { "template": "Oi, {{participant_name}}! …" },
    "split_reminder":       { "template": "…" },
    "split_due_soon":       { "template": "…" },
    "split_overdue":        { "template": "…" },
    "split_payment_confirmation": { "template": "…" },
    "split_completed":      { "template": "…" },
    "platform_support":     { "template": "…" }
  },
  "autonomy": {
    "can_answer": ["consulta","analise","registro_com_confirmacao"],
    "can_execute": ["create_transaction_draft","update_transaction_draft"],
    "requires_confirmation": ["delete_transaction","split_delete"],
    "escalate_to_human": ["reclamacao","erro_financeiro_grave"]
  },
  "features": { "assessor_documents": true, "split": true, "insights": true }
}
```

Regras invioláveis (privacidade, confirmação, não-invenção) **permanecem no `system_prompt`** e são concatenadas ao final pelo servidor — a UI de identidade/voz não consegue removê-las.

### B2. Camada de renderização

- `renderMessageTemplate` (já existente) ganha suporte a `contexts.<kind>.template` além de `templates.<kind>` (compat retroativa).
- Novo helper `resolvePersonaFor(context, activePrompt)` — devolve persona efetiva por contexto, aplicando overrides de `contexts[kind]` sobre `identity`+`voice`.
- Se `identity.name` for `null`, prompt e templates **omitem** qualquer nome ("Sou o assessor financeiro do NoControle.ia…"). Remove qualquer resíduo de "Lucas".

### B3. UI `src/pages/admin/Agente.tsx` (refactor)

Abas dentro da página atual:

1. **Identidade & voz** — formulário para `identity` + `voice`. Nome opcional com placeholder "Sem nome (padrão)".
2. **Prompt geral** — editor do `system_prompt` (como hoje).
3. **Regras invioláveis** — bloco somente leitura, exibindo o rodapé que o servidor concatena (segurança, privacidade, confirmação, não-invenção). Marcada como "protegida".
4. **Templates por contexto** — lista os 10 contextos de B1, cada um com:
   - editor com highlight das variáveis (`{{participant_name}}`, `{{owner_name}}`, `{{title}}`, `{{amount}}`, `{{due_date}}`, `{{pix_key}}`, `{{pending_amount}}`);
   - **pré-visualização** ao lado (renderiza com dados fictícios);
   - **enviar teste** (chama `whatsapp-send` com `feature='template_test'` para o telefone do admin logado, se vinculado).
5. **Autonomia & funcionalidades** — toggles do bloco `autonomy` e `features`.
6. **Versões** — lista com quem alterou, quando, status (rascunho/ativa/arquivada), diff resumido, botões **Publicar**, **Salvar rascunho**, **Restaurar**. Reaproveita `parent_version_id` / `restored_from_id` já existentes.

Publicar cria nova versão (parent = ativa atual), marca a antiga como `archived`, promove a nova para `active` (respeita o índice único parcial `apv_active_uniq`).

### B4. Divisão do Rolê usa o template administrável

`split-reminders-dispatch/index.ts` já lê `structured_config` do prompt ativo. Ajuste: buscar `contexts.split_<kind>.template` antes de `templates.<kind>`; se ambos vazios, cai no `DEFAULTS` do arquivo. Nenhuma cópia de texto nova no código — apenas melhoria da chave lida.

---

## Testes

- Unit: `renderMessageTemplate` com `contexts` + fallback; `resolvePersonaFor` para persona sem nome; mascaramento (`mask_message_body`).
- Integração (vitest com fixtures): RPCs `admin_message_activity`/`metrics`/`timeline`/`reprocess` — cobertura de gate admin e formatos.
- Contrato: dispatch de Divisão do Rolê renderiza usando `contexts.split_invite.template` quando definido, e sem nome quando `identity.name=null`.
- Regressão: nenhum vazamento de telefone/corpo cru nas respostas das RPCs.

---

## Arquivos afetados (previsão)

- `supabase/migrations/20260720_admin_message_center.sql` (novo)
- `supabase/functions/_shared/agent/messageTemplates.ts` (leitura de `contexts.*`)
- `supabase/functions/_shared/agent/prompt.ts` (helper `resolvePersonaFor`)
- `supabase/functions/split-reminders-dispatch/index.ts` (usa `contexts.*`, seta `surface`/`feature`)
- `supabase/functions/whatsapp-send/index.ts` (seta `surface`/`feature` no insert quando ausente)
- `src/pages/admin/Mensagens.tsx` (reescrita com filtros, timeline, reprocess)
- `src/pages/admin/Agente.tsx` (abas de identidade, templates, autonomia, versões)
- `src/lib/admin/messageCenter.ts` (novo helper de leitura das RPCs)

## Fora de escopo

- WAHA / whatsapp-webhook / whatsapp-session / infra de sessão — não tocar.
- Modelo/preço da IA e novos providers.
- Feature flags fora de `agent_prompt_versions.structured_config.features`.

## Riscos

- Trigger de espelho pode inflar `outbound_messages` — mitigado com `idempotency_key` e índice parcial; retenção em rotina separada (fora deste patch).
- Publicação de nova persona sem regras invioláveis: mitigado por concatenação server-side obrigatória.

## Validação após implantação

1. Rodar migration, checar `\df admin_message_*` — devem existir.
2. Enviar convite de Divisão do Rolê de teste; confirmar aparição imediata em `/admin/mensagens` com `feature=split_invite`.
3. Editar template `split_invite`, publicar, disparar novo convite — texto novo aplicado; regras invioláveis intactas no prompt do agente.
4. Reprocessar uma mensagem `failed` — status volta a `queued`, auditoria registrada.
