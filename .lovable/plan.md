
# Plano revisado — Categorização + Edição de lançamentos + Deep-link de insight

Executável em uma única rodada. Não inclui WAHA/webhook/sessão. Não toca em dados do usuário real.

## 1. Causa raiz consolidada
- **Extrator do agente** aplica sanitização ampla e confunde `description` com `payment_method`/instituição (ex.: "VOS no cartão de crédito Itaú" → description "cartão de crédito"). Precisa isolar spans, não remover palavras.
- **Sem fluxo de edição/exclusão** ponta a ponta: `pending_confirmations` só cobre criação; UI só permite excluir; agente não tem tools de update/delete confiáveis.
- **Parcelas** hoje são linhas independentes sem agrupador → impossível "editar todas as futuras".
- **Insight de categorização** não existe: transações com `category_id null` não geram card com deep-link para o lançamento.
- **Prompt v3 anterior** divergiu da versão publicada pelo admin. Precisa ser filho da ativa, publicado pelo mesmo fluxo.

## 2. Schema real constatado (read-only)

`pending_confirmations`: id, user_id, conversation_id, **kind text**, **payload jsonb**, summary_text, **status confirmation_status(pending|confirmed|cancelled|expired)**, expires_at, executed_at, **result_ref uuid**, **result_snapshot jsonb**, confirmed_from_message_id, conversation_msg_ref, created_at.

`transactions`: id, user_id, account_id, category_id, type, status(confirmed|planned), amount, occurred_at, description, notes, emotional_trigger, transfer_group_id, direction, origin(manual|agent|import|recurring|split), import_source_id, **payment_method text default 'account'**, credit_card_id, **installments_total**, installment_number, purchase_date, competence_date, created_at, updated_at.

`user_insights`: type, title, body, cta_label, cta_route, **evidence jsonb**, status, expires_at.

Não existem: `installment_group_id`, `version`, `applied` status. Serão adicionados via migration mínima.

## 3. Arquitetura

```text
Usuário/Agente
   │
   ├─ App direto: RPC transaction_update_direct(id, expected_updated_at, patch)
   │              RPC transaction_delete_direct(id, expected_updated_at, scope)
   │              (auth.uid() = owner via RLS)
   │
   └─ Agente:    tool draft → pending_confirmations(kind,payload) → user confirma
                 → RPC confirm_pending(confirmation_id) [SECURITY DEFINER]
                 → executor interno usa payload.user_id fixado pelo orquestrador
                 → grava result_ref + result_snapshot + status=confirmed
                 → idempotente: se já confirmed, devolve result_snapshot

Insight categorização (transaction_id em evidence)
   → Home card CTA "/app/lancamentos/:id?edit=1&focus=category"
   → TxDetailSheet abre com foco no seletor
   → categorizar expira o insight específico
```

## 4. Migration mínima (uma única)

```sql
-- 4.1 Concorrência otimista
ALTER TABLE public.transactions ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION public.bump_transaction_version() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.version := OLD.version + 1; NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_tx_version BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.bump_transaction_version();

-- 4.2 Grupo de parcelamento (novo, backfill null preservado)
ALTER TABLE public.transactions ADD COLUMN purchase_group_id uuid;
CREATE INDEX idx_tx_purchase_group ON public.transactions(user_id, purchase_group_id)
  WHERE purchase_group_id IS NOT NULL;
-- linhas antigas ficam NULL; UI oferece scope=one apenas quando NULL.

-- 4.3 RPCs (SECURITY DEFINER, search_path=public)
--  a) confirm_pending(confirmation_id uuid) → jsonb
--     valida owner (auth.uid() = user_id OU service_role); se status=confirmed retorna result_snapshot;
--     se pending: dispatch por kind → tx_create | tx_update | tx_delete | transfer | goal | contribution | debt;
--     grava result_ref + result_snapshot + status=confirmed + executed_at atomicamente.
--  b) transaction_update_direct(p_id, p_expected_version, p_patch jsonb, p_scope text default 'one') → jsonb
--     UPDATE ... WHERE id=p_id AND user_id=auth.uid() AND version=p_expected_version;
--     GET DIAGNOSTICS row_count; se 0 → RAISE 'CONFLICT';
--     patch é allowlist: description, category_id, amount, occurred_at, notes, purchase_date, competence_date, installments_total (com regras), credit_card_id, account_id (mutuamente exclusivos por payment_method);
--     scope='future'|'all' só quando purchase_group_id NOT NULL; itera irmãos.
--  c) transaction_delete_direct(p_id, p_expected_version, p_scope) → jsonb (mesma lógica).

-- 4.4 Sem novo status enum. Idempotência: status=confirmed + result_snapshot.

-- 4.5 CHECK: payment_method='card' ⇒ credit_card_id NOT NULL AND account_id IS NULL
--            payment_method='account' ⇒ account_id NOT NULL AND credit_card_id IS NULL
-- (adicionado apenas se não existir; validado antes)
```

Grants padrão: `authenticated` executa RPCs; `service_role` ALL.

## 5. Contratos payload/result_snapshot (canônicos)

`kind` estendido no domínio (texto livre, sem enum): `transaction_create`, `transaction_update`, `transaction_delete`, `transfer_create`, `goal_*`, `contribution_*`, `debt_*` (mantém compat).

- `transaction_update.payload`:
  ```json
  { "user_id":"…", "transaction_id":"…", "expected_version": 3,
    "scope":"one|future|all",
    "patch": { "description":"…", "category_id":"…", "amount":…, "occurred_at":"…",
               "purchase_date":"…", "competence_date":"…",
               "credit_card_id":"…"|null, "account_id":"…"|null,
               "installments_total": … },
    "before": { …snapshot mínimo… } }
  ```
- `transaction_delete.payload`: `{ user_id, transaction_id, expected_version, scope, before }`.
- `result_snapshot` (todos os kinds): `{ ok:true, id|ids:[…], after:{…}, changed_fields:[…], scope }`.

## 6. Extração por spans (agente)

Novo módulo `_shared/agent/extract.ts` (e mirror em `src/lib/agent/extract.ts` p/ testes):

- Regex + heurística para localizar spans: `amount`, `date`, `installment` ("em 3x"), `payment_method` ("cartão", "débito", "dinheiro"), `card_name`/`account_name` (fuzzy match contra lista real do usuário), `category_hint`.
- `description` = texto original **menos os spans identificados**, colapsando espaços; **nunca** remove palavras avulsas ("crédito", "banco", "Itaú") fora de spans.
- Se `description` sobra vazia/curta e `card_name` foi extraído, description default = `""` (não inventa) e agente pergunta.
- Preserva literalmente siglas: "VOS" nunca é convertido para "VPS".
- Testes cobrem: "131,51 de VOS no cartão de crédito Itaú" → description=`VOS`, card=`Cartão Itaú`; "paguei análise de crédito no Itaú" → description=`análise de crédito`.

## 7. Tools do agente (compartilhadas `_shared/agent/tools.ts`)

Adicionar/consolidar:
- `search_transactions({query?, limit=5, since?, until?})` → lista com id, description, amount, occurred_at, category, card/account, version.
- `get_transaction({id})` → detalhe completo + version.
- `draft_transaction_update({id, patch, scope})` → cria `pending_confirmations(kind=transaction_update)` com `expected_version` capturado agora; devolve `confirmation_id` e diff `before/after`.
- `draft_transaction_delete({id, scope})` idem.
- `confirm({confirmation_id})` chama RPC `confirm_pending`. Idempotente.
- Todas as tools recebem `user_id` **do orquestrador** (JWT), nunca do modelo.

## 8. UI

- **`TxDetailSheet`** (novo) em `src/components/lancamentos/TxDetailSheet.tsx`: abre por rota `/app/lancamentos/:id`, aceita `?edit=1&focus=category`. Mostra Conta **ou** Cartão (nunca ambos). Campos condicionais por `payment_method`. Para transferências: read-only + aviso "duas pernas".
- **`TxModal` refatorado**: alterna `account`/`card`; se `card`, mostra `purchase_date`, `installments_total`, calcula `competence_date` no cliente e revalida no servidor; ao mudar cartão/`purchase_date` recomputa.
- **Escopo de parcelamento**: se `purchase_group_id` presente → radios `esta | esta e futuras | todas`. Caso NULL → só "esta" com nota "parcelamento antigo sem agrupamento".
- **Home `AssistantTipCard`**: se `evidence.transaction_id`, CTA vai direto ao sheet. Após success, `queryClient.invalidateQueries(['transactions','insights','home'])`.
- **Confirmação no agente**: `AssessorPanel` mostra card before/after + botões Confirmar/Cancelar + "Ver lançamento" (deep-link).

## 9. Insight de categorização

Em `insights-generate`:
- Antes dos fallbacks genéricos, checar `SELECT id FROM transactions WHERE user_id=$1 AND category_id IS NULL AND status='confirmed' ORDER BY occurred_at DESC LIMIT 1`.
- Se existe: gerar insight `type='categorize_transaction'`, `evidence={transaction_id, amount, description, occurred_at}`, `cta_route=/app/lancamentos/:id?edit=1&focus=category`.
- Validador rejeita insight `categorize_transaction` sem `evidence.transaction_id` válido.
- Ao categorizar (RPC update com `category_id` não-nulo), edge/trigger expira insight correspondente: `UPDATE user_insights SET status='dismissed' WHERE evidence->>'transaction_id' = :id AND type='categorize_transaction'`.
- Se `transaction_id` sumir/foi excluído/outro user: card cai para fallback amigável ("Não encontramos esse lançamento; abra a lista").

## 10. Prompt versionado pelo admin

- Ler versão ativa (`agent_prompt_versions` where active).
- Criar nova versão **filha** copiando `structured_config`, `model`, temperatura, limites.
- Anexar programaticamente bloco `POLICIES (não editáveis)` ao final do prompt do founder, documentando composição no README de agente.
- Publicar via mesmo fluxo (marcar nova como ativa). `agent_runs.prompt_version_id` continua registrando corretamente.
- Painel do founder mostra a versão ativa exata.

## 11. Testes automatizados (bloqueadores)

Vitest + supabase-js com JWT de usuários fixture A/B (criados em `beforeAll`, dropados em `afterAll`).

- `extract.test.ts`: 8 cenários incluindo "VOS", "análise de crédito", "12x", contas vs cartões, ambiguidade.
- `tools-update.test.ts`: draft → confirm → uma alteração; retry do confirm → zero alterações extras (idempotência); version alterada entre draft e confirm → `CONFLICT`.
- `tools-delete.test.ts`: idem.
- `parcelamento.test.ts`: cria compra em 3x com `purchase_group_id`; edita `scope=future` da 2ª → 2 e 3 alteradas, 1 intacta; `scope=all` altera as 3; row antiga sem group → só permite `one`.
- `insight-categorize.test.ts`: cria tx sem categoria → insight gerado com `evidence.transaction_id` correto; categorizar via RPC expira o insight; tx excluída → fallback.
- `isolamento.test.ts`: user A não consegue update em tx de B (RPC retorna erro; RLS bloqueia).
- `ui-deep-link.test.tsx`: `/app/lancamentos/:id?edit=1&focus=category` monta sheet, foca select, salva, invalida queries.
- `transfer-readonly.test.tsx`: sheet mostra read-only.

Comando: `bunx vitest run`. Bloqueia merge se falhar.

## 12. Sequência única de implementação (1 rodada)

1. Migration (§4).
2. `_shared/agent/extract.ts` + mirror + testes.
3. Tools update/delete/search/get (`_shared/agent/tools.ts`), remover sanitização ampla.
4. Executor `confirm_pending` (RPC) e `transaction_update_direct`/`delete_direct`.
5. Nova versão de prompt filha da ativa, publicada e marcada ativa.
6. `insights-generate`: prioridade de `categorize_transaction` + validação.
7. UI: `TxDetailSheet`, rota, refactor `TxModal`, escopo de parcelamento, `AssistantTipCard` deep-link, `AssessorPanel` confirmação before/after.
8. Suíte de testes; typecheck; build.
9. Deploy apenas das edge functions afetadas (`agent-chat`, `insights-generate`). **Não publicar frontend**.

## 13. Critérios de aceite

- "131,51 de VOS no cartão de crédito Itaú" registra description=`VOS`, `credit_card_id=<Itaú>`, `account_id=null`, e pergunta categoria.
- Home mostra card "Categorizar VOS" com CTA que abre o sheet certo, foco no select. Após categorizar, card some.
- Editar categoria pelo agente: draft mostra before/after, `confirm` altera uma vez; retry não duplica.
- Conflito de version → mensagem "esse lançamento mudou, revise novamente".
- User A não vê/edita nada de B.
- Parcelamento novo em 3x com grupo; escopo `future`/`all` funciona; parcelamento antigo permite só `one`.
- Transferência aparece read-only com explicação.
- Painel admin do agente mostra a nova versão ativa; edições futuras do founder continuam funcionando.
- `bunx vitest run` verde; `tsgo` sem erros; build sem erros.

## 14. Riscos e gaps

- **Backfill de `purchase_group_id`**: não haverá — parcelamentos antigos permanecem `one`. Comunicado na UI.
- **CHECK payment_method**: pode falhar se houver linhas legadas inconsistentes. Antes do CHECK, rodar `SELECT` de auditoria; se houver, adicionar CHECK como `NOT VALID` + backlog de saneamento (fora desta rodada).
- **Edição de `installments_total`** em compras já parceladas: só reduzir mantendo passadas confirmadas; aumentar cria novas linhas com mesmo `purchase_group_id`. Documentado no sheet.
- **Transferências edição**: fora de escopo, planejar rodada dedicada.
- **Agent SDK step budget**: manter 6–8 steps.
- **Cache de queries**: garantir `invalidateQueries` em todos os pontos de mutação.

## 15. Fora de escopo

WAHA, webhook, sessão do WhatsApp, edição de transferências, importação, split, gamificação, novos módulos de relatório. Nenhum dado do usuário real é criado/alterado durante testes.
