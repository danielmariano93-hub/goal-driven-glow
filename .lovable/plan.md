# Plano: Categorização + Edição de lançamentos (app + assessor) + deep-link de insight

## Causa raiz
1. **Extrator do assessor** trata "cartão de crédito" como descrição: o LLM não recebe schema estrito separando `description` de `payment_method`, e o fast-path em `agent-chat/index.ts` grava `description` livre sem sanitização contra tokens de meio de pagamento. Além disso, não tenta resolver `category_id` — a transação nasce com `category_id=null`.
2. **App não permite editar lançamento**: `Lancamentos.tsx` tem `editing`/`TxModal`, mas nenhum handler chama `setEditing(t)+setOpenTx(true)`; o item da lista não tem tap/menu. `TxModal` só cobre conta (não `credit_card_id`, `payment_method`, `purchase_date`, `competence_date`, `installments`). `useSaveTransaction` em `src/lib/db/finance.ts` ignora esses campos.
3. **Insight de "categorize este lançamento"** grava CTA genérica `/app/lancamentos` — `evidence` não carrega `transaction_id`, então a Home não sabe abrir o item específico.
4. **Agente só cria** (`create_transaction_draft`). Falta `get_transaction`, `search_transactions`, `update_transaction_draft`, `delete_transaction_draft` e o executor de confirmação para `transaction_update`/`transaction_delete`.
5. **`pending_confirmations`** hoje só cobre criação. Precisa de `kind` genérico + `payload` canônico + `expected_version` para update/delete com concorrência otimista.

## Arquitetura alvo

```text
             ┌───────────────────────────────────────────┐
             │            Assessor (app + wpp)           │
             │  agent-chat / agent-run  ── mesmas tools  │
             └─────────────┬─────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────────────┐
        ▼                  ▼                          ▼
  extract_intent     search/get_tx           update/delete_tx_draft
  (LLM + zod)        (server, ownership)     (server, allowlist, snapshot)
        │                                            │
        └──────────► create_transaction_draft ◄──────┘
                           │
                   pending_confirmations
                (kind: create|update|delete)
                           │
                    confirm_action (RPC)
                 revalida ownership+version
                    aplica snapshot atômico
                           │
                    invalida queries + CTA
```

Tools são **compartilhadas** em `supabase/functions/_shared/agent/tools.ts` e chamadas pelo mesmo orquestrador. `user_id` é sempre resolvido no servidor a partir do JWT.

## Arquivos alterados / criados

### Backend (Edge Functions + SQL)
- `supabase/migrations/<ts>_transaction_edit_confirmations.sql` — nova migration:
  - Estender `pending_confirmations`: adicionar `kind` (`create_transaction`|`update_transaction`|`delete_transaction`), `target_id uuid null`, `expected_version int null`, `patch jsonb null`, `snapshot_before jsonb null`, `snapshot_after jsonb null` (ou reutilizar `payload jsonb` com contrato canônico documentado no plan). Se colunas já existem com nomes próximos, apenas ampliar CHECK/enums.
  - Adicionar `transactions.version int not null default 1` + trigger `BEFORE UPDATE` que incrementa `version` e valida `expected_version` quando fornecido via `SET LOCAL`.
  - RPC `confirm_transaction_action(p_confirmation_id uuid) returns jsonb`: SECURITY DEFINER, valida `auth.uid()==user_id`, faz update/delete com allowlist, retorna snapshot before/after, marca confirmação como `applied` (idempotência: se já `applied`, retorna snapshot salvo).
  - Allowlist de campos editáveis: `amount, description, notes, occurred_at, category_id, status, account_id, credit_card_id, payment_method, purchase_date, competence_date, installment_number, installment_total`. Sem `user_id`, sem `id`, sem `transfer_group_id` fora de transferência.
  - Regras: se `type=transfer` → RPC recusa update/delete singular; direciona para fluxo dedicado (fora desta rodada implementar UI de transferência, mas RPC bloqueia com erro claro).
  - Para parcelamento: RPC aceita `scope: "one" | "future"`; quando `future`, itera `transactions` do mesmo `installment_group_id` (usar coluna existente se houver; caso contrário, escopo `one` apenas nesta rodada — declarar como gap se coluna não existir hoje).
  - Grants + RLS mantidos; `confirm_transaction_action` acessível a `authenticated`.

- `supabase/functions/_shared/agent/tools.ts`:
  - `get_transaction({ id })`: SELECT com ownership; retorna também `credit_card`/`account`/`category` resumidos + `version`.
  - `search_transactions({ query?, amount?, from?, to?, category?, account?, card?, limit=10 })`: filtros seguros, retorna lista compacta com id, valor, data, descrição, categoria, meio, `version`.
  - `update_transaction_draft({ id, patch, expected_version })`: valida allowlist, cria `pending_confirmation kind=update_transaction` com `snapshot_before`, `patch`, `expected_version`; retorna `pending_id` + preview before/after.
  - `delete_transaction_draft({ id, expected_version, scope? })`: mesmo padrão, `kind=delete_transaction`.
  - `resolve_category({ text })`: fuzzy conservador sobre categorias reais do usuário (globais + pessoais). Retorna `single|multiple|none`.
  - `sanitize_description(raw, payment_method)`: strip de tokens `cartão`, `cartão de crédito`, `no crédito`, `débito`, `pix`, `dinheiro`, `conta`, nomes de bancos/cartões conhecidos do usuário — determinístico, aplicado depois do LLM.

- `supabase/functions/_shared/agent/prompt.ts` — ativar **v3** do prompt via migration em `agent_prompt_versions`:
  - Contrato JSON estrito para extração: `{ amount, description, occurred_at, category_hint, payment_method, account_hint, card_hint, installments }`. `description` NUNCA contém termos de meio de pagamento.
  - Regra: preservar termos literais entre aspas e siglas ("VOS" permanece "VOS"). Sem correções silenciosas.
  - Regra de categoria: tentar resolver; se ambíguo → perguntar com choices; se nenhum → oferecer "Deixar sem categoria" como opção explícita e continuar.
  - Regras para edição: precisa `id`; se usuário disse "último", chamar `search_transactions` com `limit=1 order by occurred_at desc`.
  - Toda edição/exclusão → tool draft + confirmação; nunca aplicar direto.

- `supabase/functions/agent-chat/index.ts` e `supabase/functions/agent-run/index.ts`:
  - Rotear intents `edit|delete|categorize|search` para as novas tools.
  - Fast-path determinístico para "categorize o último X como Y", "muda descrição para Z", "esse foi no cartão W".
  - Após confirmação bem-sucedida, incluir `cta: { label: "Ver lançamento", route: "/app/lancamentos/:id" }` no retorno.
  - Anti-loop existente estendido para não repetir a mesma pergunta de categoria.

- `supabase/functions/insights-generate/index.ts`:
  - Quando o insight se refere a um lançamento específico (ex.: `category_id null` recente), incluir `evidence.transaction_id` e `cta_route=/app/lancamentos/<id>?edit=1`.
  - Fallback `pickFallback` (em `_shared/insights/fallbacks.ts`) recebe `uncategorized_recent_tx_id` e emite CTA precisa.

### Frontend
- `src/lib/db/finance.ts`:
  - `useTransaction(id)` — fetch por id.
  - `useSaveTransaction` — aceitar `payment_method`, `credit_card_id`, `purchase_date`, `competence_date`, `installment_*`; validar combinações (cartão exige `credit_card_id` e proíbe `account_id`; conta exige `account_id`).
  - `useUpdateTransactionViaAgent({ id, patch })` — chama `agent-chat` internamente? Não: chama diretamente RPC `confirm_transaction_action` apenas quando confirmação já criada pelo assessor. Para edição direta do app, `useSaveTransaction` continua UPDATE direto (sem passar por confirmation) com `expected_version`.

- `src/lib/validation/finance.ts` — schema estendido para cartão/parcelas com refinements condicionais.

- `src/pages/Lancamentos.tsx`:
  - Cada item vira `button`/`Link` com tap → abre `TxDetailSheet`.
  - Suportar query `?edit=<uuid>` e rota `/app/lancamentos/:id` (adicionar em `App.tsx`).
  - Botão "Editar" visível no sheet; "Excluir" com confirmação.

- `src/components/lancamentos/TxDetailSheet.tsx` (novo) — mostra todos os campos, incluindo cartão/fatura/parcela; ações Editar, Duplicar, Excluir.

- `src/components/lancamentos/TxModal.tsx` (reescrever):
  - Segmented control: **Conta** | **Cartão** | **Transferência (somente leitura nesta rodada)**.
  - Modo Cartão: seletor de cartão, `purchase_date`, cálculo de `competence_date` a partir do fechamento do cartão, `installments`.
  - Modo Conta: seletor de conta.
  - Validações Zod condicionais.
  - Ao salvar edição de parcelado: pergunta "somente esta parcela" vs "esta e futuras" (se coluna de grupo existir; senão só "esta parcela" com aviso).

- `src/components/home/AssistantTipCard.tsx`:
  - Ler `evidence.transaction_id` e usar `cta_route` já pronta. Se `transaction_id` existe e a query de fetch retorna 404 → renderizar fallback "esse lançamento não existe mais" + CTA lista.

- `src/App.tsx` — nova rota `/app/lancamentos/:id` (mesma page com prop `initialEditId`).

### Contratos de tools (resumo)

```text
get_transaction        → { transaction, version }
search_transactions    → { results: [...], count, choices? }
update_transaction_draft(id, patch, expected_version)
                       → { pending_id, before, after, diff }
delete_transaction_draft(id, expected_version, scope?)
                       → { pending_id, snapshot }
resolve_category(text) → { status: "single"|"multiple"|"none", matches }
confirm_action(pending_id)
                       → { status: "applied"|"conflict"|"expired", result_ref, snapshot_after }
```

## Testes (bloqueadores, todos em uma rodada)
- `src/test/agent-parser.test.ts` +
  - "131,51 de VOS no cartão de crédito Itaú" → `description="VOS"`, `payment_method="credit_card"`, `card_hint="Itaú"`, `category_hint=null`.
  - preservar "VOS" (não virar VPS).
- `src/test/agent-resolvers.test.ts` — categoria: single/multiple/none; "sem categoria" explícito.
- `src/test/tx-editing.test.ts` (novo) — save/update via `useSaveTransaction` cobrindo cartão sem `account_id`, conta sem `credit_card_id`, categoria only, mudança de data + recomputo de `competence_date`.
- `src/test/agent-tools-tx.test.ts` (novo) — get/search/update_draft/delete_draft com mock Supabase; ownership rejeitada para outro user.
- `src/test/pending-confirmations.test.ts` — apply idempotente; conflito de `expected_version`; delete com confirmação; falha nunca retorna sucesso.
- `src/test/insights-fallbacks.test.ts` — cenário `uncategorized_recent_tx_id` gera CTA com id.
- E2E manual documentado: registrar → categorizar via insight → editar via app → editar via assessor → excluir via assessor.
- `npm test`, `tsgo`, `vite build` verdes.

## Sequência de execução (uma rodada)
1. Migration (versão de tx, `pending_confirmations` ampliado, RPC `confirm_transaction_action`, v3 do prompt).
2. Tools compartilhadas + sanitizer + resolver de categoria.
3. `agent-chat` + `agent-run` roteando novas intents.
4. `insights-generate` incluindo `transaction_id` em `evidence`.
5. Frontend: `useTransaction`, `useSaveTransaction` estendido, rota `/app/lancamentos/:id`, `TxDetailSheet`, `TxModal` reescrito, tap na lista, CTA do insight.
6. Testes novos + rodar suíte.
7. Deploy somente das Edge Functions alteradas. **Sem publicar frontend.**

## Critérios de aceite
- Nova mensagem "131,51 de VOS no cartão de crédito Itaú" grava `description="VOS"`, `payment_method="credit_card"`, `credit_card_id` resolvido, `account_id=null`, e pergunta categoria (ou aceita "sem categoria").
- Transação existente `2a03b111…` pode ser corrigida via app (tap → editar → salvar) e via assessor ("troque a descrição desse gasto para VOS") com confirmação real.
- Insight de categorização abre exatamente o lançamento pendente; após categorizar, dica é encerrada.
- Edição de compra em cartão nunca adiciona `account_id`; edição em conta nunca adiciona `credit_card_id`.
- RPC rejeita ownership de outro user, rejeita conflito de versão, é idempotente em retry.
- Suíte, typecheck e build verdes.

## Riscos
- Coluna de grupo de parcelamento pode não existir → declarar como gap; nesta rodada suportar apenas escopo "esta parcela" com aviso.
- Concorrência otimista exige `version` em `transactions`; migration precisa preencher default para linhas antigas.
- Reescrita do `TxModal` pode regredir criação — mitigar com testes de save cobrindo conta e cartão.
- LLM v3 pode variar; sanitizer determinístico de `description` cobre falhas.

## Fora de escopo
WAHA, webhook, sessão, WhatsApp infra, transferências (edição), Open Finance, gamificação, notificações. Nenhuma alteração automática na transação real `2a03b111…` — só via ação do usuário.
