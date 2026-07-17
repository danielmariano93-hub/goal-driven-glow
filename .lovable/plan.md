# Plano consolidado — Home v2, Pulso Financeiro e semântica de conta × cartão

## 1) Diagnóstico do que já existe (reaproveitar)

- `transactions` já tem `payment_method` (`account|credit_card|...`), `credit_card_id`, `direction` (nullable), `competence_date`, `installments_*`. **A causa do bug** é que `computeAccountBalances` e `computeNetWorth` em `src/lib/engine/facts.ts` somam TODA `expense`/`income` no `account_id`, ignorando `payment_method`. Ou seja: despesas com `payment_method='credit_card'` estão sendo descontadas da conta, gerando o -R$230,18 e a frase "saiu da conta R$330,18".
- `credit_cards` existe com `total_limit`, `closing_day`, `due_day`. Não há cálculo de fatura.
- `emotional_checkins` já existe (mood smallint, trigger_label, notes, transaction_id opcional). Reaproveitar.
- `user_gamification` (total_xp, level, streaks) e `xp_events` existem. Reaproveitar para persistir score/histórico.
- Existe `ComecePorAqui`, `AssistantTipCard`, `QuickActions`, `ParaPagarResumo` na Home. Manter, apenas reorganizar.
- Copy "saiu da conta" vive em `src/lib/copy/strings.ts` e `src/lib/insights/fallbacks.ts` (e cópia server em `supabase/functions/_shared/insights/fallbacks.ts`).
- Agente extrator (`src/lib/agent/extract.ts` e cópia em `_shared/agent/extract.ts`) provavelmente escreve "crédito" como descrição — a corrigir na normalização.
- Ingestão de imagem (`assistant-ingest-document`) hoje assume conta implícita — precisa marcar itens como pendentes de método quando não houver evidência.

## 2) Arquivos, tabelas e funções alterados

### Engine puro (fonte única de cálculo)
- `src/lib/engine/facts.ts`:
  - Novos tipos: `PaymentMethod = 'account'|'credit_card'|'cash'|'pix'|'other'` (aceitar legado via fallback).
  - `computeAccountBalances`: considerar apenas `expense`/`income` com `payment_method='account'` **ou** legado (`payment_method` nulo/'account' + `account_id` presente + `credit_card_id` nulo). Tratamento seguro de `direction` nulo derivando de `type`.
  - Nova `computeCreditCardOutstanding(cards, txs)`: soma `expense` confirmadas com `credit_card_id` menos pagamentos de fatura (transactions `payment_method='account'` com `category` de "Fatura" ou marcadores `credit_card_payment_id` — na v1: somar apenas despesas com `credit_card_id` cuja `competence_date <= hoje` e sem baixa; documentar limitação).
  - `computeNetWorth` refatorado: `{ cash, invested, cardsOwed, otherDebts, net }` onde `net = cash + invested - cardsOwed - otherDebts`.
  - `computeMonthlyIncomeExpense` ganha filtro opcional por origem (conta vs cartão) para uso em cards separados.
  - Espelhar mudanças em `supabase/functions/_shared/engine/facts.ts`.

### Cópia server-side
- `supabase/functions/_shared/engine/facts.ts` — sincronizar.

### Novo módulo Pulso Financeiro
- `src/lib/pulse/rules.ts` (puro, determinístico, testado).
- `supabase/functions/_shared/pulse/rules.ts` (espelho).
- Nova edge function `pulse-compute` (idempotente, chamada do client no load da Home; grava snapshot).
- Migração:
  - Tabela `pulse_snapshots(user_id, computed_at, score int, band text, factors jsonb, next_action text, week_delta numeric)` com RLS `user_id = auth.uid()` + GRANTs padrão.
  - View/RPC `pulse_latest(user_id)`.

### Home
- `src/pages/Index.tsx` reorganizada em ordem:
  1. `PulseHero` (novo, topo, degradê premium).
  2. Card patrimônio com composição correta (conta / cartão / investido / dívidas) — sem afirmar "saiu da conta" para gastos no cartão.
  3. `AssistantTipCard` existente.
  4. `MissaoDaSemana` (novo, leve, do módulo Pulso).
  5. Resumo conta / cartão (fatura atual) / investimentos / dívidas.
  6. `ParaPagarResumo` existente.
  7. `EmotionalCheckinCard` (novo, base da Home).
- Novos componentes:
  - `src/components/home/PulseHero.tsx`
  - `src/components/home/PatrimonioCard.tsx`
  - `src/components/home/MissaoDaSemana.tsx`
  - `src/components/home/EmotionalCheckinCard.tsx`
  - `src/components/home/ResumoContas.tsx` (conta/cartão/invest/dívidas)

### Semântica "crédito" e ingestão
- `src/lib/agent/extract.ts` + `supabase/functions/_shared/agent/extract.ts`: normalizador que **nunca** grava `payment_method` como `description`. Se descrição estiver ausente e o texto for só o meio, marcar `needs_description=true` e (via tool) pedir finalidade.
- `supabase/functions/_shared/agent/tools.ts` `create_transaction_draft` e `draft_transaction_update`: já rejeitam meios como descrição; expandir lista (`crédito, débito, pix, cartão, dinheiro, transferência, ted, doc, boleto`).
- `supabase/functions/assistant-ingest-document/index.ts`: quando o extrator não determinar `payment_method` com confiança, marcar item `needs_payment_source=true` e não preencher `account_id`. UI de revisão (`ReviewSheet`) ganha seletor conta/cartão por item + botão "aplicar a todos".
- Backfill não-destrutivo: uma migração que **apenas** corrige linhas onde `description ILIKE 'crédito'|'cartão'|'pix'|'débito'` mudando `description` para `NULL` e mantendo `payment_method` (opt-in via flag; não aplicar em produção sem revisão do usuário — deixar SQL comentado no plan.md em vez de rodar automaticamente). **Sem alterações destrutivas automáticas** em transações existentes.

### Copy
- `src/lib/copy/strings.ts` e `insights/fallbacks.ts` (cliente + server): remover "saiu da conta" quando origem for cartão. Frases padrão por origem:
  - conta: "saiu da conta"
  - cartão: "foi para a fatura do cartão X"
  - patrimônio: "Patrimônio líquido: {X}. Em conta: {Y}. Na fatura: {Z}. Investido: {I}. Dívidas: {D}."

### Check-in emocional na Home
- Aproveitar tabela `emotional_checkins`.
- `EmotionalCheckinCard`: 6 humores (tranquilo, confiante, ansioso, impulsivo, frustrado, preocupado) mapeados para `mood` smallint 1–6, campo opcional "quer contar o que aconteceu?" (`notes`), toggle "relacionar a um gasto recente" (lista últimos 5 lançamentos do dia).
- Regra de consolidação diária: um único check-in por dia por usuário. Se já existir, exibir resumo + botão "Atualizar" (UPDATE por `date(occurred_at) = today`). Índice único parcial: `create unique index on emotional_checkins(user_id, (occurred_at::date))`.
- Após salvar, toast leve + link para `/app/emocoes`.

## 3) Ordem de implementação (uma rodada)

1. **Migração idempotente**:
   - `pulse_snapshots` (+ RLS + GRANTs + índice user_id,computed_at desc).
   - Índice único parcial em `emotional_checkins` por (user_id, data local).
   - RPC `credit_card_outstanding(user_id, card_id)` opcional (ou cálculo client).
2. **Engine puro**: `src/lib/engine/facts.ts` refatorado + espelho server + `src/lib/pulse/rules.ts` + espelho.
3. **Testes unitários**:
   - `src/test/facts.test.ts`: cenário exato R$100 abertura + R$198,67 expenses conta + R$131,51 expenses cartão → `cash = -98.67`, `cardsOwed = 131.51`, `net = -230.18`.
   - `src/test/pulse-rules.test.ts`: fatores, faixas, sem penalização por baixa renda, monotonicidade.
4. **Correções de copy** em `strings.ts` e `insights/fallbacks.ts` (client+server).
5. **Ingestão/agente**: normalização de descrição, campos `needs_payment_source`.
6. **UI Home**: novos componentes + reorganização de `Index.tsx`. Estados novo/carregando/erro/parcial.
7. **ReviewSheet**: seletor conta/cartão por item + em lote.
8. **Edge function `pulse-compute`** (server-side auditável) + hook client que faz upsert e lê `pulse_snapshots`.
9. **Typecheck + vitest + build** locais.
10. **Deploy** somente das edge functions alteradas (`pulse-compute`, `assistant-ingest-document`, `agent-chat`/`agent-run` se tools mudarem). Sem publicação de frontend.

## 4) Regras exatas do Pulso Financeiro (0–100, determinístico)

Score = soma ponderada de fatores comportamentais, normalizados 0–1, cada um com peso. Nunca depende de valor absoluto de renda/patrimônio; usa razões e séries próprias.

| Fator | Peso | Como medir (janela 30d salvo indicado) |
|---|---|---|
| Constância de registro | 12 | dias com ≥1 lançamento nos últimos 14 dias / 14 (cap 1). |
| Revisão de pendentes | 6 | 1 - (pending_confirmations abertas > 48h / max(pending,1)). |
| Aderência ao planejado | 12 | 1 - min(1, |gasto_real - gasto_planejado| / max(planejado,1)) usando `recurring_rules` + budgets. Sem plano ⇒ neutro 0.5. |
| Uso saudável do cartão | 10 | 1 - min(1, fatura_projetada / max(total_limit,1)); alvo ≤30%. |
| Fatura/contas em dia | 10 | pagamentos no prazo últimos 90d / total (sem dados ⇒ 0.5). |
| Reserva de emergência | 10 | min(1, caixa / (gasto_medio_mensal_conta * 3)). |
| Progresso de metas | 8 | média de pct das metas ativas (cap 1). Sem metas ⇒ 0.5. |
| Redução de dívida | 6 | 1 - outstanding_hoje / max(outstanding_30d_atras,1); floor 0. |
| Previsibilidade recorrências | 6 | recorrências ativas classificadas com valor definido / total. |
| Categorização | 6 | lançamentos 30d com `category_id` / total. |
| Consistência emocional | 6 | dias com check-in nos últimos 14 / 14 (cap 1, NÃO conta múltiplos no mesmo dia). |
| Contexto emocional em gastos | 4 | expenses 30d com `emotional_trigger` ou `emotional_checkins.transaction_id` / total. |
| Evolução após orientações | 4 | delta positivo do score 7d vs 30d (bônus small). |

- Score final: `round(sum(peso_i * fator_i))` cap 0–100.
- Faixas: 0–24 Começando · 25–49 Organizando · 50–74 Evoluindo · 75–100 No controle.
- `week_delta = score_hoje - score_7d_atras`.
- `next_action`: escolher o fator com maior `peso * (1 - fator_i)` e mapear para uma ação humana (dicionário fixo em `pulse/rules.ts`).
- **Anti-gaming**: consistência emocional usa `distinct date(occurred_at)`; constância de registro descarta lançamentos duplicados por `import_source_id`/(descrição+valor+data) no mesmo minuto.
- **Sem penalidade por não abrir o app** — só medimos janelas relativas ao histórico do próprio usuário.
- **Usuário novo (<7 dias ou <5 lançamentos)**: exibir estado "Começando" com score neutro 40 e mensagem "vamos entender seus hábitos primeiro"; não persistir score falso — snapshot marca `factors.state = 'insufficient_data'`.

## 5) Critérios de aceite e testes

**Cenário obrigatório** (unit test):
- Conta A abertura R$100; 3 expenses `payment_method='account'` somando R$198,67; 2 expenses `payment_method='credit_card'` somando R$131,51.
- `computeAccountBalances(A)` = `-98.67`.
- `computeCreditCardOutstanding` = `131.51`.
- `computeNetWorth.net` = `-230.18`; `.cash = -98.67`; `.cardsOwed = 131.51`.
- Nenhum texto no app diz "saiu da conta R$330,18" nem "saiu da conta R$131,51".

**Outros aceites**:
- Home renderiza Pulso no topo, check-in emocional no fim, sem overflow em 320–430px.
- Lançamento com `description='crédito'` legado é exibido como "(sem descrição)" e o agente, ao editá-lo, propõe finalidade real.
- Novo lançamento pelo agente ou por imagem NUNCA grava meio como descrição.
- ReviewSheet permite escolher conta ou cartão por item; itens sem evidência ficam `needs_payment_source` e bloqueiam confirm em lote sem escolha.
- Check-in duplicado no mesmo dia atualiza o registro existente (não cria segundo).
- Pulso não muda ao registrar 20 check-ins no mesmo dia (anti-gaming).
- Nenhum stack trace, SQL ou nome de função aparece em toasts.
- Testes: vitest verde (cobrindo cenário-âncora, pulse-rules, semântica de descrição, dedupe de check-in), tsgo verde, build verde.
- Migração `pulse_snapshots` e índice único de check-in aplicados; RLS testada.

## 6) Riscos e rollback

- **Risco**: dados legados sem `payment_method` correto → engine usa fallback (`account_id` presente + `credit_card_id` nulo ⇒ trata como `account`). Sem alteração destrutiva.
- **Risco**: recalcular fatura de cartão sem tabela de pagamentos de fatura pode superestimar. Mitigação: exibir "Fatura em aberto (estimativa)" e documentar limitação; peso do fator "cartão saudável" usa `outstanding/limit`, robusto a essa aproximação.
- **Rollback**: cada mudança é aditiva (novos componentes, novos campos derivados, nova tabela). Reverter = ocultar novos componentes na Home e reverter refator de `computeNetWorth` para versão anterior via git; migração `pulse_snapshots` é DROPável sem afetar dados existentes; índice único de check-in é DROPável.

## 7) Confirmação

**Nada foi implementado nesta etapa.** Nenhum arquivo foi editado, nenhuma migração aplicada, nenhuma edge function deployada. Este é apenas o plano consolidado aguardando aprovação para execução em uma única rodada.
