# Plano corretivo fechado — Home Meu Nino fiel à especificação

## Objetivo

Corrigir, em uma única implementação, a Home já alterada para reproduzir rigorosamente a especificação visual anexada e todos os requisitos funcionais do pedido anterior, sem redesenhar outras telas, sem criar dados fictícios e sem publicar em produção.

Ordem obrigatória:

```text
cabeçalho/período → disponível hoje → ações rápidas → orientação → ritmo → previsão → compromissos → check-in → navegação
```

## Divergências confirmadas no código atual

- A Home renderiza **Orientação do Nino antes de Ações rápidas**, contrariando a ordem definida.
- `index.html` carrega apenas DM Sans; Manrope e Inter aparecem como fallbacks CSS, portanto não estão efetivamente implementadas.
- O cabeçalho usa “Seu dinheiro, com o Nino.”, não “Seu dinheiro, com clareza.”.
- O seletor não oferece “Mês passado” nem “Últimos 7 dias” e oferece “Últimos 90 dias”, fora do conjunto pedido para a Home.
- O gradiente do Hero inclui coral e quatro pontos; a especificação exige exclusivamente `Deep Plum → Royal Purple → Nino Violet`.
- O Hero não apresenta de forma explícita e auditável “Livre após compromissos conhecidos” como segunda métrica.
- A orientação ocupa um card editorial extenso, pode revelar metodologia e feedback, em vez da faixa compacta com um insight e um CTA.
- O gráfico usa interpolação linear, não tem área lilás, e desenha “típico” como segunda linha; a especificação exige a **série diária do mesmo intervalo anterior** tracejada.
- Há vários textos de 10 px e 11 px, embora o mínimo obrigatório seja 12 px.
- A projeção exibe centavos e continua mostrando número com confiança insuficiente; deve ocultar o número antes de três dias e usar “cerca de” sem centavos quando elegível.
- A Home não renderiza a seção “Próximos compromissos”.
- Raios, padding, sombra, largura desktop e densidade não seguem os valores definidos de 28/24/20/16 px, grid de 4 px e máximo de 720 px.
- A navegação móvel atual tem quatro itens, usa outra biblioteca de ícones e mantém um FAB separado; isso não corresponde à composição de cinco destinos com Nino central mostrada na referência e aumenta o risco de cobrir conteúdo.
- O contrato foi rotulado como v6, mas a Home ainda o monta no cliente a partir de múltiplas consultas. A correção precisa comprovar a leitura canônica compartilhada antes de declarar paridade com Relatórios, Nino, WhatsApp e MCP.

## Implementação única

### 1. Fechar o contrato financeiro antes da apresentação

- Auditar e completar `financial_snapshot_contract.v6` sem criar uma fonte paralela.
- Servir à Home um snapshot canônico com: versão do contrato e fórmulas, `America/Sao_Paulo`, período solicitado, fim observado, período anterior efetivo, atualização, completude, confiança, fontes, ausências e evidências.
- Manter “Disponível hoje” como posição atual mesmo quando o filtro estiver em período passado.
- Expor diretamente, sem cálculo React:
  - disponível hoje;
  - livre após compromissos conhecidos;
  - entradas confirmadas;
  - compromissos e exposição de cartão considerados;
  - média diária atual e anterior;
  - variação não arredondada;
  - ritmo típico elegível;
  - séries diárias atual/anterior com zeros;
  - projeção e confiança;
  - até três próximos compromissos não liquidados.
- Operar valores críticos em centavos/decimal nas fronteiras e impedir `R$ 0,00` para informação ausente.
- Preservar as regras existentes de consumo: excluir transferências próprias, investimentos, pagamento de fatura, duplicidades e itens inválidos; considerar compras no cartão uma vez e reembolsos como redução.
- Confirmar o mesmo contrato nos adaptadores de Relatórios, Nino, Assessor/WhatsApp, MCP e insights. Espelhos Edge serão gerados pelo sincronizador existente, sem fórmulas próprias.
- Se o read model persistido atual não comportar os campos, usar uma única migration aditiva e idempotente, com GRANT, RLS, índices necessários, origem/evidência, shadow read e rollback por flag. Nenhuma tabela será criada apenas por conveniência.

### 2. Aplicar exatamente o sistema visual do anexo

- Carregar Manrope e Inter; escopar Manrope a títulos/saldos/métricas e Inter a corpo, labels, botões, filtros e tooltips da Home.
- Aplicar a escala exata 32/38, 28/34, 22/28, 18/24, 14/21, 12/18 e 11/16 apenas para label — mantendo o texto visível nunca abaixo de 12 px.
- Definir tokens da Home para Deep Ink, Secondary, Cloud, White, Border, Deep Plum, Royal Purple, Nino Violet, Warning e Deep Rose.
- Usar no saldo somente `linear-gradient(135deg, #17102E 0%, #3C1B78 54%, #6B2CFF 100%)`; remover coral, neon, glass e gradientes concorrentes da primeira dobra.
- Aplicar grid de 4 px, margem mobile de 16 px, gaps de 16–20 px, cards com 20–24 px, toque mínimo 44 px e conteúdo desktop de 720 px.
- Aplicar raios exatos: saldo 28 px, analíticos 24 px, faixa 20 px, internos 16 px e chips 999 px; borda de 1 px e sombra `0 8px 24px rgba(16,17,26,.06)` somente onde especificado.
- Manter apenas Hero, Ritmo e Previsão claramente elevados.

### 3. Reconstruir cada bloco na ordem especificada

1. **Cabeçalho e período**
   - “Olá, {nome}” e “Seu dinheiro, com clareza.”, olho de privacidade, notificações e período integrado ao cabeçalho.
   - Opções: Este mês, Mês passado, Últimos 7 dias, Últimos 30 dias e Personalizado.
   - Explicação acessível de que o filtro afeta análise, mas não transforma “Disponível hoje” em saldo histórico.

2. **Disponível hoje**
   - Label em caixa alta, saldo confirmado dominante, texto/valor “Livre após compromissos conhecidos” e CTA “Ver composição”.
   - Sheet com equação fechada, fontes, referência, faturas/parcelas e ausências; sem patrimônio, limite, cheque especial ou investimentos.
   - Estados de fonte derivada, desatualizada, incompleta e ausente sem mascarar incerteza.

3. **Ações rápidas**
   - Anotar, Dividir rolê, Antes de comprar e Mais, nessa ordem, sem card externo.
   - Ícones Phosphor monocromáticos em círculos lilás claros; nenhuma ação recebe destaque visual incompatível.

4. **Orientação prioritária**
   - Faixa compacta de raio 20 px, borda lateral âmbar de 3 px, ícone, título curto, até duas linhas e um CTA real.
   - No máximo um insight, escolhido deterministicamente pelo diagnóstico canônico.
   - Remover da Home feedback “Útil/Não ajudou”, projeção duplicada e metodologia extensa; detalhes seguem na superfície do Nino.

5. **Seu ritmo de gastos**
   - Métrica de 28/34, `/dia`, variação versus o intervalo anterior idêntico e padrão habitual somente quando houver histórico elegível.
   - Gráfico Recharts com curva `monotone`, atual sólida 2,5 px violeta + área de 6%, anterior tracejada 1,5 px cinza; pontos reais e dias sem gasto preservados.
   - Tooltip por toque/hover/foco com data, atual, anterior e diferença; resumo textual/tabela acessível; CTA “Ver rotina e categorias”.
   - Um único painel de definições para média, período anterior, variação e ritmo típico.

6. **Previsão para o fim do mês**
   - Antes de 3 dias: “Ainda é cedo para projetar este mês”, sem número.
   - Quando elegível: “cerca de”, valor sem centavos, confiança correta e informação ausente localizada.
   - Manter separados “Dinheiro livre” e “Consumo do mês”; sheet “Entender a previsão” com todos os componentes e sem dupla contagem.
   - Em período encerrado, mostrar fechamento realizado ou ocultar previsão futura conforme o contrato; nunca simular futuro passado.

7. **Próximos compromissos**
   - Até três itens confirmados, ordenados por vencimento, com nome, data, valor, tipo e estado; CTA “Ver todos os compromissos”.
   - Vazio honesto e estado incompleto sem total zero inventado.

8. **Check-in e navegação**
   - Check-in abaixo da primeira dobra, compacto no estado inicial, mantendo edição e vínculo com gasto.
   - Navegação inferior com Início, Movimentos, Nino central, Metas e Mais, usando Phosphor, área segura e estado ativo.
   - Integrar o acesso ao Nino sem FAB sobreposto; garantir que nenhum controle cubra conteúdo ou tooltip.

### 4. Estados, privacidade e atualização

- Skeletons com dimensão final e último snapshot válido preservado durante refetch.
- Estados específicos: sem movimentos, sem comparação, incompleto, desatualizado, erro e estimado/oficial.
- Privacidade substitui valores por `••••••` em texto, detalhes, tooltips, tabela acessível e leitura por leitor de tela, mantendo apenas a forma do gráfico.
- Reusar query keys e invalidação central após criar/editar/excluir lançamento, importação, reembolso, categoria, conta, cartão/fatura, recorrência, dívida e compromisso.

### 5. Arquivos e áreas

- Orquestração: `src/pages/Index.tsx`, `src/components/AppLayout.tsx`.
- Home: `HomeHeader`, `PeriodPicker`, `HeroDisponivelCard`, `AvailableBalanceDetails`, `QuickActions`, `NinoGuidanceCard`, `RitmoUnificadoCard`, `RhythmMethodSheet`, `PrevisaoFechamentoCard`, `EmotionalCheckinCard` e um componente focado para compromissos.
- Navegação: `BottomTabBar` e integração do acesso ao Assessor/Nino.
- Design system: `src/index.css`, `tailwind.config.ts` e carregamento de fontes no head.
- Dados: `metrics.ts`, `spendingRhythm.ts`, `useFinancialSnapshot.ts`, query keys/invalidação e espelhos compartilhados Edge.
- Backend somente se indispensável: read model/RPC versionado e migration aditiva segura.

## Testes e validação obrigatórios

- Fórmulas: dias zerados, intervalo anterior idêntico, base anterior zero, atípicos, cartão/fatura, reembolso, compromisso sem duplicidade, período encerrado, confiança e timezone.
- Aceite numérico: `R$ 1.132,71 ÷ 5 = R$ 226,54/dia`; anterior `R$ 89,53/dia`; variação aproximada `+153%`.
- Contrato: mesma versão e mesmos valores entre Home, Relatórios, Nino, WhatsApp e MCP; nenhum cálculo monetário em componente ou LLM.
- Interface: tooltips por toque/hover/foco/teclado, privacidade total, duas séries, estados vazio/parcial/erro/desatualizado e navegação sem cobertura.
- Responsividade real em 360, 390, 430, tablet e desktop; zoom 200%, sem overflow, contraste AA e alvos de 44 px.
- Comparação visual lado a lado com o anexo para hierarquia, fontes, cores, gradiente, raios, sombras, espaçamento e densidade.
- Executar testes existentes e novos, typecheck, lint e build; qualquer regressão bloqueia a conclusão.

## Critérios de aceite

- Todos os itens 1–25 do pedido anterior possuem correspondência verificável na interface, contrato ou teste.
- A ordem e a composição da Home correspondem ao anexo, sem reduzir tipografia para caber na primeira dobra.
- Gráfico mostra atual versus anterior, não “atual versus típico”.
- Projeção não mostra número antes de três dias e nunca apresenta desconhecido como zero.
- Próximos compromissos está presente e usa somente dados confirmados.
- O botão do Nino não cobre conteúdo.
- A fonte financeira é única e auditável em todos os canais.
- Nenhuma outra tela é redesenhada e nada é publicado sem autorização explícita.