# Plano final — conclusão da nova Home Meu Nino

## Objetivo e escopo

Concluir a Home autenticada na ordem **Cabeçalho → Disponível → Ritmo → Leitura do Nino → Projeção → Melhor ação → Atalhos → Check-in**, preservando `financial_snapshot_contract.v5`, o Financial Situation implantado, a identidade oficial e todas as regras financeiras canônicas.

Esta execução futura não altera landing page, autenticação, integrações, identidade ou fórmulas de projeção. Não haverá publicação automática.

## 1. Diagnóstico confirmado no código atual

### Composição da Home

- `src/pages/Index.tsx:71-146` já monta os oito blocos na ordem principal solicitada, mas mantém o seletor de período como uma superfície visual de mesmo peso entre cabeçalho e saldo.
- `Index.tsx:72,118-142` usa `useNinoHomeItem()` tanto para leitura quanto para ação. Esse hook chama `my_nino_home_item` e retorna um `NinoItem` achatado (`src/lib/nino/intelligence.ts:214-233`).
- A RPC atual escolhe registros de `nino_intelligence_items` por uma régua própria e fabrica um estado de estabilidade com CTA genérico (`supabase/migrations/20260805010152...sql:1-38`). Portanto, a conclusão da Home pode divergir do snapshot atual do Financial Situation.
- A aba Nino e Relatórios já consomem `useNinoDiagnosisContext()` (`src/pages/Nino.tsx:23,119-132`; `src/pages/Relatorios.tsx:144-151,188-192`), cujo contrato preserva `snapshot_id`, situação principal, apoios, forecast, confiança e ação (`src/lib/nino/diagnosis.ts:80-100`).
- O assembler já vincula ação à situação principal e grava causa, contraponto, consequência e forecast no mesmo snapshot (`supabase/migrations/20260805095236...sql:73-84`). A ação já possui `title`, `explanation`, `estimated_impact` e `route` (`src/lib/nino/diagnosis.ts:39-49`).

### Ritmo e gráfico

- `computeRhythmComparison()` já retorna `current` e `previous`, ambos com séries diárias completas (`src/lib/engine/spendingRhythm.ts:98-107,389-405`). Cada ponto já contém `grossAmount`, `refundAmount`, `netAmount`, médias acumuladas e zero implícito nos dias sem gasto (`spendingRhythm.ts:48-70,323-348`). Não é necessário novo backend para desenhar as duas séries.
- O card atual ignora `previous.series`: usa `current.runningAverage` como linha principal e `current.typicalRunningAverage` como secundária (`src/components/home/RitmoUnificadoCard.tsx:24-31`). Assim, picos diários desaparecem e a linha secundária não representa o período anterior.
- A elegibilidade financeira já é canônica: transferências, pagamentos de fatura e movimentos de investimento não entram; compras no cartão entram na data econômica; reembolsos/estornos reduzem `netAmount` (`spendingRhythm.ts:1-24,243-262`).
- O período anterior atual é a janela imediatamente precedente de mesmo tamanho (`spendingRhythm.ts:144-150`). Isso não atende ao caso mensal “1–5 de agosto versus 1–5 de julho”.
- O ritmo atual de projeção é mês até hoje, enquanto `rhythm.current` respeita o período selecionado (`src/lib/engine/metrics.ts:589-608,595-615`). O card hoje exibe o número mensal de `projection.currentDailyPace`, mesmo quando o gráfico usa outro período (`RitmoUnificadoCard.tsx:30`).
- O ritmo típico está definido com precisão: janela móvel inclusiva de 90 dias terminando hoje; consumo bruto elegível; exclusão de recorrentes, parcelas recorrentes, categorias estruturais e outliers de Tukey acima de `Q3 + 1,5×IIQ`, somente com ao menos oito lançamentos; reembolsos não reduzem essa referência (`metrics.ts:603-608`; `spendingRhythm.ts:194-203,264-321`).
- A comparação visual atual usa `typicalDeltaPct`; para comparar grandezas equivalentes deve usar `averageDeltaPct`, pois atual e anterior são médias líquidas com a mesma elegibilidade (`spendingRhythm.ts:396-404`). O típico permanecerá uma referência separada, não a base do selo “acima/abaixo”.

### Projeção, privacidade, períodos e visual

- A equação canônica já está implementada e testada sem recálculo no componente (`src/lib/engine/metrics.ts:623-664`; `src/test/spending-projection-v5.test.ts:35-87`).
- `PrevisaoFechamentoCard` recebe apenas `snapshot.projection` e já separa saldo final de gasto total (`src/components/home/PrevisaoFechamentoCard.tsx:32-101`). Falta tornar confiança mais legível junto ao valor e consolidar estados preliminares.
- A privacidade é reativa porque `formatBRL` delega a `formatPrivateBRL` e o layout remonta a rota quando a preferência muda (`src/lib/engine/facts.ts:734-737`; `src/components/AppLayout.tsx:22-36`). Todos os novos valores e tooltips continuarão por esse formatador.
- O seletor tem uma inconsistência funcional: “Últimos 7 dias” grava um período customizado de 7 dias por meio da opção `30d`, e “Mês anterior” por meio de `90d` (`src/components/home/PeriodPicker.tsx:32-52,81-84`), enquanto `Index.tsx:61-69` trata `30d/90d` literalmente quando restaurados.
- A Home repete `bg-card`, `border-border/70`, raio de 20 px e círculos `bg-secondary` no saldo, ritmo, insight, projeção, ação e check-in. O hero perdeu a superfície de marca (`HeroDisponivelCard.tsx:28-66`) e insight/ação permanecem visualmente idênticos (`AssistantTipCard.tsx:27-49`).
- A paleta já oferece tokens oficiais utilizáveis: `primary`, `accent`, `brand-violet`, `brand-coral`, gradiente escuro, superfícies, estados e sombras (`src/index.css:16-103`; `tailwind.config.ts:20-100`). Não será criada uma nova paleta.
- A validação visual autenticada não pode ser feita nesta sessão porque o preview está sem sessão ativa; ela será etapa obrigatória da execução, antes de qualquer publicação.

## 2. O que será mantido

- `useFinancialSnapshot(periodRange)` como fonte exclusiva de `availableToday`, ritmo, projeção, patrimônio e composição.
- `financial_snapshot_contract.v5` e a equação de saldo projetado, sem recálculo em JSX.
- `computeRhythm`, `behavioralMetricAmount`, tratamento líquido de estornos e zero em dias sem gasto.
- `my_nino_diagnosis_context`/`nino_diagnosis_contract.v1.1` como diagnóstico canônico.
- `diagnosisRouteForSituation`, feedback de situação, `Button`, Popover/Tooltip, Sheet e Recharts existentes.
- DM Sans já carregada; hierarquia será feita por tamanho, peso e respiro, mantendo letter-spacing global em zero.
- Patrimônio em sheet separado, privacidade, notificações e lógica atual do check-in.

## 3. Decisão arquitetural — Financial Situation

**Escolha: B — consumir diretamente `my_nino_diagnosis_context` e adaptar apenas a apresentação.**

Justificativa:

- O payload completo e o schema Zod já existem e são usados por Nino e Relatórios.
- A mesma query key `['nino-diagnosis', user.id]` compartilha cache de 30 s entre superfícies; uma RPC `my_nino_home_context` duplicaria envelope, parsing, invalidação e risco de divergência sem ganho relevante para um único diagnóstico compacto.
- A Home não fará seleção editorial: usará exatamente `primary_situation`, o `counterpoint` já ordenado em `supporting_situations`, `primary_action`, `forecast`, `confidence`, `as_of` e `snapshot_id` do snapshot corrente.
- `useNinoHomeItem`/`my_nino_home_item` deixam de ser o contrato principal da Home, mas permanecem temporariamente compatíveis com consumidores legados; remoção definitiva fica fora deste escopo.
- Home, Nino e Relatórios terão o mesmo `snapshot_id` por construção e não poderão escolher conclusões diferentes localmente.

## 4. Contrato de apresentação da Home

Criar um adaptador puro e tipado, sem I/O e sem inferência editorial, por exemplo `toHomeDiagnosisView(context)`:

- `snapshotId`, `asOf`, `overallState`, `diagnosisConfidence`, `isStale`;
- `primary`: `id`, `headline/one_line_summary`, `cause_summary`, `consequence_summary`, `forecast_summary`, `severity`, `confidence`, `evaluation`, `impact_amount`;
- `counterpoint`: primeiro apoio com `narrative_role='counterpoint'`, sem substituir a situação principal;
- `evidenceSummary`: dados já presentes em `evaluation`, `rationale` ou `snapshot_payload`, exibidos somente quando tipados e seguros;
- `action`: `id`, `situation_id`, `title`, `explanation`, `estimated_impact`, `route`, `status`;
- `hasTrustedAction`: ação vinculada ao mesmo `primary.id`, em estado acionável, com título específico e rota interna válida.

Se `hasTrustedAction=false`, a seção mostra estado neutro sem CTA. Não haverá fallback “Acesse o ponto certo do app” nem botão genérico. A rota será resolvida por `diagnosisRouteForSituation(primary, action)` e o clique registrará feedback `acted` da situação.

## 5. Correções funcionais e visuais por bloco

### Cabeçalho e período

- Manter saudação, H1 único, privacidade e notificações; elevar alvos de toque dos ícones para 44×44 px.
- Reduzir o seletor a controle secundário compacto e corrigir presets para refletirem exatamente seus nomes.
- Política comparável: em período de mês/mês-até-hoje, deslocar o intervalo um mês e preservar os índices dos dias; em janela móvel ou customizada, usar a janela imediatamente anterior com igual quantidade de dias. Sempre alinhar o gráfico por `dayIndex`.

### Disponível hoje

- Usar somente `snapshot.availableToday` como valor protagonista, 34–38 px, tabular.
- Recuperar a marca com `primary`/`gradient-brand-dark`, texto `primary-foreground` e brilho muito sutil já tokenizado; sem ilustração, ornamento ou nova cor.
- Manter “Ver composição” discreto e remover do hero qualquer valor que possa parecer outro “disponível”. Patrimônio e obrigações continuam no sheet.
- Skeleton de altura fixa; CTA de conta apenas quando não existe conta; orientação curta quando existe conta mas não há movimentos.

### Ritmo de gastos

- Número principal: `rhythm.current.average` do período selecionado. Selo: `averageDeltaPct/averageTrend` contra o período anterior equivalente.
- Série adaptada por índice: `currentAmount=current.series[i].netAmount`; `previousAmount=previous.series[i].netAmount`; zero já fornecido pelo motor; datas reais de cada série ficam no tooltip.
- Evoluir minimamente `previousComparableRange` para a política calendário acima e versionar o contrato de ritmo, mantendo o shape de `RhythmComparison`. Não há backend nem fórmula paralela.
- Linha atual sólida na cor de marca; anterior fina e tracejada; sem área preenchida pesada. Destacar picos por marcadores discretos, sem alterar valores. Típico como linha horizontal discreta ou texto secundário usando `projection.typicalDailyPace`.
- Tooltip do gráfico mostra índice/datas, atual, anterior, diferença, reembolso quando houver e média acumulada apenas como auxiliar.
- Três acionadores de informação acessíveis via `Popover` (preferível ao tooltip hover-only em mobile):
  - **Ritmo atual:** texto fornecido, acrescido do período e denominador reais.
  - **Ritmo típico:** “últimos 90 dias até hoje”, exclusões e regra de outlier exatas; fallback “histórico ainda insuficiente”.
  - **Período anterior:** texto fornecido, com as duas datas efetivamente comparadas.
- Incluir resumo textual do gráfico para leitor de tela e não depender de cor na legenda.

### Leitura principal do Nino

- Componente compacto, cerca de metade da altura do card antigo: superfície violeta suave derivada de tokens, borda de marca sutil, símbolo oficial existente ou ícone sem recriar logo.
- Exibir conclusão, causa e contraponto em ordem. Consequência/forecast e evidências ficam em expansão progressiva.
- Confiança e atualização aparecem discretamente; dados desatualizados recebem aviso factual e opção de tentar novamente.
- Feedback “Útil/Não ajudou” permanece secundário e usa `my_nino_situation_feedback`.

### Projeção de fim do mês

- Saldo estimado em 26–30 px, com badge textual de confiança junto ao valor e copy condicional para `insufficient/low`.
- Cor funcional somente no saldo final e sempre acompanhada de texto/ícone; gasto total esperado permanece secundário.
- Composição recolhida usa exclusivamente os campos da projeção: dias observados, disponível, entradas, compromissos, fatura, variável futura e gasto total.

### Melhor ação agora

- Faixa compacta escura/de marca, visualmente distinta dos cards financeiros.
- Título = `primary_action.title`; motivo = `primary_action.explanation` combinado, sem invenção, com a causa da situação quando necessário; impacto = `estimated_impact` formatado e rotulado como estimativa.
- Um único CTA textual de 44 px, destino contextual canônico. Sem ação confiável: texto neutro, sem botão.

### Atalhos e check-in

- Manter quatro atalhos sem card externo, alvos mínimos de 44 px e ícones semanticamente distintos; reduzir círculos repetitivos usando superfície leve e estados de foco existentes.
- Check-in continua por último e mantém toda a lógica. Recebe superfície quente muito suave derivada de `brand-coral`/tokens semânticos, sem copiar o padrão dos cards financeiros; substituir botões HTML manuais por `Button` quando aplicável.

## 6. Tokens e componentes reutilizados

- Cores: `primary`, `primary-foreground`, `accent`, `brand-violet`, `brand-coral`, `card`, `secondary`, `muted`, `success`, `destructive`, `border`.
- Efeitos: `gradient-brand-dark`, `shadow-card`/`shadow-hero` com intensidade contida e tokens Home existentes apenas quando semanticamente coerentes.
- Primitives: `Button`, `Popover`, `Sheet`, componentes de estado do Nino e Recharts.
- Qualquer token adicional será alias semântico **escopado a `[data-surface='home']` e composto somente da paleta existente**; nenhuma mudança global de marca ou da landing page.

## 7. Arquivos previstos

- `src/pages/Index.tsx`
- `src/components/home/HomeHeader.tsx`
- `src/components/home/PeriodPicker.tsx`
- `src/components/home/HeroDisponivelCard.tsx`
- `src/components/home/RitmoUnificadoCard.tsx`
- `src/components/home/AssistantTipCard.tsx` ou substitutos focados em leitura/ação
- `src/components/home/PrevisaoFechamentoCard.tsx`
- `src/components/home/QuickActions.tsx`
- `src/components/home/EmotionalCheckinCard.tsx`
- `src/lib/engine/spendingRhythm.ts`
- `src/lib/nino/diagnosis.ts` e um adaptador de apresentação em `src/lib/nino/`
- `src/index.css`, somente para aliases Home escopados
- testes de ritmo, projeção, contrato/adaptador Nino e composição da Home

## 8. Necessidade de backend

**Nenhuma migration, tabela, função ou novo endpoint é necessário.** O diagnóstico completo, ação, impacto, forecast, contraponto e `snapshot_id` já existem em `my_nino_diagnosis_context`. A única evolução de contrato é local e determinística no motor compartilhado de ritmo para a semântica de período comparável; seu espelho de Edge deve ser sincronizado pelo script canônico existente, sem criar outro motor.

Se a execução encontrar payload real sem os campos aceitos pelo schema atual, ela deve interromper essa parte e reportar a incompatibilidade, não criar uma RPC alternativa silenciosamente.

## 9. Sequência de implementação

1. Fixar testes de caracterização para v5, ritmo atual/anterior e diagnóstico existente.
2. Evoluir a política de período comparável e o adaptador de séries; sincronizar o finance-core compartilhado.
3. Criar e testar o adaptador puro do diagnóstico completo para a Home.
4. Trocar `Index.tsx` de `useNinoHomeItem` para `useNinoDiagnosisContext`, mantendo uma única consulta/cache.
5. Corrigir presets do período e reconstruir o card de ritmo com séries diárias, legenda, popovers e resumo acessível.
6. Refinar insight, ação, saldo, projeção, atalhos e check-in usando a hierarquia visual definida.
7. Implementar todos os estados e privacidade sem layout shift.
8. Executar testes seletivos e validação visual autenticada nos três viewports; comparar Home, Nino e Relatórios.
9. Não publicar; entregar evidências e aguardar autorização separada.

## 10. Estados obrigatórios

- Skeletons com dimensões estáveis para saldo, gráfico, insight, projeção e ação.
- Sem conta; conta sem movimentos; início do mês; período anterior zerado/ausente; histórico típico insuficiente.
- Confiança insuficiente/baixa; saldo negativo; estabilidade sem insight relevante; ausência de ação confiável.
- Erro RPC recuperável preservando dados antigos quando houver; atualização em curso; diagnóstico desatualizado.
- Valores ocultos em cards, tooltip, resumo acessível, composição e impacto.

## 11. Testes e validação

### Automatizados

- Preservação de `financial_snapshot_contract.v5` e da equação projetada.
- Atual versus período mensal anterior alinhado (1–5 contra 1–5), além de janelas móveis/customizadas equivalentes.
- Alinhamento por índice, zeros em dias sem gasto, picos preservados, timezone `America/Sao_Paulo`, estornos líquidos e mesmas exclusões financeiras.
- Transferência, fatura, investimento, resgate e dívida sem dupla contagem.
- Ritmo típico: 90 dias, estruturais/recorrentes/outliers, amostra mínima e fallback sem histórico.
- Home e Relatórios recebendo o mesmo `RhythmComparison`; nenhuma fórmula em componente.
- Home e Nino usando o mesmo `snapshot_id`; ação pertencendo à situação principal; contraponto sem substituir conclusão.
- Título, explicação, impacto e rota vindos da ação; nenhuma copy/CTA operacional genérico.
- Confiança e projeção; estados vazio/loading/erro/stale; privacidade; rotas contextuais.

### Visual e funcional

- 390×844, 768×1024 e 1280×1800, com sessão autenticada.
- Primeira viewport com cabeçalho, saldo e início do ritmo; sem sobreposição ou overflow.
- Testar teclado, toque, foco, leitor de tela, contraste AA, áreas de 44 px e `prefers-reduced-motion`.
- Validar tooltip/popover em toque e teclado, resumo textual do gráfico e distinção sem depender de cor.
- Comparar o mesmo período na Home e Relatórios; comparar conclusão/ação/`snapshot_id` entre Home e Nino.
- Confirmar que landing page e demais telas não mudaram visualmente.

## 12. Critérios de aceite

- Cada bloco responde a uma única pergunta na ordem definida.
- Saldo usa somente `availableToday` e volta a ser a superfície principal de marca.
- Gráfico mostra gasto líquido diário atual e anterior, picos e zeros; típico não substitui o anterior.
- Definições de ritmo estão acessíveis e correspondem ao código real.
- Insight e ação vêm do mesmo diagnóstico e `snapshot_id` usados por Nino/Relatórios; nenhuma seleção local.
- Ação contém motivo, impacto e destino válidos, ou não apresenta CTA.
- Projeção usa somente v5, com confiança e composição corretas.
- Visual tem hierarquia e identidade sem excesso de gradiente, sombra ou cores concorrentes.
- Todos os estados, privacidade, acessibilidade e viewports passam; nenhum backend ou publicação é realizado sem nova autorização.

## 13. Riscos e rollback

- **Semântica de período:** mudar o comparável pode alterar números em Home/Relatórios. Mitigação: testes de calendário, janelas móveis e paridade antes da troca; manter shape do contrato. Rollback: restaurar a função anterior sem tocar em dados.
- **Diagnóstico ausente ou antigo:** a Home pode não ter situação atual. Mitigação: estados `insufficient_data`, estabilidade e stale explícitos, sem fallback para item legado que gere divergência.
- **Densidade no mobile:** causa, contraponto e ação podem alongar a tela. Mitigação: limite de linhas e expansão progressiva, sem truncar a ação principal.
- **Tokens globais:** alterações podem afetar a landing page. Mitigação: aliases escopados à Home, regressão visual fora do app e nenhuma mudança de paleta/font loading global.
- **Rollback geral:** alterações frontend e motor puro serão separadas em commits lógicos; como não há migration nem escrita de dados, o rollback consiste em reverter componentes/adaptadores e ressincronizar o espelho canônico anterior.