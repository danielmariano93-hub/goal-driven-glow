# Ajustes finais de UX/mobile + Dicas + Pulso + Meta vinculada a investimento

Entrega única, sem tocar em regras de negócio nem no Agent Core.

## 1. Vínculo Investimento ↔ Meta (bug reportado)

Hoje `investments.goal_id` existe mas o valor investido **não conta** no progresso da meta — `computeGoalProgress` só soma `goal_contributions`. Correção mínima e correta:

- `computeGoalProgress(goal, contributions, investments?)` passa a somar também `sum(investments.current_value where goal_id = goal.id)`.
- Atualizar chamadas: `Metas.tsx`, `facts.ts` (linha 476), `PatrimonioCard`, `usePulse` facts server e client, e qualquer local que use `computeGoalProgress`.
- Em `Metas.tsx`, quando a meta tem investimento vinculado, mostrar linha "Investido vinculado: R$ X" abaixo da barra, para o usuário entender de onde vem o progresso.
- Invalidar `["goals"]` e `["contributions"]` sempre que salvar/editar investimento (via `invalidateFinancialQueries`, que já cobre ambos).

Sem migration. Sem mudança de schema.

## 2. Dicas inteligentes realmente úteis

Manter a Edge Function `insights-generate` como fonte primária, e reforçar o **fallback local** (`src/lib/insights/fallbacks.ts` e mirror em `supabase/functions/_shared/insights/fallbacks.ts`) para nunca repetir a última dica e cobrir mais cenários acionáveis:

- Anti-repetição: guardar `lastInsightKey` em `sessionStorage` e, no `pickFallback`, pular o primeiro match se for igual ao último (fallback para o próximo cenário elegível).
- Novos cenários (ordem de prioridade): lançamento sem categoria → gasto acima da média em uma categoria nos últimos 30d → aumento >20% em uma categoria vs mês anterior → aporte pendente em meta com data próxima → cartão >70% do limite → sequência de 3+ dias sem registrar (queda de constância) → celebração quando pulso subir vs semana passada → mensagem positiva quando 7 dias seguidos com registro.
- Todas as mensagens em pt-BR, tom acolhedor, com CTA que abre a tela relevante (`/app/lancamentos?filter=uncategorized`, `/app/relatorios?cat=...`, `/app/metas`, `/app/cartoes`).
- Botão "Nova dica" já existe: garantir que ele invalide `["assistant-tip"]` e force a geração ignorando cache do servidor (já faz `force: true`), e que rotacione entre cenários elegíveis quando houver mais de um.

## 3. Pulso Financeiro alimentado corretamente

Auditar `pulse-compute` (Edge) e `usePulse`:

- Confirmar que todos os fatores de `PulseInput` estão sendo populados a partir de dados reais (constância, categorização, planejamento, cartão, pagamentos em dia, reserva, metas, dívidas, recorrências, emocional). Onde faltar, alimentar; onde for `neutralIfMissing`, manter neutro.
- Incluir `goalsProgressPct` com a nova soma (contribuições + investimentos vinculados).
- Invalidar `["pulse"]` em `invalidateFinancialQueries` (já invalida) — garantir chamada após criar/editar investimento, aporte, meta, cartão, recorrência.
- Exibir na `PulseHero`, quando `state === "insufficient_data"`, uma mensagem clara "Registre por alguns dias para o Pulso ficar preciso" com CTA para Lançamentos.

Sem alterar a fórmula, apenas garantir alimentação e invalidação.

## 4. Responsividade e mobile (varredura completa)

Padrão aplicado a todas as páginas em `src/pages/*` e componentes de home/admin:

- **Zoom automático iOS**: já forçado `font-size: 16px` em inputs globais (index.css). Verificar `<select>`, `<textarea>` e componentes shadcn com `text-sm` — subir para `text-base` no mobile via `md:text-sm`.
- **Overflow horizontal**: adicionar `overflow-x-hidden` no `<main>` do `AppLayout`; auditar tabelas (Lancamentos, Relatorios, Admin/DataTable) para envolver em `<div className="overflow-x-auto">` e usar `min-w-0` nos flex children que hoje causam estouro.
- **Teclado deslocando conteúdo**: usar `env(safe-area-inset-bottom)` no `BottomTabBar` e nos FABs; garantir `pb-[calc(env(safe-area-inset-bottom)+4rem)]` no container mobile.
- **Botões pequenos**: primary buttons/tap targets no mobile passam a `min-h-11 min-w-11`; `size="icon"` do shadcn recebe `min-h-11 min-w-11` quando for ação principal.
- **Campos cortados**: revisar `Onboarding`, `LancamentoDetalhe`, `Investimentos` (form), `Metas`, `DivisaoDoRoleNova`, `Perfil`, `WhatsApp` — inputs em `w-full`, labels não truncadas, `flex-wrap` em grupos de botões.
- **Safe area Safari/iPhone**: `viewport-fit=cover` no `index.html` (verificar) e `pt-safe`/`pb-safe` no layout.
- **Breakpoints**: sanity check em 375 / 414 / 768 / 1024 / 1440 rodando cada tela. Ajustar `grid-cols-*` para começar em 1 coluna no mobile e escalar.
- **Componentes desalinhados**: padronizar espaçamento com `space-y-4` em conteúdo de página e `gap-3` em listas de cards.

Nenhuma nova biblioteca; usar tokens Tailwind e utilitários shadcn existentes.

## Detalhes técnicos

**Arquivos modificados** (frontend somente, sem migrations, sem Edge Functions novas):

- `src/lib/engine/facts.ts` — assinatura `computeGoalProgress` aceita `investments?`.
- `src/pages/Metas.tsx`, `src/components/home/PatrimonioCard.tsx`, `src/lib/pulse/*` (client), `src/lib/insights/*` — passar investimentos.
- `src/pages/Investimentos.tsx` — após salvar, `invalidateFinancialQueries(qc)`.
- `src/lib/insights/fallbacks.ts` (+ mirror em `supabase/functions/_shared/insights/fallbacks.ts` para deploy futuro, sem redeploy agora) — novos cenários + anti-repetição.
- `src/components/home/AssistantTipCard.tsx` — sessionStorage de `lastInsightKey` e rotação.
- `src/components/home/PulseHero.tsx` — CTA no estado `insufficient_data`.
- `src/components/AppLayout.tsx`, `src/components/BottomTabBar.tsx`, `src/index.css`, `index.html` — safe-area, overflow-x-hidden, viewport-fit.
- Varredura de páginas para padronizar tap targets e grids responsivos.

**Testes**:

- Ajustar `src/test/assistant-tip-behavioral.test.ts` para o novo comportamento de rotação.
- Novo teste em `computeGoalProgress` cobrindo soma de investimentos vinculados.
- Rodar suíte completa (`bunx vitest run`) e `tsgo`.

**Fora de escopo**: Agent Core, admin, regras financeiras, migrations, novas Edge Functions.
