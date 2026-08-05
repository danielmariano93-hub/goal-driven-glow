# Plano final — concluir e publicar a Home viva do Meu Nino

## Objetivo

Concluir a implementação visual e funcional da Home autenticada, preservando a verdade financeira já implantada e fazendo a experiência refletir, de forma inequívoca, o design system oficial do Meu Nino. Após validação integral, publicar a versão correta e provar que o domínio está servindo o mesmo frontend homologado.

## Diagnóstico confirmado no HEAD

### O que já foi implementado corretamente

- A Home já segue a ordem narrativa de oito blocos: cabeçalho, disponível hoje, ritmo, leitura do Nino, projeção, melhor ação, atalhos e check-in emocional.
- `Index.tsx` já usa `useFinancialSnapshot()` para a verdade financeira e `useNinoDiagnosisContext()` para insight e ação; não será criado outro motor nem outra fórmula.
- Disponível, ritmo, projeção e patrimônio já recebem dados dos contratos canônicos.
- Insight e melhor ação já estão separados, e a ação usa o resolvedor contextual de rotas.
- Privacidade de valores, estados de carregamento e detalhes progressivos já existem.

### O que ficou incompleto ou divergente

1. **A identidade visual não foi unificada.** `src/index.css` mantém tokens antigos (`#21164F`, `#5B2BE0` e outros), tokens específicos `--home-*` e a paleta semântica global ao mesmo tempo. Eles divergem da paleta oficial Deep Ink, Nino Violet, Electric Indigo, Nino Coral e Nino Mint.
2. **A tipografia está inconsistente.** O documento carrega somente DM Sans, mas `tailwind.config.ts` ainda declara Inter e Manrope. A aparência efetiva depende de fallback em parte dos componentes.
3. **A Home não segue o padrão oficial de ícones.** Os componentes usam Lucide, embora o design system definido para o produto use Phosphor Icons e a dependência já esteja instalada.
4. **A maior parte da tela é visualmente neutra.** Ritmo, projeção, atalhos e vários estados repetem fundo branco, borda cinza e títulos pequenos; as cores de marca aparecem sem uma lógica editorial comum.
5. **Os componentes do Nino não formam uma família visual única.** `AssistantTipCard` usa uma superfície, enquanto `NinoCardShell` e `NinoSituationCard` usam outra linguagem.
6. **Há violações internas do próprio sistema.** Alguns componentes ainda usam `style` com variáveis paralelas, cores literais e botões HTML crus na navegação, em vez de tokens e primitives oficiais.
7. **O teste atual prova apenas presença e ordem dos componentes.** Ele não garante tokens oficiais, Phosphor, hierarquia, estados semânticos, responsividade ou fidelidade visual.
8. **Não foi possível homologar a Home autenticada nesta investigação**, pois a sessão do preview está deslogada. Preview e domínio redirecionam corretamente para login, mas isso não prova qual composição autenticada está sendo servida.

## Resultado visual fechado

A Home continuará clara, financeira e escaneável, mas deixará de parecer uma sequência de cartões genéricos. “Mais vida” significará **cor com função**, não decoração arbitrária:

- **Deep Ink `#10111A` / Elevated `#181A25`:** superfícies de maior autoridade, saldo e ação prioritária.
- **Nino Violet `#6D4AFF` + Electric Indigo `#4338FF`:** inteligência, controles ativos, gráfico e interação principal.
- **Nino Coral `#FF6B5F`:** atenção, risco e check-in emocional — nunca usado como cor genérica.
- **Nino Mint `#2FC99A`:** melhora, saldo/projeção positiva e confirmação.
- **Cloud `#F7F6FB`, White `#FFFFFF`, borda `#E7E5EE`:** respiro e superfícies de leitura.
- **Gradiente oficial:** reservado ao acento de marca e à ação de maior prioridade; não será repetido em todos os cards.
- **DM Sans:** única família, com pesos 400–700 e números tabulares.
- **Phosphor Icons:** única família de ícones nos componentes alterados da Home.
- Raios, bordas e sombras serão reduzidos a uma escala coerente; sem “cards dentro de cards”.
- Entrada suave por bloco e transições curtas em expansões, respeitando `prefers-reduced-motion`.

## Especificação por bloco

### 1. Cabeçalho e período

- Manter saudação, privacidade e notificações.
- Dar presença de marca ao título e aos controles com Deep Ink/Violet, sem aumentar a altura da primeira viewport.
- Transformar o período em controle secundário compacto e claramente interativo.
- Usar ícones Phosphor e áreas de toque mínimas de 44 px.

### 2. Disponível hoje

- Permanecer como protagonista da primeira viewport.
- Usar superfície Deep Ink/Elevated com acento do gradiente oficial, alto contraste e hierarquia clara para o valor.
- A composição patrimonial continuará no sheet; nenhum valor ou conceito será recalculado.
- Diferenciar visualmente “dinheiro disponível” de “patrimônio”, evitando qualquer equivalência semântica.

### 3. Ritmo de gastos

- Aplicar uma superfície clara com acento Violet/Indigo e comparação semântica Mint/Coral.
- Exibir ritmo atual, típico e variação com hierarquia imediata.
- Ajustar o gráfico para usar as cores oficiais e melhorar contraste de série atual, série anterior, grade e tooltip.
- Manter fórmula, exclusões, período comparável e explicações atuais sem alteração.

### 4. Leitura do Nino

- Reutilizar a família visual de `NinoCardShell`, em vez de manter uma linguagem isolada na Home.
- Mapear estado para cor funcional: Violet para leitura, Coral para atenção, Mint para melhora e neutro para estabilidade.
- Preservar causa, contraponto, confiança, feedback e expansão; reduzir ruído visual dos controles secundários.

### 5. Projeção fim de mês

- Manter “saldo estimado” como protagonista e “gasto total esperado” como dado secundário.
- Usar Mint quando o saldo projetado for saudável, Coral quando negativo e Violet para informação neutra/preliminar.
- Preservar integralmente a equação canônica e sua composição, sem dupla contagem e sem cálculo no componente.

### 6. Melhor ação agora

- Ser o único CTA visualmente dominante da Home.
- Usar Deep Ink com acento do gradiente oficial e botão de alto contraste.
- Manter uma única ação confiável e o estado “Continuar acompanhando” quando ela não existir.
- Preservar `diagnosisRouteForSituation()` e registrar feedback de ação.

### 7. Atalhos

- Continuar com quatro comandos, sem transformar cada item em um minicard pesado.
- Dar a cada ícone uma superfície tonal da paleta oficial, mantendo rótulos curtos, foco e alvo de toque.
- Preservar todas as rotas atuais.

### 8. Check-in emocional

- Manter no encerramento e preservar toda a lógica atual.
- Usar Coral como assinatura emocional e Mint para estado concluído.
- Refinar chips, seletor, campos e confirmação para a mesma família visual dos demais controles.

### Usuário novo e estados de sistema

- Atualizar `ComecePorAqui`, skeletons, erro, vazio e ausência de ação para a mesma linguagem visual.
- Erro nunca será mostrado como vazio; carregamento manterá dimensões estáveis.
- Usuário sem dados verá orientação útil sem números ou conquistas fictícias.

## Implementação técnica

### Design system

- Consolidar em `src/index.css` os tokens oficiais em formato semântico HSL, incluindo superfícies, tons funcionais, gradiente e sombras.
- Remover da Home a dependência visual dos tokens paralelos `--home-*`; manter aliases temporários somente se outro módulo ainda depender deles.
- Corrigir `tailwind.config.ts` para DM Sans e mapear apenas tokens semânticos.
- Estender variantes de `Button` apenas quando necessário para ação de marca e ações tonais; evitar classes ad hoc repetidas.
- Não alterar logo, símbolo, wordmark ou landing page.

### Componentes

- Refatorar apresentação, sem alterar contratos, em:
  - `src/pages/Index.tsx`
  - `src/components/home/HomeHeader.tsx`
  - `src/components/home/PeriodPicker.tsx`
  - `src/components/home/HeroDisponivelCard.tsx`
  - `src/components/home/RitmoUnificadoCard.tsx`
  - `src/components/home/AssistantTipCard.tsx`
  - `src/components/home/PrevisaoFechamentoCard.tsx`
  - `src/components/home/QuickActions.tsx`
  - `src/components/home/EmotionalCheckinCard.tsx`
  - `src/components/home/ComecePorAqui.tsx`
  - `src/components/nino/NinoCardShell.tsx`, apenas para unificar a família visual compartilhada
  - `src/components/ui/button.tsx`, somente se forem necessárias variantes semânticas reutilizáveis
- Substituir Lucide por Phosphor apenas no conjunto alterado; não fazer uma migração global fora do escopo.
- Manter toda regra financeira e toda chamada de backend intactas.

## Backend e dados

- **Nenhuma migration, tabela, RPC ou Edge Function é necessária** para a correção visual confirmada.
- Os contratos financeiros e do Nino serão preservados.
- Se a homologação revelar payload ausente ou erro real de contrato, a publicação será interrompida; a causa será corrigida sem criar fonte paralela.

## Testes e homologação

### Automatizados

- Preservar testes do snapshot v5, ritmo, projeção, privacidade, diagnóstico e rotas contextuais.
- Ampliar os testes da Home para garantir:
  - ordem dos oito blocos;
  - uso de DM Sans e ausência de Inter/Manrope no tema ativo;
  - uso dos tokens oficiais e ausência dos tokens paralelos nos componentes alterados;
  - Phosphor nos componentes da Home;
  - uma única ação dominante;
  - projeção sem recálculo local;
  - erro, vazio, loading, usuário novo, saldo negativo e projeção preliminar;
  - privacidade de todos os valores.

### Visual e funcional autenticada

- Validar no preview em 390×844, 440×727, 768×1024 e 1280×1800.
- Conferir primeira viewport, leitura integral, contraste, overflow, gráfico, bottom bar/sidebar, teclado, foco e redução de movimento.
- Exercitar: ocultar valores, trocar período, abrir patrimônio, tooltip do gráfico, detalhes do Nino, detalhes da projeção, CTA principal, atalhos e check-in.
- Comparar Home e Relatórios no mesmo período para confirmar igualdade financeira.
- Capturar evidências visuais de mobile e desktop antes da publicação.

## Publicação e prova de versão

1. Executar testes focados, suíte aplicável, typecheck e build.
2. Se qualquer etapa falhar, interromper antes da publicação.
3. Publicar somente o frontend aprovado; não alterar backend, autenticação ou comunicações.
4. Aguardar o domínio responder com o novo bundle.
5. Comparar preview e `meunino.com.br` por assets e conteúdo servido.
6. Homologar novamente a Home autenticada no domínio em mobile e desktop.
7. Entregar evidências: versão publicada, horário, bundle servido, screenshots, fluxos exercitados e resultados dos testes.

## Ordem exata de execução

1. Consolidar tokens e tipografia.
2. Criar/ajustar variantes reutilizáveis do design system.
3. Unificar a família visual Nino.
4. Implementar cabeçalho, período e disponível.
5. Implementar ritmo e gráfico.
6. Implementar insight, projeção e melhor ação.
7. Implementar atalhos, check-in e estados de usuário novo.
8. Adicionar testes estruturais, semânticos e de regressão.
9. Rodar validações automatizadas.
10. Homologar preview autenticado nos quatro viewports.
11. Publicar.
12. Confirmar bundle e homologar o domínio autenticado.

## Critérios objetivos de aceite

- Os oito blocos aparecem na ordem aprovada e sem conteúdo duplicado.
- A Home usa visualmente as cinco cores funcionais oficiais, cada uma com propósito claro, sem virar uma tela multicolorida arbitrária.
- DM Sans e Phosphor estão efetivamente aplicados ao escopo da Home.
- Não há cor literal nem token visual paralelo nos componentes alterados.
- Saldo atual, ritmo, projeção e ação continuam vindo dos contratos canônicos.
- Gasto total do mês e saldo futuro permanecem separados e não há dupla contagem.
- Todos os CTAs levam ao destino contextual correto.
- Privacidade cobre todos os valores.
- Mobile e desktop não apresentam corte, sobreposição ou overflow.
- Preview e domínio publicado servem a mesma versão homologada.
- Evidências autenticadas demonstram que a Home publicada tem a identidade e a vitalidade previstas.

## Riscos e rollback

- **Excesso de cor:** mitigado pelo mapa funcional de tons e revisão de contraste.
- **Regressão financeira:** mitigada por não alterar engine/contratos e manter os testes canônicos.
- **Mudança visual fora da Home:** tokens globais serão alterados com aliases de compatibilidade e inspeção das superfícies compartilhadas.
- **Bundle antigo no domínio:** publicação só é concluída após comparação de assets e screenshot autenticada.
- **Rollback:** restaurar o frontend anterior e republicar; nenhuma reversão de banco será necessária.