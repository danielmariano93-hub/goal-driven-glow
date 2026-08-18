# Metas: Plano do Nino por categoria, alerta de teto ultrapassado e card clicável

Três correções na experiência de Metas, todas com números vindos do ledger confirmado (nada estimado por IA).

## 1. Plano do Nino nas metas por categoria

Hoje o "Plano do Nino" existe só nas metas financeiras (motor `goal_strategy.v1`). Metas por categoria são avaliadas (`evaluateCategoryGoal`) mas não recebem plano.

Novo motor determinístico `category_goal_strategy.v1`, irmão do de metas financeiras, que a partir da avaliação já existente entrega:

- Diagnóstico honesto: quanto já gastou, quanto sobra do teto, projeção de fechamento do período e quanto isso estoura (ou sobra).
- Quanto por dia e por semana dá para gastar daqui até o fim do período sem furar o teto.
- Onde está o gasto: principais estabelecimentos/lançamentos da categoria no período, em ordem de valor, para o corte ser concreto e não difuso.
- Passos: envelope da categoria, revisão dos recorrentes que caem nela, e o corte específico necessário por dia.
- Alternativas honestas quando o teto já foi estourado: segurar o resto do período, revisar o teto para o próximo ciclo, ou aceitar o excesso e compensar em outra categoria.

Aparece como card "Plano do Nino" dentro de cada meta por categoria e também na tela de detalhe (item 3). O mesmo motor é exposto ao assessor (app e WhatsApp) pela rota determinística de meta já existente, para quem perguntar "como eu seguro o gasto de mercado".

## 2. Alerta e projeção quando o teto é ultrapassado

Hoje nenhum detector olha metas por categoria — por isso o teto estourado não gerou notificação nem mensagem.

- Novo detector no motor de diagnóstico do Nino para metas por categoria ativas, com três gatilhos: teto ultrapassado, limite atingido (100%) e risco de estouro pela projeção do ritmo atual antes do fim do período.
- Cada detecção vira situação com evidência (valor gasto, teto, projeção, dias restantes) e ação "Ver a meta", o que automaticamente a habilita nos canais já existentes: item de inteligência na Home, notificação no app e candidatura a mensagem proativa no WhatsApp, respeitando as regras de frequência e a Care Quota já configuradas no painel admin.
- Deduplicação por meta e por ciclo: no máximo um alerta de estouro por meta por período, e um de risco por semana, para não virar ruído.
- No card da meta passa a aparecer sempre a projeção até o fim do período ("no ritmo atual você fecha em R$ X, R$ Y acima do teto") e, quando ultrapassado, o excesso atual em destaque.

## 3. Card de meta inteiramente clicável, com tela de detalhe

- Card de meta por categoria e card de meta financeira passam a ser clicáveis por inteiro, abrindo a tela de detalhe. Os botões de ação continuam funcionando sem disparar a navegação.
- Novas telas de detalhe:
  - Meta por categoria: cabeçalho com status, barra de uso, gasto x teto, projeção do período, Plano do Nino completo, lista dos lançamentos considerados no período e as ações (editar, pausar/reativar, excluir).
  - Meta financeira: progresso, aportes, investimentos vinculados, Plano do Nino completo e ações.
- "Editar" deixa de ser o único caminho para ver a meta: continua disponível dentro do detalhe e no card.

## Detalhes técnicos

- Motor: `src/lib/engine/categoryGoalStrategy.ts` (`category_goal_strategy.v1`), consumindo `CategoryGoalEvaluation` e as transações já carregadas; espelhado para `supabase/functions/_shared/finance-core/` via `scripts/sync-finance-core.mjs`, mantendo App e Edge idênticos.
- Entradas do plano: extensão de `src/lib/goals/strategyInputs.ts` para agregar por estabelecimento/descrição dentro da categoria e período, usando `effectiveCategoryId` e `behavioralMetricAmount` (estornos abatendo, sem dupla contagem).
- UI: novo `CategoryGoalStrategyCard.tsx`; `CategoryGoalCard.tsx` recebe projeção e navegação; novas rotas `/app/metas/categoria/:id` e `/app/metas/:id` registradas em `src/App.tsx`.
- Alertas: nova seção de detecção em `nino_evaluate_financial_situations` usando `nino_diag_put_situation` com `situation_type='goal_feasibility'` e chave `category_goal:<id>:<ciclo>`; notificação em `public.notifications` com `dedup_key` por meta e ciclo, `action_url` apontando para a tela de detalhe.
- Ferramenta do assessor: `get_goal_strategy` estendida para aceitar meta por categoria, retornando o envelope do novo motor.
- Testes: casos em `src/test/category-goals-metrics.test.ts` para projeção, estouro e dedupe de alerta.
