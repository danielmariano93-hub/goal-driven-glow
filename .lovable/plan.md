
# Dicas inteligentes de verdade — Home + Assessor + WhatsApp

Objetivo: acabar com a sensação de "duas dicas repetidas" na Home, tornar as dicas realmente comportamentais (baseadas em padrões do usuário) e garantir que Assessor (app) e WhatsApp conheçam as mesmas dicas/highlights para responder quando o usuário perguntar diretamente.

## Diagnóstico do que trava hoje

1. `AssistantTipCard` só pega **a última dica ativa** (`limit(5)` mas usa `list[0]`). Como `insights-generate` só cria uma nova dica quando: (a) cache de 6h expira, (b) `force=true`, ou (c) há transação sem categoria — o usuário vê a mesma dica por horas mesmo depois de "já ter interagido".
2. Feedback (👍/👎) não desativa a dica, só grava `feedback`. Ela continua sendo a "top 1" e volta a aparecer.
3. Não existe conceito de **"vista/dispensada" por sessão**; o `sessionStorage` só atua no fallback local, não no que vem do servidor.
4. Fallback do servidor tem só ~8 candidatos e não considera padrões comportamentais (categoria que cresceu vs mês anterior, dia da semana com mais gasto, recorrência de merchant, streak de dias sem registrar etc). Vira o mesmo "Fatura sob olho" toda hora.
5. Assessor (`agent-chat`) e WhatsApp (`whatsapp-webhook`) não têm ferramenta para ler `user_insights`/highlights; se o usuário perguntar "qual sua dica pra mim hoje?" o agente responde no vácuo.

## Escopo (o que MUDA)

### A. Home — rotação real e "você viu todas por hoje"
- `AssistantTipCard`
  - Carregar **até 5 dicas ativas** (`status=active`, não expiradas) e um índice controlado por `useState` para navegar entre elas (setinhas ‹ ›) além do "Nova dica".
  - Filtrar do array as que já receberam `feedback` OU cujo `id` esteja em `sessionStorage['noc:seen-tips']` (set por sessão).
  - Ao clicar 👍/👎 → além de gravar feedback, marcar `status='dismissed'` para 👎 e adicionar id ao "seen" para 👍, invalidar query, avançar índice.
  - Quando a lista filtrada ficar vazia: mostrar estado *friendly* — "Por hoje é só 🌱 Você já viu todas as ideias que preparei. Volto amanhã com novidades — ou toque em Nova dica pra eu tentar algo diferente agora." — com botão único "Nova dica" que dispara `force=true`.
  - "Nova dica" com `force=true` já existe; garantir que insere sempre uma **nova linha** (server já dismissiona a anterior quando `force` — manter).

### B. `insights-generate` — mais candidatos e mais comportamental
- Ampliar `InsightFacts` e `pickFallback` (client + server, ambos precisam continuar espelhados) com sinais reais:
  - `top_expense_category` + `top_expense_category_pct` (% do total do mês).
  - `category_growth`: top categoria que cresceu > 30% vs mês anterior.
  - `weekday_hotspot`: dia da semana que concentra mais gasto (últimos 30d).
  - `merchant_repeat`: merchant recorrente detectado nos últimos 30 dias com N ocorrências.
  - `days_without_entry`: streak sem registrar transação.
  - `goal_pace`: % de avanço da meta vs tempo restante.
- Novos candidatos de fallback usando esses sinais, com CTAs específicos (`/app/relatorios?cat=...`, `/app/metas/:id`).
- No prompt da IA: passar esses sinais e pedir para **variar o ângulo** (comparativo vs mês anterior, projeção, hábito) e **não repetir** títulos das últimas 5 dicas do usuário (passar `recent_titles` no user message).
- Ao gerar (com ou sem `force`), inserir sempre uma **nova** dica em vez de reaproveitar cache quando `recent_titles` estiver saturado (>3 dicas ativas ainda visíveis).

### C. Assessor + WhatsApp — dicas viram ferramenta do agente
- Nova tool compartilhada em `supabase/functions/_shared/agent/tools.ts`:
  - `get_daily_insights(ctx)` → lê últimas dicas ativas do `user_insights` (filtra vencidas), devolve `[{title, body, cta_route, type, evidence_summary}]`.
  - `get_spending_highlights(ctx)` → reusa a mesma agregação usada pelo `insights-generate` (extrair para `_shared/insights/facts.ts` importável por edge e por tool) e devolve top categorias, crescimento, hotspot, streak.
- Registrar as duas em `openAIToolDefinitions()` e no roteamento de intents em `IntentRouter.ts` (intents `pedir_dica`, `resumo_do_mes`, `highlights`).
- Ampliar system prompt do agente (`_shared/agent/prompt.ts`) com uma linha: "Quando o usuário pedir dica, resumo ou insights, use `get_daily_insights`/`get_spending_highlights` antes de responder. Nunca invente números."
- Fallback determinístico (`DeterministicFallback.ts`): mapear frases "me dá uma dica", "qual seu highlight", "resumo do mês" para chamar essas tools direto quando IA off.

### D. Testes e observabilidade
- Novos testes:
  - `assistant-tip-rotation.test.ts` — 3 dicas ativas, avança índice, feedback dismissiona, exaustão mostra estado friendly.
  - `insights-facts-behavioral.test.ts` — sinais novos (`top_expense_category_pct`, `weekday_hotspot`, `days_without_entry`) calculam corretamente com fixture.
  - `agent-tool-insights.test.ts` — `get_daily_insights` e `get_spending_highlights` retornam formato esperado e respeitam `user_id`.
- Log `event: "rotation_exhausted"` no cliente (via `console.info`) e `event: "insight_via_tool"` nas tools do agente.

## Fora do escopo
- Não mexer em Pulso, KPIs, contabilidade, categorias, metas.
- Sem nova migration (usa colunas existentes de `user_insights`).
- Sem novo modelo de IA — segue `google/gemini-2.5-flash` no `insights-generate`.

## Detalhes técnicos

**Arquivos que mudam**
- `src/components/home/AssistantTipCard.tsx` — rotação + estado exausto.
- `src/lib/insights/fallbacks.ts` + `supabase/functions/_shared/insights/fallbacks.ts` — novos candidatos comportamentais (manter espelhados).
- `supabase/functions/_shared/insights/facts.ts` (novo) — cálculo compartilhado dos sinais comportamentais; consumido por `insights-generate` e pelas tools do agente.
- `supabase/functions/insights-generate/index.ts` — usa novos sinais, passa `recent_titles` no prompt, sempre insere nova linha quando `force` ou quando não há dica "não vista" recente.
- `supabase/functions/_shared/agent/tools.ts` — 2 novas tools + JSON schema.
- `supabase/functions/_shared/agent/prompt.ts` — instrução curta sobre novas tools.
- `supabase/functions/_shared/agent/core/IntentRouter.ts` + `DeterministicFallback.ts` — roteamento das novas intents.
- `src/test/*` — novos arquivos de teste; ajustar `insights-fallbacks.test.ts` para novos candidatos.

**Deploy no final**
- Edge Functions: `insights-generate`, `agent-chat`, `whatsapp-webhook`.
- Publicar frontend.

## Critérios de aceite
1. Na Home, dá para navegar entre pelo menos 3 dicas diferentes sem repetir; após 👍/👎 a dica some da rotação.
2. Quando não sobra dica nova, aparece a mensagem "Por hoje é só 🌱 …" com botão Nova dica funcional.
3. Ao perguntar no Assessor "me dá uma dica pra hoje" e "qual foi meu maior gasto do mês", o agente responde com dados reais (via nova tool), sem inventar valores.
4. Mesma pergunta no WhatsApp devolve a mesma dica/highlight.
5. `npm test` verde, build sem erros, deploys confirmados.
