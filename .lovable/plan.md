# Plano consolidado — Insights comportamentais, taxonomia auditável e categorias personalizadas

Escopo estrito: quatro blocos aprovados. Nenhuma mudança fora deles. Preserva reconciliação bruta atual (3.275,59 + 11.840,65 - 14.976,29 = 139,95).

---

## Bloco 1 — Insights não usam mais fluxo bruto para diagnóstico comportamental

### Alvo do defeito
`supabase/functions/insights-generate/index.ts:117-141` chama `computeAccountStatementTotals` e joga `accountIn/accountOut` em `income_month/expense_month`. `pickFallback` (mirror em `src/lib/insights/fallbacks.ts:101` e `supabase/functions/_shared/insights/fallbacks.ts`) então compara e emite "gastou X a mais". Isso mistura CDB, estorno, consignado e fatura.

### Mudança
1. **Backend (`insights-generate/index.ts`)**:
   - Importar `computeMonthlyTotals` do `_shared/engine/facts.ts` (regra canônica já existente: exclui `internal_transfer`, `investment_application`, `investment_redemption`, `settles_card_id`; refund abate despesa).
   - Manter também o cálculo bruto via `computeAccountStatementTotals` **só** para `evidence` (auditoria/observabilidade).
   - `facts.income_month = behavioral.income`, `facts.expense_month = behavioral.expense`, `facts.balance_month = behavioral.net`.
   - `evidence` passa a incluir campos explícitos: `behavioral_income`, `behavioral_expense`, `behavioral_net`, `gross_account_in`, `gross_account_out`, `gross_card_out`, `accounting_scope: "behavioral_v1"`, `prompt_version` bump.
   - Prompt do modelo (arquivo `supabase/functions/_shared/insights/prompt.ts` se existir; senão, string inline dentro do index.ts) recebe nota: "Nunca dizer que o usuário gastou mais do que recebeu usando fluxo bancário bruto. Use apenas `behavioral_income/expense`."
   - Antes de inserir novo insight, `UPDATE user_insights SET dismissed_at = now() WHERE user_id = uid AND dismissed_at IS NULL AND (evidence->>'accounting_scope') IS DISTINCT FROM 'behavioral_v1'` — invalida cards antigos do usuário e força regeneração.
   - Guard: se `behavioral_income == 0` e `behavioral_expense == 0` mas existem transações do mês com `movement_kind IN ('transaction','refund')` sem categoria (>3), pular o fallback de "apertado" e retornar `categorize_transaction` já existente (prioridade máxima).
2. **`_shared/insights/fallbacks.ts` + `src/lib/insights/fallbacks.ts`** (espelho):
   - Reforçar cabeçalho: "Todas as métricas em InsightFacts são comportamentais. Nunca comparar contra fluxo bancário bruto."
   - Nenhuma mudança funcional no `pickFallback` — ele já opera sobre `income_month/expense_month` (agora comportamentais).
3. **Testes novos** (`src/test/insights-behavioral-scope.test.ts`):
   - Fixture com o cenário de julho/2026 do usuário: aplicação CDB 5.000, resgates 2.501,62, estorno Uber, PIX consignado 6.135,13 (loan_proceeds), salário legítimo, gastos de consumo.
   - Asserção: `computeMonthlyTotals` **exclui** CDB, resgate, refund contabilizado como abate, consignado excluído (via novo `movement_kind = 'loan_proceeds'` — ver Bloco 2), fatura excluída.
   - Asserção: bruto (`computeAccountStatementTotals`) continua fechando 11.840,65 / 14.976,29.
   - Asserção: `pickFallback` NÃO retorna alerta "gastou X a mais" quando `behavioral_expense <= behavioral_income`.

### Aceite Bloco 1
- Home continua com Ponte de Caixa bruta idêntica (139,95).
- Insight atual do usuário some no próximo cron; próximo insight não afirma déficit; se persistir, evidencia campos comportamentais no `evidence`.

---

## Bloco 2 — Taxonomia e reparos auditáveis (movement_kind + títulos + categorias)

### Extensão do enum `movement_kind`
Migration `20260721000000_movement_kinds_and_data_repair.sql`:

1. **Ampliar CHECK constraints** em `public.transactions` e `public.extracted_items`:
   - Novos valores: `investment_yield` (rendimento pago em conta) e `loan_proceeds` (crédito de empréstimo/consignado).
   - `DROP CONSTRAINT ... IF EXISTS` seguido de `ADD CONSTRAINT ... CHECK (movement_kind IN ('transaction','refund','internal_transfer','investment_application','investment_redemption','investment_yield','loan_proceeds'))`.
2. **Atualizar `_shared/documents/types.ts`** `ALLOWED_MOVEMENT_KINDS` para incluir os dois novos valores.
3. **Atualizar `_shared/engine/facts.ts` + `src/lib/engine/facts.ts`**:
   - `isRealMonthlyMovement` exclui também `loan_proceeds` (não é renda comportamental) e `investment_yield` (aparece como rendimento patrimonial, não renda).
   - `isGrossAccountMovement` continua aceitando ambos (afetam extrato).
   - `EXCLUDED_MOVEMENT_KINDS` recebe os dois.
4. **Atualizar `_shared/documents/normalize.ts`** dicionário: `consignado`, `emprestimo`, `financiamento` → categoria "Financeiro" e hint `movement_kind: 'loan_proceeds'`; `rend pago aplic`, `rendimento` → hint `investment_yield`. Requer ampliar o retorno de `normalizeDescription` OU criar helper `classifyBankLine(raw)` retornando `{ friendly, category_hint, movement_kind_hint }` sem quebrar chamadas atuais (mantém `friendly/category_hint`, adiciona campo opcional).

### Categorias globais criadas/garantidas
No mesmo migration:
- `INSERT ... ON CONFLICT DO NOTHING` em `public.categories` (user_id NULL) para:
  - `Rendimento de Investimentos` (type=income)
  - `Aplicações e Resgates` (type=expense, marca conceitual — não conta em relatórios porque `movement_kind` a exclui)
  - `Crédito de empréstimo` (type=income, também excluída via `movement_kind='loan_proceeds'`)

### Categorias pessoais criadas
Para o usuário `088920ce-1f5e-47d5-9e07-e2e4a63f9214`, via `INSERT ... ON CONFLICT (user_id,slug) DO NOTHING`:
- `Seguros` (expense)
- `Dívidas e empréstimos` (expense)

### Reparos idempotentes de dados
Bloco `DO $$` no mesmo migration, sempre com guard `WHERE user_edited_at IS NULL` para não sobrescrever edição manual:

| ID | Título | Categoria | movement_kind |
|---|---|---|---|
| 3f4b8225…, 896d9ce6… | Rendimento de aplicação | Rendimento de Investimentos (global) | investment_yield |
| db0bace0… | Resgate de CDB | Aplicações e Resgates (global) | investment_redemption |
| 4c1a0f4b… | Resgate de investimento — Sabesp FIA | Aplicações e Resgates | investment_redemption |
| bc4dd74e… | Crédito de empréstimo consignado | Crédito de empréstimo | loan_proceeds |
| 0537ee0d…, f10ee200…, 9f92df61…, ea7f823b… | Estorno Uber | Transporte (global) | refund |

Reparos por descrição (idempotentes, mesmo usuário, `user_edited_at IS NULL`):
- `description ILIKE 'PAY Souk4%'` → título `Market4you`, categoria `Mercado`.
- `description ILIKE '%Pay Nutri%' OR ILIKE '%Nutricar%'` → `Nutricar`, `Alimentação`.
- `description ILIKE 'Pay Ifd %'` → `iFood`, `Alimentação`.
- `description ILIKE 'Pay Oxxo%'` → `OXXO`, `Mercado`.
- `description ILIKE 'Pay Mep%'` → `MEP Eventos`, `Lazer`.
- `description ILIKE 'Pay Lanch%'` → `Lanche`, `Alimentação`.
- `description ILIKE '%Mc Donalds%' OR ILIKE '%McDonalds%'` → `McDonald's`, `Alimentação`.
- `description ILIKE '%Seguro%cart%'` → categoria pessoal `Seguros`.
- `description ILIKE 'BOLETO Banco PAN Recebimento Reneg%'` → título `Pagamento de renegociação — Banco PAN`, categoria pessoal `Dívidas e empréstimos`.
- `description ILIKE 'APLICACAO CDB%'` E `movement_kind = 'investment_application'` E `category` atual = `Outros` → categoria `Aplicações e Resgates`.

Cada UPDATE loga em `document_import_audit` (já existe) via `INSERT` com `action='data_repair_v1'` e `payload jsonb` contendo id, campo antigo e novo, para trilha.

**Ambíguos preservados** (nenhum UPDATE): PIX de pessoas, PAY Alexa, EBANX, DL Ub, Logoa, MP BL, PagueVeloz, Pagar.me, V-connect, Zimba, Jakso, PEX, Instituto D, Authentic, DM Sp, PIX Qrs Daniel Mari. Registrar no audit `action='data_repair_v1_skipped'` com `reason='ambiguous_counterparty'`.

### Testes
- `src/test/documents-types.test.ts`: adicionar casos para novos `movement_kind`.
- `src/test/facts.test.ts`: adicionar `loan_proceeds` e `investment_yield` — não entram em `computeMonthlyTotals`, entram em `computeAccountStatementTotals`.

### Aceite Bloco 2
- Enum ampliado; typecheck verde.
- Consultas SQL de validação (executadas ao final da migration como `RAISE NOTICE`) confirmam que os IDs listados têm o `movement_kind`/categoria esperados.
- Reconciliação bruta continua fechando 139,95 (nenhum registro removido; apenas reclassificado).

---

## Bloco 3 — Categorias personalizadas descobríveis e não destrutivas

### Schema (mesma migration ou separada `20260721000100_categories_archive.sql`)
- `ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL`.
- Índice parcial: `CREATE INDEX IF NOT EXISTS categories_user_active_idx ON public.categories(user_id, type) WHERE archived_at IS NULL`.
- Unicidade lógica: `CREATE UNIQUE INDEX IF NOT EXISTS categories_user_type_name_active_idx ON public.categories(user_id, type, lower(name)) WHERE user_id IS NOT NULL AND archived_at IS NULL`.
- RLS já existe; não alterar policies (já restringem a `user_id = auth.uid()` para escrita). Confirmar via `security--get_table_schema` antes de tocar.

### Backend hooks (`src/lib/db/finance.ts`)
- `useCategories()`: acrescentar `.is("archived_at", null)` no filtro; ordenar por `user_id NULLS LAST` para priorizar personalizadas.
- `useSaveCategory()`: validar erro `23505` (dup unique) e retornar mensagem "Você já tem uma categoria com esse nome". Ao concluir, invalidar também `["transactions"]` e `["dashboard"]`.
- `useDeleteCategory()`: transformar em **arquivamento**. Se `user_id === null` → rejeitar com "Categoria padrão não pode ser removida". Se existe pelo menos 1 `transactions.category_id = id`, executar `UPDATE categories SET archived_at = now()`; caso contrário, `DELETE` real. Invalidar `["categories","transactions","dashboard"]`.
- `CategoryInput` (`src/lib/validation/finance.ts`): adicionar `icon: z.string().max(40).optional()` (já opcional; formalizar) e `color: z.string().regex(/^#[0-9A-F]{6}$/i).optional()`.

### UI
1. **`src/pages/Categorias.tsx`**:
   - Cabeçalho ganha subtítulo "Personalize para relatórios mais claros. Padrões nunca são excluídos.".
   - Toast de arquivamento diferencia "Arquivada (mantida no histórico)" vs "Excluída".
   - Exibir contagem de lançamentos vinculados no card antes de arquivar.
   - Ícone opcional: adicionar seletor com `lucide-react` (subset: Tag, ShoppingBag, Car, Utensils, Home, Heart, Briefcase, Gift, Wallet).
2. **`src/pages/MaisMenu.tsx`**: adicionar entrada "Gerenciar categorias" → `/app/categorias` com ícone `Tag` e descrição curta. Confirmar rota já registrada em `App.tsx`; se ausente, incluir `<Route path="categorias" element={<Categorias />} />`.
3. **Novo componente `src/components/finance/CategorySelect.tsx`** (compartilhado):
   - Props: `value`, `onChange`, `type: 'income' | 'expense'`, `allowCreate?: boolean` (default true).
   - Lista globais (`user_id === null`) + pessoais ativas do usuário do tipo compatível.
   - Item final `+ Criar nova categoria` abre `CatModal` reusado (extrair do `Categorias.tsx` para `src/components/finance/CategoryModal.tsx` sem alterar comportamento). Ao salvar, chama `useSaveCategory` e seleciona a recém-criada via `onChange(newId)`.
   - Loading e empty state amigáveis.
4. **Substituir selects atuais** por `CategorySelect`:
   - `src/pages/LancamentoDetalhe.tsx` (edição de transação).
   - `src/pages/Lancamentos.tsx` (form de novo lançamento e filtros — no filtro, `allowCreate=false`).
   - `src/components/assessor/ReviewSheet.tsx` (revisão de importação — respeita `type` do item).
   - `src/pages/Recorrencias.tsx` (novo/edit).
   - Qualquer outro form encontrado via `rg "categories\.map\|category_id" src/` durante a execução.
5. **Relatórios (`src/lib/reports/aggregations.ts` + `src/pages/Relatorios.tsx`)**: garantir que categorias arquivadas ainda apareçam nos totais históricos (query separada sem filtro `archived_at IS NULL` só para nomes de exibição). Já usa `category_name` denormalizado no fixture; validar que a UI mostra nome mesmo se `archived`.

### Testes
- `src/test/categories-crud.test.ts`: cria, edita, arquiva com transações vinculadas, tenta apagar global (rejeita), unicidade case-insensitive.
- `src/test/category-select.test.tsx`: lista globais+pessoais do tipo correto, cria inline e seleciona.
- `src/test/import-review-personal-category.test.ts`: `ReviewSheet` permite salvar item com categoria pessoal recém-criada.

### Aceite Bloco 3
- Do menu Mais dá pra chegar em "Gerenciar categorias".
- Em qualquer formulário de lançamento, o usuário vê suas categorias + as globais e cria inline sem sair.
- Arquivar categoria com histórico não perde relatórios.
- RLS confirmada via query manual pós-migration.

---

## Bloco 4 — Consistência sistêmica e checklist de aceite

### Ações
- Após aplicar tudo, executar `supabase--read_query`:
  1. Reconciliação bruta jul/2026 do usuário (via `computeAccountStatementTotals` server-side query) = 3.275,59 + 11.840,65 - 14.976,29 = 139,95.
  2. Contagem por `movement_kind` antes/depois no período — anexar ao relatório.
  3. `SELECT id, description, category_id, movement_kind FROM transactions WHERE id IN (…lista…)` para confirmar reparos.
- Redeploy Edge Functions: `insights-generate`, `assistant-ingest-document`, `assistant-review-actions`.
- Executar `bunx vitest run` — todos verdes, incluindo os novos testes.
- Não gerar novo insight manualmente; deixar o cron `insights-generate` rodar na próxima janela e verificar via `supabase--read_query` que `evidence->>'accounting_scope' = 'behavioral_v1'`.

### Checklist de aceite (validação final antes de reportar concluído)
- [ ] Ponte de Caixa jul/2026 do usuário = 139,95.
- [ ] `computeMonthlyTotals` exclui CDB, resgates, refund (só abate), consignado.
- [ ] Insight ativo do usuário está `dismissed_at IS NOT NULL` ou é `accounting_scope='behavioral_v1'`.
- [ ] IDs listados no Bloco 2 têm `movement_kind` e `category_id` conforme tabela.
- [ ] Nenhum registro com `user_edited_at IS NOT NULL` foi alterado (query de auditoria).
- [ ] Ambíguos listados NÃO tiveram categoria alterada.
- [ ] `Categorias.tsx` acessível via Mais.
- [ ] `CategorySelect` em uso em todos os formulários listados.
- [ ] `bunx vitest run` verde.
- [ ] Deploys OK.

---

## Arquivos afetados (mapa completo)

**Migrations (novas)**
- `supabase/migrations/20260721000000_movement_kinds_and_data_repair.sql`
- `supabase/migrations/20260721000100_categories_archive.sql`

**Backend Edge Functions**
- `supabase/functions/insights-generate/index.ts`
- `supabase/functions/_shared/insights/fallbacks.ts`
- `supabase/functions/_shared/engine/facts.ts`
- `supabase/functions/_shared/documents/types.ts`
- `supabase/functions/_shared/documents/normalize.ts`

**Frontend**
- `src/lib/insights/fallbacks.ts` (espelho)
- `src/lib/engine/facts.ts` (espelho)
- `src/lib/db/finance.ts`
- `src/lib/validation/finance.ts`
- `src/pages/Categorias.tsx`
- `src/pages/MaisMenu.tsx`
- `src/pages/LancamentoDetalhe.tsx`
- `src/pages/Lancamentos.tsx`
- `src/pages/Recorrencias.tsx`
- `src/components/assessor/ReviewSheet.tsx`
- `src/components/finance/CategorySelect.tsx` (novo)
- `src/components/finance/CategoryModal.tsx` (extraído)

**Testes (novos)**
- `src/test/insights-behavioral-scope.test.ts`
- `src/test/categories-crud.test.ts`
- `src/test/category-select.test.tsx`
- `src/test/import-review-personal-category.test.ts`
- ampliar `src/test/documents-types.test.ts`, `src/test/facts.test.ts`

## Fora de escopo (não tocar)
- Ponte de Caixa e cards de patrimônio da Home (permanecem).
- Divisão do Rolê, WhatsApp, mensageria, admin.
- Categorização automática de ambíguos.
- Refatorações amplas em `assistant-ingest-document` (só o dicionário de `normalize.ts`).
