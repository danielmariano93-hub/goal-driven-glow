
# Plano: Corrigir dicas do assistente (user_insights)

## Causa raiz
1. `insights-generate` consulta `transactions.kind` — a coluna real é `transactions.type`. A agregação silenciosamente retorna zero fatos.
2. O parser aceita a resposta da IA mesmo com `title`/`body` vazios. Como `insight` deixa de ser `null`, o fallback determinístico nunca roda.
3. O cache reaproveita qualquer insight ativo recente sem validar conteúdo, então o card vazio persiste por 24h.
4. Resultado: registro `c919f6e9…` gravado com `title=''`, `body=''`, e a Home renderiza um card sem texto (ou some, dependendo do fallback do componente).

## Arquivos alterados
- `supabase/functions/insights-generate/index.ts` — função principal.
- `supabase/functions/_shared/insights/fallbacks.ts` — novo, fallbacks determinísticos por cenário + validação (Zod).
- `src/components/home/AssistantTipCard.tsx` — nunca renderizar card sem `title`/`body`; skeleton; regeneração controlada.
- `src/lib/copy/strings.ts` — copies de fallback e estados.
- Nova migration `supabase/migrations/<ts>_fix_empty_user_insights.sql`.
- Testes: `src/test/insights-fallbacks.test.ts` e `supabase/functions/insights-generate/index.test.ts` (Deno-compat via vitest node runner com mock de fetch).

## 1. Edge Function `insights-generate`
- Trocar `kind` → `type` na query de `transactions`. Somar `income`/`expense` corretamente.
- Cache: reaproveitar somente quando `status='active'`, `expires_at > now()`, `generated_at > now()-6h`, `trim(title) <> ''` e `trim(body) <> ''`. Caso contrário, marcar registros ativos vazios do usuário como `status='invalid'` antes de gerar novo.
- Validar resposta da IA com Zod:
  ```
  z.object({
    type: z.enum(["habit","alert","celebration","onboarding","opportunity"]).optional(),
    title: z.string().transform(s=>s.trim()).pipe(z.string().min(4).max(80)),
    body:  z.string().transform(s=>s.trim()).pipe(z.string().min(10).max(240)),
    cta_label: z.string().trim().min(2).max(40).optional(),
    cta_route: z.string().regex(/^\/app\//).optional(),
  })
  ```
  Rejeitar `"null"`, `"undefined"`, apenas whitespace, e strings compostas só de pontuação.
- Timeout de 8s no fetch do gateway; qualquer falha (status ≠ 2xx, JSON inválido, schema inválido, timeout) → fallback determinístico com `fallback_reason` logado (sanitizado).
- Antes de `insert`, revalidar via mesmo schema (defensivo). Nunca gravar vazio.
- Fatos ampliados (para escolher fallback contextual): `total_tx_ever`, `income_month`, `expense_month`, `balance_month`, `active_goals`, `goal_names`, `has_credit_card`, `upcoming_recurring_7d`, `top_expense_category`.
- Log estruturado: `{ generated|cached|fallback, fallback_reason?, model, latency_ms, invalid_response? }`. Sem PII.
- Rate limit atual (6h) mantido. Adicionar param opcional `{ force: true }` que ignora cache mas ainda respeita 1 geração / 60s por usuário (guard simples via `generated_at`).

## 2. Fallbacks determinísticos (`_shared/insights/fallbacks.ts`)
Função pura `pickFallback(facts) → InsightPayload`. Ordem de decisão:
1. `total_tx_ever === 0` → onboarding: "Bora começar juntos" / CTA `/app/lancamentos`.
2. `total_tx_ever < 5` → habit: incentivar 3 dias de registro.
3. `expense_month > income_month && income_month > 0` → alert: mostrar diferença real, CTA `/app/relatorios`.
4. `income_month > expense_month && balance_month > 0` → celebration com valor real, CTA `/app/metas` se houver meta, senão `/app/investimentos`.
5. `active_goals > 0` → opportunity focada no nome da meta.
6. `upcoming_recurring_7d > 0` → alert de compromissos próximos, CTA `/app/recorrencias`.
7. `has_credit_card` → habit sobre acompanhar fatura, CTA `/app/cartoes`.
8. default → habit genérica útil, CTA `/app/lancamentos`.
Todos com `title/body/cta_label/cta_route` válidos. `model="fallback"`.

## 3. Migration de saneamento
```sql
UPDATE public.user_insights
SET status = 'invalid', updated_at = now()
WHERE status = 'active'
  AND (title IS NULL OR btrim(title) = '' OR body IS NULL OR btrim(body) = '');

ALTER TABLE public.user_insights
  ADD CONSTRAINT user_insights_title_nonempty CHECK (btrim(title) <> ''),
  ADD CONSTRAINT user_insights_body_nonempty  CHECK (btrim(body)  <> '');
```
Sem inserir dica para usuário específico. A próxima chamada da função gera normalmente (o guard de cache passa a ignorar `status='invalid'`).

## 4. Home / `AssistantTipCard`
- Query só considera `status='active'` **e** `title`/`body` não vazios (filtro extra client-side além do server).
- Estados: `loading` (skeleton com shimmer, mesma altura do card, evita layout shift), `data`, `generating` (mostra dica atual se existir; senão skeleton), `error/no-content` → renderizar fallback local (import estático de `pickFallback` com facts mínimos derivados dos hooks já existentes) + botão "Gerar nova dica" (dispara `invoke('insights-generate',{ body:{ force:true }})`, throttle 60s local).
- Nunca retornar `null` silenciosamente. Nunca renderizar card com título/corpo vazios.
- Feedback 👍/👎 preservado; após feedback "não gostei", oferecer regenerar.

## 5. Disparo e ciclo de vida
- Geração **sob demanda** (nesta fase, sem cron):
  - primeira visita à Home quando não há insight válido;
  - após criar transação relevante: invalidar query `["assistant-tip"]` (invalidate-only, geração acontece na próxima render se cache expirou);
  - botão manual "Gerar nova dica".
- Expiração: 24h; dedupe: hash SHA-1 curto de `evidence` gravado em `evidence.hash`. Se hash igual ao último ativo do usuário e < 24h, reutilizar. Muda fatos → gera nova.
- Sem loops: guard de 60s + rate limit 6h já existente.

## 6. IA / modelo
- Confirmar disponibilidade do modelo no gateway antes do deploy. Modelo padrão: `google/gemini-2.5-flash` (o atual `gemini-3.5-flash` pode estar indisponível — verificar e ajustar; se ambos falharem, `google/gemini-2.5-flash-lite`). Fallback determinístico cobre indisponibilidade.
- Prompt com contrato JSON explícito e exemplos negativos (proibido inventar valores, proibido conselho de investimento regulado).

## 7. Testes (bloqueadores)
`src/test/insights-fallbacks.test.ts`:
- cada cenário de `pickFallback` retorna payload válido no schema;
- schema rejeita vazio, whitespace, "null", "undefined", rota fora de `/app/`;
- schema aceita payload íntegro.

`supabase/functions/insights-generate/index.test.ts` (executado via vitest com `fetch` mockado e client Supabase mockado):
- JSON completo válido → insere;
- JSON com title/body vazios → cai em fallback, insere fallback;
- whitespace/`"null"` → fallback;
- JSON inválido / status 500 / timeout → fallback;
- cache com insight válido recente → reaproveita, não chama gateway;
- cache com insight vazio ativo → ignora, marca invalid e gera;
- query de transações usa `type` (assert no mock);
- nenhum insert com título/corpo vazios (assert no mock);
- RLS: isolamento user A/B via mock de `auth.getUser`.

Rodar suíte completa + `tsgo` + `vite build`.

## 8. Sequência de execução (uma rodada)
1. Migration de saneamento + CHECK constraints.
2. Criar `_shared/insights/fallbacks.ts` + schema Zod.
3. Reescrever `insights-generate/index.ts` (query, cache, validação, fallback, logs, force).
4. Atualizar `AssistantTipCard.tsx` + copies.
5. Adicionar testes.
6. `npm test`, typecheck, build.
7. Deploy apenas de `insights-generate`. Sem tocar em WAHA/webhook/frontend em produção.

## Critérios de aceite
- Registro `c919f6e9…` fica `status='invalid'`.
- Nova chamada gera insight com `title` e `body` não vazios (IA ou fallback).
- Home sempre exibe uma dica útil (nunca card vazio, nunca some silenciosamente).
- Query de transações usa `type`.
- Todos os testes passam; build limpo.
- Logs mostram `fallback_reason` quando aplicável, sem PII.

## Riscos
- CHECK constraint quebra inserts legados: mitigado por UPDATE prévio na mesma migration.
- Modelo indisponível no gateway: coberto por fallback.
- Regeneração excessiva pelo botão: throttle 60s server + client.

## Fora de escopo
WAHA, webhook, sessão, agente transacional, cartões, orquestrador, prompts do agente, notificações, gamificação.
