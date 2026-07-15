## NoControle.ia — Rodada Consolidada (Núcleo Financeiro Real)

Objetivo: substituir o protótipo localStorage por núcleo multiusuário real no Supabase, corrigir pendências da F1 e entregar CRUDs ponta a ponta com dashboard factual. Sem WhatsApp, IA, Divisão do Rolê ou Open Finance.

---

### 1. Correções da F1 (fundação)

- `AuthContext`: separar estados `loading | authenticated | needs-onboarding | error | no-profile`; nunca ficar preso em spinner; recuperação via retry e signOut seguro.
- `has_role(_role app_role)`: usar `auth.uid()` internamente (drop assinatura antiga e recriar). Atualizar RPCs e políticas.
- `complete_onboarding`: transacional; valida display_name, income>=0, income_day 1–31, frequência enum; grava profile + user_financial_settings atomicamente; idempotente.
- `/admin`: montar rota real dentro de `AdminRoute` (dashboard mínimo).
- Reset de senha: escutar `PASSWORD_RECOVERY` em `AuthContext`; página trata token ausente/expirado com mensagem clara.
- Renomear metadados remanescentes ("Mindful Money", "lovable template") para NoControle.ia em `index.html`, `package.json` name, README curto.
- `localStorage` `financial_ecosystem_v2`: **nunca apagar automaticamente**; permanece intacto até import confirmado.

---

### 2. Banco de dados (migrations em ordem)

**M1 — enums e utilitários**
`account_type`, `transaction_type` (income/expense/transfer), `transaction_status` (confirmed/planned), `category_kind` (income/expense), `frequency` (diaria/semanal/quinzenal/mensal/anual), `debt_status`, `mood_level`.

**M2 — tabelas do ledger**
- `accounts` (name, type, institution?, opening_balance numeric(14,2), active, user_id).
- `categories` (name, kind, color, icon, is_global bool, user_id nullable p/ globais).
- `transactions` (account_id, category_id?, type, status, amount numeric(14,2) CHECK>0, occurred_at date, description, notes?, emotional_trigger?, transfer_group_id?, user_id). Trigger `validate_transaction` (já existe — revisar).
- `goals` + `goal_contributions` (amount>0, contributed_at, transaction_id? nullable).
- `investments` (invested_amount>=0, current_value>=0, reference_date, goal_id?).
- `debts` (original_amount>0, outstanding_balance>=0, installment_amount?, due_day 1–31?, interest_rate? numeric, rate_kind text 'mensal'|'anual'|null, status).
- `recurring_entries` (type income/expense, amount>0, frequency, next_due_date, account_id, category_id?, active).
- `emotional_checkins` (date, mood, trigger?, notes?).
- `challenges` (global readonly) + `user_challenges`.
- `import_batches` + `import_rows` (schema apenas, sem UI de importação genérica).

Cada tabela: `id uuid`, `user_id uuid not null`, `created_at`, `updated_at` + trigger, índices por `user_id` e por colunas de filtro (occurred_at, status).

**M3 — GRANTs + RLS**
Para cada tabela `public.*`:
```
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<t> TO authenticated;
GRANT ALL ON public.<t> TO service_role;
ALTER TABLE ... ENABLE RLS;
```
Políticas estritas: `user_id = auth.uid()` para tabelas pessoais. `categories`: SELECT permite `is_global = true OR user_id = auth.uid()`; INSERT/UPDATE/DELETE apenas `user_id = auth.uid() AND is_global = false`. `challenges` global: SELECT para authenticated, sem mutação.

**M4 — RPCs SECURITY DEFINER** (search_path=public; revogar de anon/public; grant execute apenas a authenticated/admin):
- `create_transfer(from, to, amount, occurred_at, description)` — já existe, reforçar.
- `record_goal_contribution(goal_id, amount, contributed_at, from_account_id?)` — cria contribution + opcionalmente transaction de saída.
- `admin_dashboard_stats()` — já existe, revalidar `is_current_user_admin`.
- Seed de categorias BR (Alimentação, Moradia, Transporte, Saúde, Educação, Lazer, Salário, Freelance, Investimento, Outros) como `is_global=true`.

**M5 — reforço**
- `has_role(app_role)` versão sem `_user_id`.
- Constraints: `debts.rate_kind CHECK`, `transactions.transfer_group_id` obrigatório se type=transfer (já no trigger).
- View `account_balances` (security_invoker=on): saldo derivado de `opening_balance + Σ transactions confirmadas` por conta.

---

### 3. Front-end

**Data layer**
- `src/lib/api/*.ts` por domínio: `accounts.ts`, `categories.ts`, `transactions.ts`, `goals.ts`, `investments.ts`, `debts.ts`, `emotional.ts`, `admin.ts`. Cada um expõe hooks TanStack Query (`useAccounts`, `useCreateTransaction`, …) com invalidação encadeada.
- `QueryClientProvider` já existe — configurar staleTime/retry.
- Schemas Zod pt-BR em `src/lib/validation/*`.
- Utilitário `formatDate`/`parseDate` sem drift de timezone (armazenar `YYYY-MM-DD` e converter em local).

**Contexts**
- Manter `FinancialContext` apenas como fachada de leitura durante migração; a fonte primária passa a ser Supabase. Remover mutações locais; qualquer escrita direciona ao Supabase.
- `localStorage` legado exposto por hook `useLegacyLocalData()` (somente leitura) para a tela de importação.

**Telas (reaproveitar UI premium existente)**
- Contas: CRUD com saldo derivado da view.
- Categorias: listar globais + pessoais; CRUD apenas pessoais.
- Lançamentos: form de receita/despesa/transferência; filtros por mês/conta/categoria/tipo; editar/excluir com AlertDialog.
- Metas + aportes; múltiplas metas.
- Investimentos e dívidas: CRUD + vínculo opcional com meta.
- Antes de Gastar: função `simulateSpending` recebe `{amount, accountId?, categoryId?}` e devolve `{saldoDisponivel, confirmadosMes, planejadosMes, recorrenciasProximas, dividasVencendo, metasImpactadas, premissas[]}`. Sem score/aprovação.
- Check-in emocional: modal + histórico simples.
- Dashboard: cards com saldo consolidado (via view), receitas/despesas do mês, top categorias, próximos compromissos (recurring + planned), patrimônio (contas + investimentos − dívidas), progresso das metas, lista de dívidas. Empty state: "Ainda não há dados suficientes".
- Página `/app/importar`: prévia dos dados legados, botão "Importar", marca `imported_at` em localStorage. Sem exclusão automática.

**Admin `/admin`**
- Cards com resultado de `admin_dashboard_stats`. Sem PII.

**Remoções**
- Scores financeiro/emocional arbitrários.
- Projeção linear.
- Placeholders "em breve" que fingiam persistência.

---

### 4. Testes (Vitest)

- `engine.simulateSpending` — casos com/sem conta, com dívidas próximas.
- Transferência não conta como receita/despesa nos agregados.
- Progresso de meta = Σ contribuições.
- Patrimônio = contas + investimentos − dívidas.
- Timezone: transação de 01/mês não migra para mês anterior.
- Zod: valores negativos/zero rejeitados; dinheiro decimal.

`npm run test` e `npm run build` devem passar.

---

### 5. Arquivos previstos

**Criar**
- `supabase/migrations/*` (M1–M5)
- `src/lib/api/{accounts,categories,transactions,goals,investments,debts,emotional,admin}.ts`
- `src/lib/validation/{account,category,transaction,goal,investment,debt}.ts`
- `src/lib/date.ts`, `src/lib/money.ts`
- `src/lib/engine/simulateSpending.ts` (+ testes)
- `src/pages/app/{Contas,Categorias,Lancamentos,Metas,Investimentos,Dividas,AntesDeGastar,CheckIn,Importar}.tsx`
- `src/pages/admin/AdminDashboard.tsx`
- `src/components/forms/*` (form fields reutilizáveis com RHF+Zod)
- Testes em `src/**/__tests__/`.

**Alterar**
- `src/context/AuthContext.tsx` (estados + PASSWORD_RECOVERY)
- `src/context/FinancialContext.tsx` (fachada leitura)
- `src/App.tsx` (rotas novas + /admin)
- `src/pages/Onboarding.tsx` (usar `complete_onboarding` RPC)
- `src/pages/Index.tsx` (dashboard factual)
- `index.html`, `package.json` (nome NoControle.ia)

---

### 6. Riscos

- Volume grande em uma rodada → priorizar ordem A→B→C→D; se necessário, D fica com stub honesto ("sem dados ainda").
- Migração de dados legados: só via tela de importação manual.
- RLS mal configurada: mitigar com testes manuais entre dois usuários no fim.
- Timezone BRL: centralizar em `src/lib/date.ts`.

---

### 7. Ordem de execução

1. Migrations M1 → M5 (uma migration única consolidada, para economizar aprovações).
2. Regen tipos Supabase.
3. `src/lib/{date,money}.ts` + validações Zod.
4. Camada `src/lib/api/*` + hooks Query.
5. AuthContext + Onboarding RPC + rota /admin.
6. Telas A (contas, categorias, lançamentos, transferência).
7. Dashboard factual + view de saldos.
8. Telas C (metas, investimentos, dívidas).
9. Antes de Gastar + check-in emocional.
10. Tela de importação do legado.
11. Testes + `npm run build`.
12. Rebrand final de metadados.

---

### 8. Créditos: **alto**. Escopo comprime várias fases; mitigar não repetindo migrations e evitando refactors visuais.

Ao fim entrego: lista de migrations aplicadas, telas concluídas, testes executados com resultado, e pendências reais restantes.
