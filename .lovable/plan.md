# Uma só verdade por categoria: WhatsApp e Relatório

## Diagnóstico confirmado nos dados (não é hipótese)

Rodei os totais de agosto do seu usuário nas duas lentes que o produto usa hoje:

| Categoria | Relatório (mostra) | WhatsApp (mostra) | Por `occurred_at` | Por competência de cartão |
| --- | --- | --- | --- | --- |
| Transporte | 983,62 | 2.389,99 | 1.197,55 bruto | 2.603,92 bruto |
| Assinaturas | 1.076,97 | 1.500,07 | 1.076,97 | 1.500,07 |
| Alimentação | 1.429,53 | 1.429,53 | 1.450,63 bruto | 1.450,63 bruto |
| Lazer | 824,54 | 824,54 | 959,85 bruto | 959,85 bruto |

A diferença entre bruto e exibido é o estorno já abatido pelos dois lados (Transporte −213,93, Lazer −135,31, Alimentação −21,10). Ou seja: **estorno os dois tratam igual; o que difere é a data que define o mês**.

Causas-raiz:

1. **Duas lentes de competência.** O motor de metas (usado pelo Nino no WhatsApp) usa a competência canônica — cartão entra no mês da fatura. O motor do relatório mensal filtra e agrupa **só por `occurred_at`**, então compra de cartão cai no mês da compra. Alimentação e Lazer batem porque não têm deslocamento de fatura; Transporte e Assinaturas divergem exatamente pelo valor das compras de cartão com competência em agosto.
2. **A divergência é invisível por construção.** O `SELECT` do relatório não carrega `competence_date` nem `credit_card_id` de competência, então mesmo se alguém plugar o motor canônico ali ele degrada silenciosamente para `occurred_at` — sem erro, sem aviso.
3. **A própria tela de relatório tem duas verdades.** O bloco "O que mudou no período" usa o motor de comparação canônico (competência) e o gráfico "Para onde o dinheiro foi" usa `occurred_at`. Os dois convivem na mesma rolagem.
4. **Texto difícil de interpretar.** A resposta do WhatsApp abre com ícone de alerta e conclusão positiva ("gastou R$ 1.794,81 menos"), e cada item mistura duas leituras diferentes na mesma frase (estouro de teto + variação contra o período anterior), sem dizer qual recorte de mês está sendo usado.

## O que será feito

### 1. Lente única de competência em todas as superfícies (P0)

- Relatórios passam a usar a mesma competência canônica do motor de metas: cartão pela fatura, o resto pela data do lançamento.
- O carregamento de lançamentos do relatório passa a trazer as colunas de competência; sem elas, o cálculo falha de forma explícita em vez de degradar para a data da compra.
- Aplicado nos dois espelhos (app e função de relatório), mantendo o contrato de que fórmula não se duplica.

### 2. Fim da degradação silenciosa

- Estender a verificação de `SELECT` de lançamentos para exigir as colunas de competência em qualquer consulta que alimente agregação por mês.
- Qualquer superfície nova que agrupe por mês sem competência falha na validação, não em produção.

### 3. Recorte declarado na tela e na mensagem

- Relatório e resposta do Nino passam a dizer, uma vez, qual recorte está sendo somado (competência do mês, cartão pela fatura) e qual é o período comparado.
- Assim, quando a compra de cartão de julho aparecer em agosto, o número tem explicação visível.

### 4. Resposta mais fácil de ler

- Uma leitura principal por resposta: conclusão primeiro, número depois.
- Separar teto de tendência: a linha da categoria traz o estouro do teto; a comparação com o período anterior vira um bloco próprio, não uma segunda oração.
- Ícone coerente com a conclusão (não abrir com alerta quando a conclusão é positiva).
- Fechamento único com o ponto de atenção.

### 5. Provas automatizadas de convergência

- Teste que roda o motor do relatório e o motor de metas para o mesmo usuário e período e exige **totais por categoria idênticos**.
- Caso específico do print: compra de cartão com competência no mês seguinte precisa aparecer no mesmo mês nas duas superfícies.
- Teste de estorno: abatimento idêntico nas duas leituras.
- Teste de legibilidade: teto e comparação em blocos distintos, ícone coerente.
- Rodar suíte completa, typecheck e as validações estáticas de contrato.

## Detalhes técnicos

- Alterados: `supabase/functions/_shared/reports-core/engine.ts` e o espelho `src/lib/reports/intelligent/engine.ts` (bucket por competência), `supabase/functions/financial-reports-generate/index.ts` e o carregador equivalente no app (colunas de competência), `src/lib/reports/aggregations.ts` (filtro por competência), `supabase/functions/_shared/agent/core/DeterministicAnswers.ts` (hierarquia da resposta), `scripts/check-tx-selects.mjs` (guarda de competência).
- Sem migração de banco e sem alteração de fórmula financeira: a competência canônica já existe em `facts.ts`; o relatório passa a usá-la.
- Como o texto do Nino muda, `AGENT_RUNTIME_VERSION` sobe e as funções dependentes de `_shared/agent` entram no lote de atualização.

## Atualização de produção

A implementação e os testes rodam localmente. **Nada será atualizado em produção sem sua autorização explícita** — a atualização atômica das funções dependentes será apresentada separadamente.

## Critérios de aceite

- Para o mesmo mês, Relatório e WhatsApp mostram o mesmo valor por categoria e o mesmo total do conjunto.
- Nenhuma agregação mensal roda sem as colunas de competência.
- A resposta do Nino diz o recorte, separa teto de tendência e não abre com alerta contradizendo a conclusão.
- Suíte completa, typecheck e contratos estáticos passam.
