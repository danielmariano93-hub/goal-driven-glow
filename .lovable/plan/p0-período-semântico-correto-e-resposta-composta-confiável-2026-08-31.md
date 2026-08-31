# P0: período semântico correto e resposta composta confiável

## Diagnóstico confirmado no run real

1. **O caminho novo foi executado.** Os runs das 11:16 e 11:17 chamaram `assess_goal_performance`, preservaram as quatro categorias e foram bloqueados por `goal_current_consistent`. Portanto, não houve retorno ao motor antigo nem número inventado.
2. **A causa principal está antes do motor financeiro:** `ConversationOrchestrator` resolve o período lendo a mensagem inteira. Como `resolvePeriodPt` encontra primeiro “mesmo período do mês passado”, ele transforma julho em período atual, mesmo com o pedido explícito de “mês atual”. O plano recebido em produção foi julho/2026, enquanto as quatro metas ativas são de agosto/2026.
3. **O gate funcionou corretamente:** `goal.actual` foi calculado no ciclo real das metas de agosto, mas `historical.current` foi calculado no período incorreto de julho. O gate detectou a divergência e impediu uma nova resposta falsa.
4. **A observabilidade também está enganosa:** `agent_runs.context_layers.analytical_path.comparison_period` gravou 31/05–30/06 porque usa a janela genérica do `TurnPlan`, não o período comparativo efetivamente planejado pelo fluxo composto. Em falhas, o snapshot e os gates completos ficam nulos, escondendo os valores que causaram o bloqueio.
5. **A resposta de falha é inadequada:** “me chame em alguns minutos” sugere um problema transitório, mas as duas tentativas repetiram deterministicamente o mesmo erro. O usuário não deve ser orientado a repetir uma chamada que continuará falhando.
6. **As fórmulas financeiras não são a causa neste incidente:** meta e histórico usam as mesmas regras de competência, categoria, estorno, supersede e movimento comportamental. A divergência nasceu porque foram alimentados com janelas diferentes.

## Correção definitiva

### 1. Resolver período por papel semântico, não pela primeira expressão encontrada

Criar um contrato de períodos da pergunta com papéis explícitos:

```text
current_period      = período sobre o qual o usuário pergunta
comparison_period   = período usado como referência
comparison_basis    = calendar_previous_month | preceding_window
source_span          = trecho que originou cada período
```

Para a pergunta do incidente:

```text
current_period    = 01/08/2026 a 31/08/2026
comparison_period = 01/07/2026 a 31/07/2026
comparison_basis  = calendar_previous_month
```

Regras:
- “mês atual/este mês” sempre define o período principal.
- “mesmo período do mês passado/anterior” define apenas a comparação quando já existe um período principal na frase.
- Uma expressão comparativa nunca pode sobrescrever o período principal.
- Se só existir “mês passado”, sem marcador comparativo, ele pode ser o período principal.
- Períodos herdados só entram quando o turno atual não definiu explicitamente o mesmo papel.
- O planner receberá o contrato inteiro, em vez de um único `turn_period` ambíguo.

### 2. Remover a dupla resolução entre orquestrador e planner

Hoje `ConversationOrchestrator` e `AnalyticalQueryPlanner` reinterpretam a mesma frase e o planner dá precedência ao período já resolvido, mesmo quando ele está semanticamente errado.

- Tornar o resolvedor por papéis a única fonte de verdade.
- `ConversationOrchestrator`, planner, ferramenta e telemetria consumirão exatamente o mesmo objeto.
- Remover qualquer recomputação implícita de comparação dentro da ferramenta quando o plano já forneceu os dois períodos.
- Validar antes da execução que período atual e comparativo não se sobrepõem indevidamente e que a base declarada produz exatamente o recorte esperado.

### 3. Alinhar o período de meta e o período da análise de forma explícita

O motor deixará de misturar silenciosamente o ciclo próprio da meta com o recorte analítico:

- Para overview de **metas do mês atual**, o período atual do plano deve coincidir com o ciclo aplicável de cada meta.
- `goal.actual` e `historical.current` serão derivados da mesma soma canônica e da mesma janela quando a pergunta cruza atingimento e comparação.
- O assessment passará a expor `goal_period` e `analysis_period` por categoria.
- Metas com ciclos realmente diferentes (`custom`, `next_30_days` ou futuros ciclos heterogêneos) não serão forçadas a parecer comparáveis: o contrato marcará incompatibilidade de período e o renderer explicará a limitação por categoria, sem derrubar toda a resposta nem comparar janelas distintas.
- A carga de lançamentos cobrirá a união dos períodos de análise, comparação e ciclos de meta, mantendo o lookback necessário para competência de cartão.

### 4. Fortalecer gates sem transformar incompatibilidade legítima em pane global

Manter os gates aritméticos atuais e substituir a igualdade cega por dois controles:

1. `period_role_consistent`: confirma que o período principal veio de “mês atual” e a comparação veio de “mês passado”.
2. `goal_analysis_period_consistent`: exige `goal.actual = historical.current` somente quando `goal_period = analysis_period`; se os ciclos forem diferentes, exige sinalização estrutural de não comparabilidade.

Também validar:
- plano, argumentos da ferramenta, assessment, evidence graph e texto usam os mesmos períodos;
- a conclusão agregada usa apenas o agregado das quatro categorias;
- nenhuma resposta é enviada quando os papéis dos períodos são ambíguos ou contraditórios;
- a falha de uma categoria incompatível não apaga resultados válidos das demais.

### 5. Corrigir a falha honesta e a observabilidade

- Trocar a mensagem fixa por motivo determinístico e útil. Para conflito interno, informar que a leitura foi bloqueada por períodos incompatíveis e que nenhum número foi enviado; nunca prometer que repetir em minutos resolverá.
- Persistir também nos runs bloqueados:
  - períodos detectados e seus trechos de origem;
  - plano efetivo e argumentos da ferramenta;
  - `goal_period`, `analysis_period`, `goal.actual` e `historical.current` por categoria;
  - todos os gates com detalhe e valores esperados/encontrados;
  - período comparativo efetivo do plano, não `turnPlan.previous_period`.
- Separar telemetria de `engine_failed` de `truth_gate_blocked`; neste incidente a ferramenta concluiu, mas a verdade foi bloqueada. Ela não deve aparecer como falha do motor.

## Provas obrigatórias

### Golden test da frase exata

Usar a mensagem integral do screenshot com data 31/08/2026 e comprovar:

- período atual: agosto inteiro;
- comparação: julho inteiro;
- base: `calendar_previous_month`;
- ferramenta: `assess_goal_performance`;
- escopo: exatamente Lazer, Transporte, Assinaturas e Alimentação;
- nenhum período maio/junho aparece no plano, ferramenta, evidence graph ou telemetria;
- `goal.actual = historical.current` para as quatro metas de agosto;
- resposta final é produzida, começa pela conclusão agregada e não usa fallback.

### Matriz de linguagem temporal

Cobrir isoladamente e em frases compostas:

- “mês atual comparado ao mês passado”;
- “este mês vs mês anterior”;
- “mesmo período do mês passado” sem período principal explícito;
- “julho comparado a junho”;
- “de 16 a 31 de agosto comparado ao mesmo período de julho”;
- “últimos 30 dias vs período imediatamente anterior”;
- continuação anafórica com e sem período herdado.

Cada caso deve testar os papéis, não apenas as datas resultantes.

### Casos de ciclos de meta

Adicionar testes para `this_month`, `monthly_recurring`, `custom` e `next_30_days`, incluindo múltiplas metas com ciclos diferentes, competência de cartão, estorno e transação superseded. Nenhum caso pode gerar igualdade artificial nem pane global sem diagnóstico.

### E2E e auditoria do run

Executar a pergunta exata no caminho App e WhatsApp e confirmar no run:

- `final_path = composite_answered`;
- `truth_gate_blocked = false`;
- snapshot persistido mesmo se uma mutação de teste bloquear o envio;
- períodos e valores idênticos entre plano, ferramenta, assessment, resposta e telemetria;
- repetição da pergunta produz o mesmo resultado determinístico.

## Implantação segura

1. Implementar na fonte canônica e sincronizar o `finance-core`; não editar o espelho manualmente.
2. Rodar testes de período, metas, competência, escopo, gates, renderer e paridade App/Edge.
3. Validar em preview com cópia sanitizada do caso real e auditar o novo run.
4. Implantar apenas as funções afetadas após autorização explícita.
5. Repetir a pergunta real no WhatsApp e comparar centavo a centavo com o snapshot persistido.
6. Manter o bloqueio de verdade durante o rollout; nunca reativar fallback para o motor antigo.

## Critério de aceite

A correção só estará concluída quando uma frase com período principal e período comparativo não puder inverter seus papéis; meta e histórico compartilharem a mesma janela quando comparáveis; ciclos distintos forem explicitamente tratados; e qualquer bloqueio deixar evidência suficiente para reconstruir o incidente sem pedir que o usuário tente novamente às cegas.
