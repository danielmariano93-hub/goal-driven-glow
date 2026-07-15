
# Fase 2 — Núcleo Financeiro Real (NoControle.ia)

Escopo grande em rodada única. Ordem por dependência e priorização honesta ao final.

---

## 1. Correções F1 (bloco 0)

- **AuthContext**: separar `loading | ready | error`; se `fetchProfileAndRoles` falhar, expor `authError` e botão "tentar novamente"; se profile ausente após sucesso, chamar RPC `ensure_profile()` (SECURITY DEFINER) que insere linha se faltar; ProtectedRoute mostra estado de erro em vez de spinner infinito.
- **Onboarding atômico**: RPC `complete_onboarding(p_display_name, p_income, p_frequency, p_income_day)` valida tudo e faz upsert de `profiles` + `user_financial_settings` em uma transação. Substitui os dois updates atuais do front.
- **has_role**: manter função para uso em policies (SECURITY DEFINER, chamada pelo Postgres). Remover uso via RPC do cliente. Criar `is_current_user_admin()` que retorna `has_role(auth.uid(),'admin')` — só a versão auth.uid() é exposta. `AdminRoute` passa a chamar essa.
- **Reset de senha**: `AuthContext` escuta `PASSWORD_RECOVERY` e roteia para `/reset-password`; página valida `type=recovery` + presença de sessão temporária; expiração/erro tratados.
- **Rota `/admin`** com `AdminRoute` (ver bloco 6).
- **Rebranding**: sweep final em index.html, package.json name, README, meta tags.
- **localStorage**: não apagar. Adaptador de importação one-shot (bloco 3).

---

## 2. Modelo Supabase (bloco 1 — migration única)

Convenções: `numeric(14,2)` para dinheiro, `timestamptz`, `updated_at` via trigger, RLS `user_id = auth.uid()`, GRANTs a `authenticated` + `service_role`, sem GRANT anon, índices por `user_id`+data.

Tabelas:
- `accounts` (tipo enum `account_type`: checking/savings/cash/investment/other).
- `categories` — global (`user_id IS NULL`, insert/update bloqueado a authenticated) + pessoais (RLS por user); enum `category_type` income/expense; `slug`, `name`, `color`, `icon`.
- `transactions` — enum `transaction_type` income/expense/transfer, `status` confirmed/planned, `amount>0`, `occurred_at date`, `transfer_group_id uuid` para pareamento. Trigger valida: transfer exige 2 pernas com mesmo `transfer_group_id`, mesmo `amount`, contas diferentes, categorias nulas.
- `goals` (`status` active/paused/completed), progresso derivado.
- `goal_contributions` (`amount>0`, `occurred_at`, `account_id` opcional).
- `investments` (`invested_amount>=0`, `current_value>=0`, `reference_date`, `goal_id` opcional; sem rentabilidade).
- `debts` (`outstanding_balance>=0<=original_amount`, `interest_rate_pct` rotulada, `status`).
- `recurring_entries` (frequency enum daily/weekly/monthly/yearly, `next_due_date`).
- `emotional_checkins` (`mood` smallint 1..5, opcional `transaction_id`).
- `challenges` (catálogo global RO) e `user_challenges`.
- `import_batches` + `import_rows` (status/erros; sem parser nesta rodada).

RPCs SECURITY DEFINER (search_path fixo, revoke public/anon):
- `ensure_profile()` — cria profile faltante para `auth.uid()`.
- `complete_onboarding(...)` — atômico.
- `create_transfer(from_account, to_account, amount, occurred_at, description)` — insere par transacional.
- `is_current_user_admin()`.
- `admin_dashboard_stats()` — só se admin; retorna agregados sem PII.

Seed: categorias BR (Alimentação, Moradia, Transporte, Saúde, Lazer, Educação, Assinaturas, Salário, Renda Extra, etc.) com `on conflict do nothing` pelo `slug`.

Realtime não é habilitado nesta fase.

---

## 3. Camada de dados no front (bloco 2)

- Novo `src/lib/db/` com hooks TanStack Query por entidade (`useAccounts`, `useTransactions({filters})`, `useGoals`, etc.).
- `FinancialContext` legado é removido gradualmente: substituído por hooks + páginas consomem direto. Preservar tipos e utilitários em `src/lib/engine.ts` que forem factuais; remover scores arbitrários e projeções.
- Sem optimistic update em mutações financeiras; usar `onSuccess: invalidateQueries`.
- Datas: guardar `date` (YYYY-MM-DD) e formatar em `America/Sao_Paulo` (date-fns-tz).
- Validação Zod pt-BR em cada form.

Adaptador de importação:
- Novo `src/lib/import/localImport.ts` detecta chave `financial_ecosystem_v2`.
- Página `/app/importar` mostra contagens (transações, metas, dívidas, investimentos) e botão "Importar".
- Executa em lote via RPC/batch inserts idempotente por `client_uid`; ao final marca `localStorage['ncia_import_done']=timestamp`. Não apaga origem.

---

## 4. Fluxos e páginas (bloco 3)

CRUD real com feedback (toast, loading, empty, erro/retry):
- `/app/contas` — nova página; lista + create/edit/archive.
- `/app/lancamentos` — refatorada: filtros período/tipo/categoria/conta; edição/exclusão com confirmação; ação "Transferência" chama `create_transfer`.
- `/app/metas` — múltiplas metas, tela de detalhe com aportes.
- `/app/investimentos` — CRUD, vínculo opcional com meta.
- `/app/dividas` — CRUD.
- `/app/planejamento` — "Antes de gastar" factual (bloco 5).
- `/app/emocoes` — check-in simples, opcionalmente vinculado a transação.
- `/app/categorias` — gerenciar pessoais; globais somente leitura.
- `/app/perfil` — dados de `profiles` + `user_financial_settings` + botão "alterar senha" via e-mail.
- Rota `/app/importar` (uma vez).

---

## 5. Dashboard factual (bloco 4)

Remove score financeiro, score emocional e projeção linear. Novo `src/lib/engine/facts.ts` com funções puras testadas:
- `computeAccountBalances(txs, accounts)` — soma income − expense; transfer move entre contas, não afeta líquido.
- `computeMonthlyIncomeExpense(txs, month, tz)`.
- `computeCategoryBreakdown(txs, month)`.
- `computeGoalProgress(goal, contributions)`.
- `computeNetWorth(accounts, investments, debts)` — com tooltip explicando fórmula.
- `computeUpcomingCommitments(recurring, plannedTxs, horizonDays)`.
- `computeBeforeSpending({amount, accountId, plannedTxs, recurring, debts, goals})` — retorna `{ availableAfter, upcomingCommitments, goalsAtRisk, assumptions[], missingData[] }`. Sem aprovação/score.

Empty states: "Ainda não há dados suficientes" com CTA para adicionar.

---

## 6. /admin mínimo (bloco 5)

- `AdminRoute` chama `is_current_user_admin()`.
- Página `/admin` mostra: total de usuários, novos últimos 7/30 dias, % onboarding concluído, contagem total de transações (sem descrição), contagem por tabela.
- Backend via RPC `admin_dashboard_stats()` que valida admin, retorna só agregados. `revoke execute ... from public, anon`.
- Sem edição de dados nesta rodada.

---

## 7. Testes (bloco 6)

Setup Vitest + jsdom + testing-library. Cobertura obrigatória:
- `facts.test.ts`: transferência não conta como renda/despesa; goal progress; net worth; before spending com premissas; DST/fuso; decimais.
- `validation.test.ts`: schemas auth + onboarding + transaction.
- `import.test.ts`: mapping localStorage → payload sem duplicar.

Rodar `bunx vitest run` + build. Relatar contagem passing.

---

## 8. Ordem de execução

1. Migration única (modelo + RPCs + seed).
2. Regenerar tipos.
3. Corrigir AuthContext + AdminRoute + rota /admin.
4. Camada `src/lib/db/` + `facts.ts`.
5. Refatorar Onboarding via RPC.
6. CRUD por prioridade A→D (bloco 4). Ordem interna: contas → categorias → transações (+ transfer) → dashboard factual → metas/aportes → investimentos → dívidas → recorrentes → antes de gastar → emoções → desafios → importação → /admin.
7. Testes + build.
8. Rebranding sweep.

---

## 9. Riscos, cortes e escopo honesto

- **Recorrentes automáticas**: apenas cadastro + listagem "próximos"; NÃO gera transações automaticamente (job cron fora do escopo).
- **Desafios**: catálogo com 3–5 desafios seed + toggle join/leave e progresso derivado; sem gamificação complexa.
- **Import CSV/OFX**: só schema `import_batches/rows` + UI de importação do localStorage; parsers de arquivo ficam para próxima fase.
- **Realtime, notificações push, cron, WAHA, agente**: fora.
- Se o orçamento apertar durante execução, cortar nesta ordem reversa: desafios → emoções → recorrentes UI → antes de gastar avançado. Manter A/B/C intactos.

---

## 10. Estimativa

**Alta** — é a maior fase do projeto. Uma migração pesada, ~25 arquivos novos, refactor amplo, suite de testes.

Aguardando aprovação para executar em rodada única.
