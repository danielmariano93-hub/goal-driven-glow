# Plano de implementação — Saldo zero, Cartões de crédito, Assessor no app

Escopo grande dividido em 4 frentes independentes. Nada de WAHA/webhook/Vault. Preservar correções anteriores. Não publicar em produção.

## 1. Bug — Saldo inicial R$ 0,00

**Causa provável:** `Number(opening.replace(",", ".")) || 0` em `Contas.tsx` já aceita 0, mas o schema/UI trata string vazia; e possivelmente `.default(0)` + coerção. Auditar caminho completo.

**Ações:**
- `src/lib/validation/finance.ts`: `accountSchema.opening_balance` aceita `number` (inclui 0 e negativos). Sem `.default` implícito que mascare vazio.
- `src/pages/Contas.tsx`: parse explícito. Se input vazio → erro "Informe 0 ou um valor". `parseFloat` em vez de `Number(x) || 0` (que trata 0 como falsy só se string vazia — refatorar para distinguir).
- Verificar `useSaveAccount` em `src/lib/db/finance.ts` — garantir que envia `opening_balance: 0` literal ao Supabase (sem `|| 0` nem `?? undefined`).
- Migration: se houver `CHECK (opening_balance > 0)` na tabela `accounts`, remover. Consultar antes.

**Testes (`validation.test.ts` + novo):**
- vazio → rejeita
- `0` → aceita e persiste 0
- positivo → aceita
- negativo → aceita
- string "0,00" → aceita como 0

## 2. Cartões de crédito — módulo completo

### Banco (nova migration)
Tabela `public.credit_cards`:
- `id, user_id, name, brand, last_four, total_limit numeric, closing_day smallint (1-31), due_day smallint (1-31), color, statement_goal numeric, active bool, created_at, updated_at`
- GRANT authenticated, service_role
- RLS: user_id = auth.uid()

Tabela `transactions` — adicionar colunas:
- `payment_method text` check in ('account','credit_card') default 'account'
- `credit_card_id uuid null references credit_cards`
- `installment_number int null, installments_total int null` (1..48)
- `purchase_date date null, competence_date date null` (mês da fatura)
- Trigger de validação: `payment_method='credit_card'` exige `credit_card_id`; senão exige `account_id`.
- Backfill: transações existentes ficam `payment_method='account'`.

Função `public.credit_card_statement(p_card_id, p_ref_month date)` retornando total, itens, limite usado/disponível. RLS via SECURITY DEFINER com check de owner.

### Frontend
- `src/lib/db/creditCards.ts`: hooks CRUD + statements.
- `src/lib/validation/creditCards.ts`: `creditCardSchema` (closing_day/due_day 1-31, total_limit > 0, statement_goal ≥ 0).
- `src/pages/Cartoes.tsx`: lista de cartões, fatura atual/próxima, limite usado/disponível %, fechamento/vencimento, últimas compras, parcelas futuras, categorias, comparação mês anterior, CTAs "Novo cartão", "Registrar gasto no cartão".
- `src/pages/CartaoDetalhe.tsx`: fatura selecionada, itens, parcelas.
- Modal `NovoCartaoModal`, `EditarCartaoModal`.
- **Formulário de gasto** (`Lancamentos.tsx` e QuickActions/FAB): toggle Conta | Cartão. Se cartão: seletor de cartão (com "+ novo cartão" inline sem perder o rascunho), parcelas 1..48, cálculo automático da fatura de destino baseado em `closing_day` (`purchase_date <= closing_day → fatura mês atual; senão próximo mês`). Preview em linguagem simples: "Entra na fatura de novembro (fecha 25/10)".
- Home: `CartaoResumo` compacto quando houver cartão — fatura atual, % do limite, dias até fechamento, comparação mês anterior, 1 insight determinístico. Sem cartão: onboarding discreto de 1 linha.
- Navegação: adicionar "Cartões" no `MaisMenu` + entry point contextual na Home; **não** somar `total_limit` ao patrimônio (auditar `computeNetWorth` em `src/lib/engine/facts.ts`).

### Gamificação responsável
- `src/lib/gamification/rules.ts`: nunca conceder XP por compra no cartão. Meta de fatura (`statement_goal`), progresso abaixo da meta, streak de meses dentro da meta.
- Alertas em 50/70/85/100% do limite (via `notifications`).
- Desafio opcional "7 dias sem compra por impulso" no catálogo `challenges_catalog`.
- Cálculo de comprometimento da renda (fatura/receita mensal).

### Testes
- Fechamento: compra em dia antes/depois do closing_day → competência correta.
- Parcelamento 1, 12, 48.
- Limite usado nunca negativo.
- Patrimônio NÃO inclui `total_limit` (teste em `facts.test.ts`).
- RLS: usuário A não vê cartão de B (teste de integração).

## 3. Assessor dentro do app

### Backend
- `src/lib/db/chat.ts`: hooks para `conversations` + `conversation_messages` filtradas por `source='app'`.
- `agent-run` já existe. Adicionar suporte a `source='app'` (já aceita `source: 'simulator'|'whatsapp'`) — estender para `'app'` sem exigir `to_phone`. Auth: JWT do usuário; user_id resolvido no servidor via `getUser()`, ignorando qualquer id no payload. Rate limit por user_id (reuso de `admin_action_rate` ou novo `rate_limits`). Timeout de 30s.
- Nova migration: coluna `source` em `conversations` (app|whatsapp) se não existir. RLS já cobre por user_id.
- Ferramentas do agente (`_shared/agent/tools.ts`): já expõem createTransaction/goals/etc. Garantir `requestConfirmation` para escritas.

### Frontend
- `src/components/assessor/AssessorFab.tsx`: botão flutuante nas páginas principais (Home, Lançamentos, Metas, Cartões). Portal em `document.body`. Posicionamento `bottom: calc(58px + safe-area + 16px)` no mobile para não cobrir BottomTabBar; desktop `bottom-right`.
- `src/components/assessor/AssessorPanel.tsx`: mobile bottom-sheet full-screen; desktop side panel/modal. Safe-area, keyboard-aware, auto-scroll.
- `src/pages/Assessor.tsx`: rota `/app/assessor/:conversationId?` — conversa completa persistida.
- Sugestões iniciais: "Registrar um gasto", "Como está meu mês?", "Ver metas", "Analisar fatura", "O que posso melhorar?".
- Renderização de mensagens: markdown, cards de confirmação estruturados (resumo → confirmar/cancelar), card de sucesso pós-execução com "Desfazer" quando seguro (reverter transação criada nos últimos 60s).
- Loading: "Estou olhando suas finanças…". Retry preserva input. Histórico indicando origem App/WhatsApp quando misturado.
- Client → Edge Function `agent-run` via `supabase.functions.invoke('agent-run', { body: { source: 'app', ... } })`. Nenhum secret no cliente.

### Testes
- Auth: chamada sem JWT → 401.
- Conversa persiste user_id e source='app'.
- Escrita requer confirmação (pending_confirmations criada).
- Sucesso e erro renderizam corretamente.
- FAB não cobre BottomTabBar (`fixed`, z-index acima, portal).

## 4. Insights e Home

- `insights-generate/index.ts`: adicionar fallback determinístico quando IA falhar (top categoria do mês, comparação, dica genérica). Nunca retornar título vazio.
- `AssistantTipCard.tsx`: se `title` vazio/undefined, não renderiza card.
- Fatura no assessor: chamar `credit_card_statement` como ferramenta.
- Invalidar queries `home`, `cartoes`, `chat` via React Query após ações do agente (`queryClient.invalidateQueries`).

## 5. Qualidade e aceite

- Rodar `bunx vitest run` — suíte completa passa.
- Typecheck `tsgo`.
- Build vite.
- Testes RLS entre 2 users via psql SELECT direto (SET LOCAL).
- Deploy Edge Functions modificadas (agent-run só se alterada).
- Migrations aplicadas via `supabase--migration` (uma por frente: `credit_cards` + `transactions_columns`).
- Confirmar: sem dados sintéticos permanentes (`credit_cards` count = 0 no fim; `conversations source='app'` só se usuário testou).
- Relatório final: migrations aplicadas, funções deployadas, testes verdes, arquivos alterados, URL de preview.

## Arquivos previstos (~25)

**Migrations:**
- `supabase/migrations/*_credit_cards.sql`
- `supabase/migrations/*_transactions_payment_method.sql`
- `supabase/migrations/*_accounts_opening_balance_check.sql` (só se houver CHECK)
- `supabase/migrations/*_conversations_source.sql` (só se faltar)

**Backend:**
- editar `supabase/functions/agent-run/index.ts` (source=app)
- editar `supabase/functions/insights-generate/index.ts` (fallback)

**Frontend novos:**
- `src/pages/Cartoes.tsx`, `src/pages/CartaoDetalhe.tsx`
- `src/pages/Assessor.tsx`
- `src/components/assessor/AssessorFab.tsx`, `AssessorPanel.tsx`, `MessageList.tsx`, `ConfirmCard.tsx`
- `src/components/cartoes/NovoCartaoModal.tsx`, `FaturaCard.tsx`, `CartaoResumoHome.tsx`
- `src/lib/db/creditCards.ts`, `src/lib/db/chat.ts`
- `src/lib/validation/creditCards.ts`

**Frontend editados:**
- `src/pages/Contas.tsx`, `src/lib/validation/finance.ts`, `src/lib/db/finance.ts` (saldo zero)
- `src/pages/Lancamentos.tsx` (toggle conta/cartão)
- `src/pages/Index.tsx` (CartaoResumoHome)
- `src/pages/MaisMenu.tsx` (link Cartões)
- `src/App.tsx` (rotas /app/cartoes, /app/assessor)
- `src/components/AppLayout.tsx` (FAB)
- `src/lib/engine/facts.ts` (garantir que limite não entra no patrimônio)
- `src/lib/gamification/rules.ts`

**Testes novos/editados:**
- `src/test/account-opening-balance.test.ts`
- `src/test/credit-cards.test.ts` (fechamento, parcelamento, patrimônio)
- `src/test/assessor.test.tsx` (FAB, portal, confirmação)
- `src/test/insights-fallback.test.ts`

Após aprovação, implemento tudo em sequência, rodo testes/typecheck/build e reporto evidências.