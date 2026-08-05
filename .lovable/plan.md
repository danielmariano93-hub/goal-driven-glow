# Plano fechado — Home Meu Nino orientada a decisões

## Objetivo

Reorganizar a Home para responder, em poucos segundos e nesta ordem:

1. Quanto tenho disponível hoje?
2. Como meu mês está indo?
3. Estou melhor ou pior do que o normal?
4. O que explica isso?
5. O que pode acontecer até o fim do mês?
6. Qual é a melhor ação agora?

A implantação será exclusivamente no app autenticado. Não altera landing page, identidade da marca, autenticação, banco, integrações ou regras de comunicação.

## Diagnóstico confirmado

- A Home atual está em ordem diferente da narrativa desejada: cabeçalho, período, disponível, ritmo, dica, atalhos, meta compartilhada, projeção e check-in.
- O motor `financial_snapshot_contract.v5` já fornece a fonte canônica necessária: disponível hoje, patrimônio, ritmo atual, ritmo típico, gasto realizado, compromissos, entradas futuras, gasto projetado, saldo projetado e confiança.
- A equação já protegida por teste é: `saldo disponível atual + entradas confirmadas − compromissos − fatura do mês − gasto variável projetado`.
- O ritmo atual já inclui dias sem gasto no denominador. O ritmo típico já exclui gastos fixos e atípicos; pagamentos de fatura, transferências e movimentos de investimento não entram como consumo.
- Home e Relatórios já usam o mesmo snapshot financeiro. Não será criada uma fórmula paralela.
- O card atual do Nino consulta o diagnóstico completo; o backend também possui `my_nino_home_item`, cuja régua editorial prioriza pendências, inteligência e depois tarefas operacionais. A Home precisa consumir uma única seleção editorial, sem repetir chamadas nem escolher itens localmente.
- O contrato de diagnóstico já fornece `primary_situation` e `primary_action`, e o resolvedor de rotas já trata destinos contextuais como lançamentos sem categoria, cartões, metas, planejamento e relatórios.
- Há cobertura automatizada para projeção v5, dupla contagem e ritmo, mas ainda falta cobertura da composição narrativa da Home e da separação entre insight e melhor ação.
- A autenticação do preview está desconectada nesta sessão; a validação visual autenticada será obrigatória durante a execução, após uma sessão ativa estar disponível.

## Experiência final

### 1. Cabeçalho contextual

- Manter saudação pelo primeiro nome, título curto, privacidade e notificações.
- Tornar o seletor de período um controle secundário compacto, sem competir com o saldo.
- Preservar a privacidade reativa em todos os valores financeiros.

### 2. Disponível hoje

- Transformar o saldo em primeiro protagonista visual, em superfície clara e sóbria, sem gradiente decorativo.
- Exibir `availableToday` como valor principal e manter a abertura de patrimônio para explicar caixa, investimentos, cartões e dívidas.
- Mostrar atualização/competência de forma discreta e nunca sugerir que patrimônio líquido é dinheiro disponível.
- Estados: carregando estável, sem conta com CTA para cadastrar conta, conta sem movimentos com orientação curta e erro recuperável.

### 3. Ritmo de gastos

- Evoluir o card existente sem alterar a fórmula.
- Número principal: ritmo atual por dia. Comparador: ritmo típico por dia e variação percentual.
- Gráfico compacto com série atual e referência típica claramente distinguíveis; sem misturar “gasto do dia”, média acumulada e comparação sem legenda.
- Direção semântica: gastar mais que o típico é atenção; gastar menos é positivo; sem base anterior é neutro, nunca “melhora” ou “piora”.
- Detalhes expansíveis explicam período, dias sem gasto, exclusões e itens que mais contribuíram, usando somente os dados canônicos já calculados.

### 4. Insight do Nino

- Separar a leitura editorial da ação operacional.
- Exibir uma única leitura principal: título, síntese curta, evidência/explicação e marcador de estado.
- Consumir a seleção canônica da Home; não remontar prioridade a partir de listas de situações no componente.
- Quando não houver mudança relevante, mostrar estabilidade factual. Em erro, oferecer nova tentativa sem substituir o fato financeiro por mensagem genérica.
- Não repetir números do saldo, ritmo ou projeção salvo quando forem evidência indispensável ao insight.

### 5. Projeção de fechamento

- Manter gasto projetado e saldo projetado como conceitos visualmente separados.
- Destacar primeiro o saldo estimado no fim do mês; abaixo, decompor a equação em linguagem simples.
- Exibir gasto total esperado apenas como dado secundário e rotulado, sem confundi-lo com saldo.
- Traduzir confiança `insufficient/low/medium/high` em linguagem amigável e explicar quando a projeção ainda for preliminar.
- Não recalcular valores no componente e não projetar gasto variável quando não houver base observada.

### 6. Melhor ação agora

- Criar um bloco próprio e curto, derivado da ação da mesma leitura editorial do Nino.
- Mostrar somente uma ação principal, com verbo e consequência claros.
- Resolver o destino por `diagnosisRouteForSituation`; validar filtros e deep links existentes antes de considerar a ação disponível.
- Se não houver ação confiável, usar um estado neutro (“Continuar acompanhando”) em vez de fabricar recomendação.

### 7. Atalhos

- Manter apenas comandos frequentes e claramente acionáveis, depois da recomendação principal.
- Preservar rotas existentes e ergonomia mobile; ícone, rótulo curto, alvo mínimo de toque e foco visível.
- Meta compartilhada deixa de interromper a narrativa principal; se ainda for relevante, aparece por meio do insight/ação canônicos ou na área própria de metas.

### 8. Check-in emocional

- Permanecer no encerramento da Home.
- Preservar a lógica e o histórico atuais, ajustando apenas a superfície visual para a nova hierarquia.

## Implementação técnica

### Composição e dados

- Refatorar `Index.tsx` para buscar o snapshot financeiro e a leitura editorial uma única vez e distribuir dados prontos aos componentes.
- Manter `useFinancialSnapshot(periodRange)` como fonte exclusiva dos números. O seletor continua compartilhando período com Relatórios.
- Encapsular a leitura da Home em um hook tipado sobre `my_nino_home_item`; reutilizar os tipos e resolvedores de ação do domínio Nino.
- Não acoplar a projeção ao período customizado quando sua semântica for “fim do mês”: deixar explícito no contrato visual que a projeção é mensal, enquanto ritmo e relatórios respeitam o filtro selecionado.
- Eliminar props ou cálculos de apresentação que ficaram redundantes após a centralização, sem remover compatibilidade do contrato financeiro.

### Componentes

- Ajustar: `HomeHeader`, `HeroDisponivelCard`, `RitmoUnificadoCard`, `PrevisaoFechamentoCard`, `QuickActions` e `EmotionalCheckinCard`.
- Dividir o atual `AssistantTipCard` em duas responsabilidades reutilizáveis: leitura do Nino e melhor ação.
- Reutilizar `NinoCardShell`, `Button`, tooltip e sheet/drawer existentes quando compatíveis; não criar primitives paralelos.
- Manter detalhes sob expansão progressiva para a primeira tela continuar escaneável.

### Design system e responsividade

- Preservar marca, símbolo e paleta oficial; nenhuma recriação de logo.
- Usar exclusivamente tokens semânticos globais para cores, bordas e sombras.
- Superfícies claras, borda sutil, raio consistente e sombra apenas onde indicar hierarquia/interação.
- Uma coluna no mobile; no desktop, conteúdo centralizado e leitura linear — sem converter a Home em dashboard denso.
- Garantir números tabulares, contraste, foco, leitores de tela, áreas de toque e `prefers-reduced-motion`.
- Corrigir a inconsistência tipográfica atual: o documento carrega apenas DM Sans, enquanto estilos do app referenciam Inter/Manrope. A execução definirá uma pilha efetivamente carregada e coerente com a identidade oficial, sem alterar a landing page visualmente.

## Arquivos previstos

- `src/pages/Index.tsx`
- `src/components/home/HomeHeader.tsx`
- `src/components/home/HeroDisponivelCard.tsx`
- `src/components/home/RitmoUnificadoCard.tsx`
- `src/components/home/AssistantTipCard.tsx` ou substitutos focados de insight/ação
- `src/components/home/PrevisaoFechamentoCard.tsx`
- `src/components/home/QuickActions.tsx`
- `src/components/home/EmotionalCheckinCard.tsx`
- `src/lib/nino/intelligence.ts` e tipos relacionados, apenas para o hook tipado da seleção editorial
- `src/index.css` e configuração tipográfica, somente nos tokens/estilos necessários
- Testes de Home, contratos financeiros e rotas contextuais

Não há migration, nova tabela ou nova função de backend prevista. Qualquer necessidade de backend descoberta durante a execução deve interromper essa parte e ser reportada, não ampliada silenciosamente.

## Validação e aceite

### Automatizada

- Preservar e executar testes de `financial_snapshot_contract.v5`, guardas contra dupla contagem e `spending_rhythm.v3`.
- Adicionar testes para ordem narrativa da Home, estados vazio/erro/carregamento, privacidade de valores, confiança da projeção e ausência de recálculo no componente.
- Testar a escolha de um único insight e uma única ação, inclusive estabilidade, ausência de ação e erro da RPC.
- Testar todos os destinos contextuais da melhor ação e seus parâmetros de URL.

### Visual e funcional

- Validar em 390×844, 768×1024 e 1280×1800 com sessão autenticada.
- Confirmar que a primeira viewport mostra cabeçalho, disponível e início do ritmo sem sobreposição.
- Confirmar que nenhum texto, valor, tooltip, gráfico, botão ou bottom bar se sobrepõe.
- Validar ocultar/mostrar valores, trocar período, abrir patrimônio, expandir detalhes, navegar pela melhor ação e realizar check-in.
- Comparar Home e Relatórios no mesmo período para garantir igualdade de ritmo e ausência de divergência financeira.
- Validar cenários: usuário novo, somente conta, sem gasto anterior, início do mês, saldo negativo, projeção preliminar, dados completos, diagnóstico estável e falha recuperável.

## Critério de conclusão

A Home estará concluída quando apresentar exatamente uma verdade para cada pergunta — disponível, ritmo, comparação, explicação, projeção e ação — na ordem definida, com números provenientes dos contratos canônicos, ações navegáveis e experiência validada em mobile e desktop. A publicação fica fora desta rodada e só ocorrerá com autorização explícita.