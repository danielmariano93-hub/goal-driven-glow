# P0: verdade comparativa única no desempenho de metas

## Diagnóstico confirmado

1. **O roteamento P0 anterior funcionou:** o turno chegou ao caminho composto e à ferramenta `assess_goal_performance`. O defeito atual está depois do roteamento, na composição dos fatos e da narrativa.
2. **A resposta exibida é autocontraditória:** o título afirma aumento em 2 categorias, enquanto os itens afirmam aumento em 3. Portanto, o runtime entregou uma resposta que deveria ter sido barrada antes do envio.
3. **Há duas regras diferentes para a mesma afirmação:**
   - o motor conta piora por `historical.trend`, que aplica piso de materialidade de R$ 50 e limiar percentual;
   - o renderer escreve “mais/menos que no período anterior” usando apenas o sinal bruto de `historical.delta`.
   Assim, contagem e detalhamento podem divergir mesmo recebendo os mesmos números.
4. **A conclusão principal não responde necessariamente à pergunta agregada:** o estado geral hoje privilegia quantidade de categorias classificadas como melhora/piora. Já a pergunta “no conjunto fiquei abaixo do mês anterior?” só pode ser respondida pelo sinal de `aggregate.vs_previous`.
5. **Os gates atuais verificam escopo, presença, identidade, freshness e separação meta/evolução, mas não verificam coerência aritmética ou narrativa.** Eles não comparam soma das categorias com o agregado, contagens com os itens, texto com os deltas nem conclusão com o total.
6. **A completude atual mede se os campos existem, não se são verdadeiros entre si.** Uma comparação contraditória ainda recebe status `complete`.
7. **A base atual do usuário confirma o sentido da reclamação:** no recorte de competência de julho e agosto, somente Transporte aparece acima; Lazer, Assinaturas e Alimentação aparecem abaixo. O plano tratará a reprodução exata do snapshot do turno como requisito, pois alterações posteriores no ledger não podem substituir a evidência que sustentou uma resposta já enviada.

## Correção definitiva

### 1. Criar um único contrato comparativo por categoria

O motor passará a produzir, para cada categoria, um objeto canônico sem interpretação duplicada:

```text
current_spend
previous_spend
delta_abs = current_spend - previous_spend
delta_pct
direction = below | above | equal
materiality = material_improvement | material_worsening | immaterial_change
```

- `direction` responde ao fato literal “ficou abaixo/acima?”.
- `materiality` qualifica a relevância da diferença, sem alterar o sentido literal.
- Nenhum renderer, resolver ou LLM poderá recalcular direção, contagem ou delta.
- Meta e comparação continuam conceitos separados, mas usam a mesma soma canônica do período atual. Para o mesmo recorte, `goal.actual` e `historical.current` deverão ser idênticos.

### 2. Separar três conclusões que hoje estão misturadas

O assessment terá conclusões independentes:

1. **Atingimento das metas:** quantas ficaram dentro/acima do teto.
2. **Comparação categoria a categoria:** quantas ficaram abaixo/acima/iguais, com uma segunda contagem opcional de mudanças materiais.
3. **Comparação do conjunto:** `aggregate.direction`, calculada exclusivamente por `aggregate.vs_previous`.

A resposta começará pela pergunta do usuário:

- agregado menor: “Sim. No conjunto dessas categorias, você gastou R$ X menos que no mesmo período anterior.”
- agregado maior: “Não. No conjunto dessas categorias, você gastou R$ X mais...”
- empate: “No conjunto, o gasto ficou praticamente igual...”

Depois virão meta, categorias e prioridade. “Maioria das categorias” nunca substituirá a resposta sobre o total agregado.

### 3. Tornar o renderer declarativo

- `DeterministicAnswers` deixará de usar `delta > 0` para inventar rótulos.
- Ele apenas traduzirá `direction` e `materiality` já emitidos pelo motor.
- A contagem do título e os itens usarão a mesma coleção canônica.
- Mudança pequena será descrita honestamente, por exemplo: “R$ 20 a mais, variação pequena”, e não apagada nem contada como piora material.
- A linha agregada mostrará também a diferença absoluta e o sentido, não apenas dois totais soltos.

### 4. Adicionar gates aritméticos e semânticos duros

Antes de qualquer resposta sair, validar:

- `current - previous = delta` por categoria e no agregado;
- soma de `current_spend` das categorias = `aggregate.current_spend`;
- soma de `previous_spend` = `aggregate.previous_spend`;
- soma dos deltas = `aggregate.vs_previous`;
- quantidade `above/below/equal` = itens com cada direção;
- contagem material = itens com cada classificação material;
- `goal.actual = historical.current` quando período e escopo são os mesmos;
- conclusão “sim, ficou abaixo” somente com agregado negativo; “não” somente com agregado positivo;
- nomes, IDs, período atual e período comparativo iguais em assessment, evidence graph e resposta;
- texto final não contém rótulo incompatível com nenhum fato canônico.

Falha em qualquer invariante bloqueará o envio e retornará uma mensagem honesta, sem delegar a decisão à LLM e sem cair em outro motor.

### 5. Persistir a evidência exata de cada resposta analítica

Cada run analítico guardará um snapshot compacto e auditável:

- IDs e nomes das categorias;
- períodos e regra de competência;
- current/previous/delta/direction/materiality por categoria;
- agregado e contagens;
- ledger version e formula version;
- resultado de cada gate;
- hash do evidence pack usado no texto.

Isso permitirá reconstruir uma resposta histórica sem consultar um ledger que já pode ter mudado. O painel administrativo poderá mostrar “fato calculado → frase enviada” para esse tipo de incidente.

### 6. Unificar App, Nino e WhatsApp no mesmo contrato

- Alterar o núcleo canônico em `src/lib/engine/goalPerformanceAssessment.ts`.
- Sincronizar o espelho de Edge pelo script oficial, sem editar fórmulas duplicadas.
- Atualizar `InterpretationResolver`, `DeterministicAnswers`, `AnalysisGates`, `AnswerCompleteness` e `EvidenceGraph` para consumir o mesmo contrato.
- Garantir que App, assessor e WhatsApp recebam os mesmos fatos e a mesma direção para o mesmo ledger/período.

## Provas obrigatórias

### Fixture do incidente

Criar um golden test com quatro categorias no formato observado:

- uma acima do período anterior;
- três abaixo;
- metas estouradas independentes da evolução;
- agregado abaixo do período anterior.

Esperado:

- resposta começa com “Sim” para o conjunto;
- contagem literal: 1 acima e 3 abaixo;
- contagem material explicitamente separada, se diferente;
- cada bullet concorda com seu delta;
- soma dos bullets reconcilia centavo a centavo com o agregado.

### Testes de mutação/invariantes

Forçar deliberadamente:

- contagem 2 com três itens acima;
- delta positivo rotulado “menos”;
- agregado positivo com conclusão “ficou abaixo”;
- total agregado diferente da soma dos itens;
- `goal.actual` diferente de `historical.current`;
- períodos diferentes no evidence graph.

Todos devem falhar no gate e impedir a resposta.

### E2E real

Executar a sequência completa: overview das metas → “compare essas mesmas categorias...” em App e WhatsApp. Confirmar no run:

- ferramenta `assess_goal_performance`;
- escopo herdado correto;
- snapshot persistido;
- todos os gates aprovados;
- texto idêntico aos fatos do snapshot;
- nenhuma chamada de LLM decidindo direção ou número.

## Implantação segura

1. Rodar suítes unitárias, golden, mutação e E2E.
2. Validar em preview com uma cópia sanitizada do caso real.
3. Comparar o contrato novo com respostas analíticas recentes e medir divergências antes de ativar.
4. Só implantar as funções afetadas após autorização explícita.
5. Após a implantação, repetir a pergunta real e auditar o novo snapshot do run.
6. Manter rollback por flag apenas para o renderer anterior; nunca reabilitar fallback para ferramenta ou escopo errados.

## Critério de aceite

A correção só estará concluída quando for matematicamente impossível enviar uma resposta em que título, itens e agregado discordem. Para qualquer período e conjunto de categorias, uma única estrutura canônica deverá determinar números, direção, contagens, conclusão e evidência em todas as superfícies.
