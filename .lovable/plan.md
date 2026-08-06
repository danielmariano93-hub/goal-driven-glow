# Renda futura estimada em todas as projeções do Nino

## Objetivo

Fazer o Nino reconhecer salários e outras entradas fixas que ainda ocorrerão no mês, usando primeiro dados explícitos e depois o histórico, sem transformar renda esperada em saldo real e sem contar a mesma entrada duas vezes.

## Regra financeira única

Criar no núcleo financeiro canônico uma agenda de entradas futuras com quatro níveis de evidência:

1. **Confirmada:** lançamento futuro já registrado.
2. **Recorrente:** ocorrência futura gerada por uma regra ativa.
3. **Configurada:** renda mensal aproximada, frequência e dia de pagamento informados pelo usuário.
4. **Inferida:** padrão recorrente detectado no histórico de entradas reais, com valor mediano, janela provável de pagamento e confiança.

Para cada janela de pagamento, manter somente a evidência de maior prioridade. Uma entrada configurada ou inferida será suprimida quando já houver lançamento ou ocorrência compatível por data e valor, ou quando o salário daquele ciclo já tiver sido recebido.

Frequências terão comportamento explícito:

- **Mensal:** uma entrada no dia configurado; ajustar com segurança meses curtos.
- **Quinzenal e semanal:** tratar a renda informada como total mensal e distribuir somente pelas janelas ainda futuras; usar o histórico para posicionar as datas quando houver evidência suficiente.
- **Variável:** não criar uma data artificial apenas a partir do perfil; projetar somente quando o histórico produzir recorrência confiável ou existir entrada explícita.

## Contrato financeiro

Evoluir o snapshot canônico para uma nova versão e separar claramente:

- `availableToday`: apenas caixa real conciliado, sem alteração.
- `confirmedFutureInflows`: entradas explícitas/recorrentes já conhecidas.
- `estimatedFixedInflows`: entradas configuradas ou inferidas, ainda não realizadas.
- `projectedEndBalance`: saldo real + entradas futuras confirmadas + entradas fixas estimadas − compromissos − fatura − consumo variável projetado.
- `freeAfterKnownCommitments`: incluir a entrada esperada quando ela ocorrer dentro do período, com composição e origem visíveis.
- proveniência por entrada: origem, data esperada, confiança, regra de deduplicação e versão da fórmula.

O helper será implementado no núcleo compartilhado e sincronizado para App, funções e WhatsApp; nenhuma superfície poderá reimplementar a fórmula.

## Superfícies que passarão a consumir a renda futura

### Home

- Manter **Disponível hoje** exatamente real.
- Atualizar **Previsão de fechamento**, **Livre após compromissos** e demais comparações de sobra/risco.
- Na composição, separar “Entradas confirmadas” de “Renda esperada”, exibindo data, origem e indicação de estimativa.
- Se os dados estiverem incompletos, degradar a projeção sem afetar o saldo.

### Nino no app e WhatsApp

- Fazer o snapshot do assessor carregar `user_financial_settings` e as ocorrências recorrentes corretas.
- Respostas como “quanto sobra”, “posso gastar”, “como fecho o mês” e “fico no negativo?” usarão o novo saldo projetado.
- O Nino explicará quando a conclusão depende de salário estimado e não tratará a entrada como recebida.

### Antecipação, diagnóstico e insights

- Pressão de caixa considerará a próxima entrada esperada e avaliará o vale entre hoje e o pagamento, não apenas o fechamento final.
- Alertas de déficit, risco, oportunidade, folga e recomendação serão recalculados com a agenda de entradas.
- Um salário no fim do mês não esconderá falta de caixa antes da data: haverá análise de menor saldo diário e data crítica.

### Relatórios, forecast e simulador

- Relatórios e previsões de fechamento receberão entradas futuras como componente separado.
- O simulador de compra considerará apenas rendas cuja data seja anterior ao desembolso ou ao fim do horizonte simulado.
- Projeções de **gasto** por categoria, ritmo de consumo e fatura continuarão independentes da renda; a renda altera sobra, capacidade e risco, não o consumo observado.

## Correções de consistência identificadas

- Trocar leituras server-side de `recurring_rules.next_due_date` pela fonte existente `recurring_occurrences.due_date`; a tabela de regras possui frequência e dia do mês, mas não essa coluna de próxima data.
- Incluir `user_financial_settings` no agregador da Home e no snapshot compartilhado do agente.
- Propagar os novos campos pelo payload canônico persistido, tools do agente, forecast, relatórios e motores de antecipação, preservando compatibilidade durante a transição.

## Implementação técnica

1. Criar tipos e helper determinístico para gerar, classificar e deduplicar eventos de renda futura.
2. Integrar o helper ao snapshot financeiro canônico e sincronizar o espelho usado pelas funções.
3. Ajustar os carregadores de dados do App e servidor para settings, histórico e ocorrências recorrentes.
4. Atualizar forecast, pressão de caixa, diagnóstico, relatórios e tools do assessor para consumir os mesmos eventos.
5. Atualizar os cards e detalhes da Home sem mudar a identidade visual ou aumentar a escala atual.
6. Recalcular snapshots derivados quando renda, frequência ou dia de pagamento forem alterados.

## Validação e aceite

- Saldo atual e patrimônio não mudam ao cadastrar salário futuro.
- Salário mensal ainda não recebido entra uma única vez na projeção do mês.
- Salário já recebido, planejado ou coberto por recorrência não é duplicado.
- Pagamento no último dia de mês curto recebe data válida.
- Frequências mensal, quinzenal, semanal e variável respeitam as regras acima.
- A projeção distingue valor confirmado de estimado e informa confiança/origem.
- Pressão de caixa detecta déficit anterior ao salário mesmo quando o fechamento termina positivo.
- App, WhatsApp, relatórios e insights retornam os mesmos números para o mesmo período.
- Testes unitários cobrem calendário, deduplicação, recebimento parcial, histórico insuficiente e virada de mês; testes de integração cobrem Home, assessor e motores server-side.