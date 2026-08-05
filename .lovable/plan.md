# Plano fechado — Home Meu Nino coesa, decisional e financeiramente canônica

## 1. Diagnóstico confirmado do código atual

### Composição e hierarquia

- `src/pages/Index.tsx` renderiza hoje, nesta ordem: cabeçalho, seletor, saldo, ritmo, leitura, projeção, melhor ação, atalhos e check-in. Portanto, a narrativa desejada ainda está fragmentada em **três blocos independentes**: `AssistantTipCard`, `PrevisaoFechamentoCard` e `BestActionCard`.
- `HeroDisponivelCard.tsx` e `BestActionCard` usam grandes superfícies escuras; `AssistantTipCard.tsx` usa superfície lilás em gradiente; `RitmoUnificadoCard.tsx` usa faixa colorida superior; `EmotionalCheckinCard.tsx` usa fundo coral. Isso confirma a competição visual descrita.
- `QuickActions.tsx` atribui uma cor diferente a cada atalho. O padrão atual é funcional, mas não forma uma linguagem operacional única.
- `PeriodPicker.tsx` é um botão de largura total com borda, fundo, sombra, ícone destacado e dois níveis de texto; visualmente funciona como card, não como filtro contextual.
- O FAB do assessor é global, montado por `AppLayout.tsx`, e usa gradiente e sombra próprios em `AssessorFab.tsx`. Ele continuará funcional; a futura rodada reduzirá apenas sua ênfase visual, sem alterar rota ou comportamento.

### Dados financeiros

- `useFinancialSnapshot()` carrega as fontes financeiras e chama `computeFinancialSnapshot()`; os componentes não precisam recalcular valores.
- O contrato superior retornado por `FinancialSnapshot` ainda é identificado como `finance_contract.v4` em `src/lib/engine/metrics.ts`. Dentro dele, `projection.formulaVersion` é `financial_snapshot_contract.v5`. Assim, “v5” hoje versiona **ritmo/projeção**, não todo o objeto superior.
- `availableToday` é produzido exclusivamente por `computeTotalCash()` dentro de `computeFinancialSnapshot()` e entregue pronto à Home. Ele soma saldos canônicos das contas; não inclui investimentos nem limite de cartão.
- `projection` já entrega prontas todas as parcelas necessárias: `currentAvailableBalance`, `confirmedFutureInflows`, `upcomingConfirmedCommitments`, `cardDueThisMonth`, `projectedVariableSpending`, `projectedTotalSpending`, `projectedEndBalance` e `confidence`.
- `rhythm.current.series` e `rhythm.previous.series` já trazem os pontos diários, incluindo zero nos dias sem gasto, `grossAmount`, `refundAmount`, `netAmount` e datas. O componente atual usa corretamente `netAmount` para as duas linhas, mas o tooltip ainda exibe “média acumulada” em vez da diferença diária solicitada.
- `previousComparableRange()` já compara mês/mês-até-hoje pelos mesmos índices e usa janela anterior de igual duração nos demais filtros.
- O motor `spending_rhythm.v4` exclui transferências, aplicações e pagamentos de fatura pela elegibilidade canônica; o ritmo típico também trata despesas estruturais/recorrentes e outliers. Essas regras não serão copiadas nem modificadas na Home.
- A contribuição principal por dia **não existe** em `DailyPoint`. Como ela foi solicitada apenas “quando disponível”, não será fabricada nem motivará backend nesta rodada. Reembolsos já estão disponíveis e serão mostrados quando positivos.

### Diagnóstico do Nino

- Home, aba Nino e Relatórios já usam `useNinoDiagnosisContext()` e a RPC `my_nino_diagnosis_context`.
- O contrato validado em `src/lib/nino/diagnosis.ts` é `nino_diagnosis_contract.v1`/`v1.1` e inclui `snapshot_id`, situação principal, situações de apoio, forecast, confiança e `primary_action`.
- `toHomeDiagnosisView()` preserva situação principal, contraponto, evidência, snapshot e ação vinculada. A futura Home continuará usando esse adaptador; não voltará a `useNinoHomeItem` e não fará seleção editorial local.
- `AssistantTipCard.tsx` ainda expõe confiança percentual e feedback “Útil/Não ajudou” na primeira camada.
- `BestActionCard` usa a ação canônica quando confiável, mas também apresenta um estado genérico “Continuar acompanhando”; essa superfície independente e seu fallback serão removidos.
- `diagnosisRouteForSituation()` pode substituir a rota da ação com heurísticas por tipo de situação. Na nova orientação principal, o CTA usará diretamente a `primary_action.route` já validada por `hasTrustedAction`; as heurísticas continuam disponíveis somente para outros contextos existentes.
- O `snapshot_id` compartilhado é o do diagnóstico do Nino. O snapshot financeiro calculado no cliente não possui `snapshot_id`; o plano não inventará equivalência entre esses dois conceitos.

### Estados, privacidade e acessibilidade

- A privacidade é reativa por `PrivacyModeContext`; `formatBRL()` delega ao formatador privado e `AppLayout` remonta a rota quando a preferência muda.
- O texto acessível do gráfico é formatado pelo mesmo formatador, mas a futura descrição e o tooltip também deverão passar exclusivamente por ele para não vazar números ocultos.
- `useFinancialSnapshot()` expõe somente `data` e `loading`; não diferencia erro das consultas, ausência real e dados parcialmente carregados. Além disso, o `loading` atual cobre contas, snapshots e transações, mas não todas as fontes usadas na projeção. Isso precisa ser corrigido no hook, sem mudar fórmulas.
- `HeroDisponivelCard` usa `0` como fallback quando `snap` está ausente; embora o skeleton esconda parte desse estado, a composição atual permite confundir ausência com zero em caminhos parciais.
- O gráfico possui descrição para leitor de tela e popovers Radix acionáveis por toque/teclado, mas os três gatilhos conceituais ocupam espaço demais e o tooltip não explicita a diferença nem ambas as datas em linguagem completa.
- Há inconsistência de ícones: a Home usa Phosphor em vários pontos, mas `NotificationBell`, `PatrimonioSheet`, estados do Nino, primitives e FAB ainda usam Lucide. A rodada será restrita aos elementos efetivamente visíveis na Home.
- A prévia autenticada não pôde ser capturada nesta auditoria porque a sessão disponível estava desconectada; a implementação só poderá ser aceita após validação visual autenticada nos quatro viewports definidos.

## 2. Arquitetura final da Home

```text
Index
├── HomeHeader
├── HomePeriodSelector
├── AvailableBalanceCard
│   └── AvailableBalanceDetails
├── SpendingRhythmCard
│   ├── RhythmChart
│   ├── RhythmTooltip
│   └── RhythmMethodSheet
├── NinoGuidanceCard
│   ├── GuidanceSummary
│   ├── GuidanceCounterpoint
│   ├── GuidanceForecast
│   ├── GuidanceAction
│   └── GuidanceDetails
├── QuickActions
└── FinancialCheckin
```

- A ordem acima será literal no DOM e no fluxo visual.
- Projeção e ação deixam de existir como seções autônomas; passam a subpartes da orientação.
- Os nomes públicos poderão ser modernizados, mas os componentes manterão semântica financeira específica; não será criada uma camada genérica de “cards”.
- `Index` continuará apenas orquestrando estado, hooks e props. Nenhuma fórmula ou seleção de diagnóstico será movida para a página.

## 3. Fonte exata de cada dado

| Conteúdo | Fonte canônica | Apresentação |
|---|---|---|
| Disponível hoje | `useFinancialSnapshot()` → `FinancialSnapshot.availableToday` | Valor principal, sem recomposição |
| Entradas confirmadas | `snapshot.projection.confirmedFutureInflows` | Linha secundária somente quando maior que zero |
| Compromissos previstos | `snapshot.projection.upcomingConfirmedCommitments` | Linha secundária somente quando maior que zero; fatura permanece separada no detalhe |
| Ritmo atual | `snapshot.rhythm.current.average` | R$/dia do período selecionado |
| Diferença para período anterior | `rhythm.current.average` e `rhythm.previous.average`, usando `averageDeltaPct` para estado | Texto pronto na camada de apresentação; sem reprocessar transações |
| Ritmo típico | `snapshot.projection.typicalDailyPace` | Referência textual discreta |
| Série atual | `snapshot.rhythm.current.series[].netAmount` | Linha sólida |
| Série anterior | `snapshot.rhythm.previous.series[].netAmount` | Linha tracejada |
| Reembolsos | `snapshot.rhythm.current.series[].refundAmount` | Tooltip quando maior que zero |
| Conclusão | `diagnosis.primary.one_line_summary` ou `headline` | Título da orientação, sem alterar conclusão |
| Causa | `diagnosis.primary.cause_summary` e, quando necessário, `evidenceSummary` | Corpo curto |
| Contraponto | `diagnosis.counterpoint` | Trecho secundário somente se relevante |
| Consequência | `diagnosis.primary.consequence_summary` | Corpo narrativo |
| Forecast editorial | `diagnosis.primary.forecast_summary` | Linguagem já produzida pelo diagnóstico |
| Projeção numérica detalhada | `snapshot.projection` | Detalhe financeiro; nenhuma parcela recalculada |
| Melhor ação | `diagnosis.action`, somente quando `hasTrustedAction` | `title`, `explanation`, `estimated_impact` e `route` |
| Severidade visual | `diagnosis.primary.severity`/`overallState` | Barra e ícone semânticos, nunca fundo saturado |
| Confiança | `diagnosis.diagnosisConfidence` e `projection.confidence` | Modula copy/visibilidade; percentual não aparece na primeira camada |

## 4. Mudanças por componente

### `HomeHeader`

- Manter saudação, H1 único, privacidade e notificações existentes.
- Fundo transparente, sem borda, sombra ou gradiente.
- Garantir dois controles de 44 × 44 px, foco visível e labels dinâmicos.
- Trocar apenas o ícone da notificação visível na Home para Phosphor, preservando consulta, contador e rota.

### `HomePeriodSelector` (evolução de `PeriodPicker`)

- Transformar o gatilho em filtro contextual compacto: texto do intervalo + caret, sem container de card, sombra ou microlabel redundante.
- Preservar `PeriodKind`, `resolvePeriodRange()`, persistência e Sheet atual.
- Exibir intervalo em português sem truncar; quando o intervalo atravessar meses/anos, incluir contexto suficiente.
- Validar e desabilitar “Aplicar” para período personalizado vazio, invertido ou futuro, evitando divergência entre label e estado interno.

### `AvailableBalanceCard` (evolução de `HeroDisponivelCard`)

- Ser a única grande superfície escura: roxo profundo/grafite violeta, gradiente quase imperceptível, sem faixa superior e sem ícone decorativo grande.
- Valor em 34–38 px, números tabulares e privacidade canônica.
- Receber `availableToday` e as duas linhas futuras prontas; não receber patrimônio, investimento ou dívidas.
- Diferenciar ausência de dado, zero e negativo. Negativo mantém legibilidade no mesmo card sem transformar toda a superfície em vermelho.
- Substituir `PatrimonioSheet` por detalhe coerente com disponível/projeção. Patrimônio não será misturado neste fluxo.
- Manter uma única ação “Ver composição”.

### `SpendingRhythmCard` (evolução de `RitmoUnificadoCard`)

- Remover faixa em gradiente, excesso de pills e acordeão metodológico aberto no card.
- Cabeçalho com título, um único botão de informação acessível e valor principal.
- Mostrar diferença absoluta em reais em relação ao período anterior; percentual poderá ficar apenas no detalhe, não como selo dominante.
- Manter linhas atual sólida e anterior tracejada, grid horizontal mínimo, zeros explícitos e sem área preenchida.
- Tooltip por toque/teclado: data atual, data correspondente anterior, ambos os valores, diferença com sinal e reembolso quando existente. Não mostrar média acumulada.
- “Como calculamos” abrirá Sheet no mobile e Popover/Sheet acessível no desktop com as três definições. Sem hover obrigatório.
- Descrição textual do gráfico informará tendência, valores médios e disponibilidade do comparativo, sem depender de cor.
- Sem base anterior ou ritmo típico confiável: omitir a comparação específica, não fabricar zero como base.

### `NinoGuidanceCard` (consolidação de leitura, projeção e ação)

- Novo módulo único branco com borda neutra e barra lateral de 3–4 px.
- Ordem interna fixa: conclusão → causa → contraponto → consequência/forecast → ação.
- Tons: roxo normal, âmbar atenção, vermelho crítico; fundo permanece branco.
- Aplicar linguagem condicional de acordo com confiança. Não exibir percentual na primeira camada.
- Incorporar projeção apenas quando relevante e disponível. Em baixa amostra, antepor a ressalva de estimativa inicial; nunca converter projeção em certeza.
- “Entender análise” abrirá um Sheet/Collapsible com evidências, fórmula de projeção já resolvida, feedback discreto e data da leitura.
- Detalhe financeiro renderizará diretamente os cinco operandos e o saldo final de `projection`; `projectedTotalSpending` será secundário.
- Ação só aparece se `hasTrustedAction` for verdadeira. CTA usa `primary_action.route` validada e copy derivada de `primary_action.title`; não haverá “Resolver agora”, “Ver detalhes” ou outro fallback fabricado.
- Sem ação confiável: manter apenas “Entender análise” quando houver conteúdo detalhado.
- Feedback útil/não útil sai da primeira camada e vai para o detalhe ou pós-ação.

### `QuickActions`

- Renomear título visual para “Ações rápidas”.
- Preservar as quatro rotas e funcionalidades.
- Unificar fundo cinza-lilás claro, ícones Phosphor em roxo/grafite, dimensões e estados; remover coral, mint e ink como identidades individuais.
- Sem card externo, sombra ou animação que desloque o layout; 44 px mínimos de toque e labels sem truncamento.

### `FinancialCheckin` (evolução de `EmotionalCheckinCard`)

- Superfície neutra/levemente quente, sem fundo coral saturado e sem sombra forte.
- Primeira camada compacta com “Tranquilo”, “Atento” e “Preocupado”. A implementação verificará o mapeamento dos rótulos para `mood`/`trigger_label` para preservar histórico e relatórios; não haverá alteração de banco.
- Campos opcionais e relatório aparecem somente após escolha/expansão.
- Depois de salvo, recolher para estado compacto editável, mantendo feedback de sucesso acessível.

### FAB do assessor

- Preservar abertura e integração atuais.
- Substituir gradiente e sombra intensa por botão sólido semântico e sombra discreta, para não disputar com o saldo. Nenhuma mudança no painel, WhatsApp ou rotas.

## 5. Tokens e estilo

- Consolidar em `src/index.css`/`tailwind.config.ts` os papéis semânticos, em HSL: fundo `#F7F7FA`, superfície `#FFFFFF`, foreground `#17171C`, muted foreground `#686873`, borda `#E8E8EE`, primary `#5B35F2`, brand deep `#211547`, primary soft `#F2EEFF`, positivo `#168A61`, atenção `#B66A00`, negativo `#D64545` e respectivos fundos suaves.
- Não espalhar hex, RGB ou styles inline nos componentes. Os tokens legados `--home-*` serão reconciliados com os tokens semânticos, não mantidos como uma terceira paleta paralela.
- DM Sans permanece única em `sans` e `display`.
- Valores financeiros usarão `tabular-nums`; letter spacing permanecerá `0`, conforme a regra global do produto e legibilidade iOS.
- Cards principais: raio 18–22 px, padding 16–20 px, borda hairline e sombra ausente ou mínima. Botões de comando terão 48 px quando primários; áreas auxiliares nunca abaixo de 44 px.
- Animações serão discretas, sem deslocar layout, e respeitarão `prefers-reduced-motion` já existente.

## 6. Estados obrigatórios

| Estado | Comportamento planejado |
|---|---|
| Loading financeiro | Skeleton estável por módulo; nunca renderizar R$ 0 provisório |
| Erro de snapshot | Mensagem factual com retry; orientação do Nino pode permanecer se válida, identificada como leitura separada |
| Dados financeiros parciais | Exibir apenas campos confirmados e aviso discreto; nenhuma parcela ausente vira zero |
| Sem conta | CTA existente para cadastrar conta dentro do saldo; ritmo e projeção em estado inicial |
| Saldo zero | Mostrar zero real somente após snapshot carregado e conta existente |
| Saldo negativo | Valor com semântica textual/ícone, mantendo o único card escuro |
| Sem movimentações | Ritmo em estado vazio; onboarding necessário sem criar módulo extra entre as sete seções |
| Início do mês/poucos dias | Ritmo factual disponível; forecast em linguagem preliminar conforme confiança |
| Sem período anterior | Linha anterior e delta omitidos; texto “Ainda sem base comparável” |
| Sem ritmo típico confiável | Referência típica omitida, não exibida como zero |
| Erro de diagnóstico | Estado inline dentro da seção Orientação, com retry |
| Sem diagnóstico | Texto curto de formação de leitura, sem conclusão falsa |
| Diagnóstico sem ação | Sem CTA fabricado; detalhe apenas se houver conteúdo |
| Projeção baixa confiança | Linguagem condicional e indicação de amostra inicial |
| Projeção positiva/negativa | Texto e ícone além de cor; negativo somente quando valor realmente negativo |
| Valores ocultos | Todos os valores visuais, tooltips, descrições e `aria-labels` usam formatador privado |

## 7. Responsividade e acessibilidade

- Validar 360 × 800, 390 × 844, 768 × 1024 e 1280 × 1800 com sessão autenticada e dados reais/estados controlados.
- Mobile mantém uma coluna, 16 px laterais e 20–24 px entre seções; gráfico terá altura estável e tooltip contido na viewport.
- Tablet/desktop poderão alinhar apenas conteúdo interno ou atalhos; a ordem narrativa não muda e os três módulos principais não serão esticados além da largura legível atual (`md:max-w-2xl`).
- O seletor não truncará datas importantes; ações poderão quebrar em duas linhas sem reduzir área de toque.
- Gráfico terá resumo textual, padrões de traço além da cor, labels acessíveis e navegação/touch funcional.
- Popovers/Sheets usarão primitives Radix existentes para foco, Escape e teclado; no mobile, detalhes extensos preferirão Sheet.
- Contraste AA será verificado para texto auxiliar sobre card escuro, barras semânticas, botões e estados de foco.
- Corrigir textos residuais não localizados nas primitives tocadas pela Home, como “Close”, para português.

## 8. Componentes consolidados ou removidos do layout

- `PrevisaoFechamentoCard` deixa de ser renderizado e sua apresentação é absorvida por `NinoGuidanceCard`.
- `BestActionCard` deixa de existir como export/layout independente; sua ação canônica é absorvida por `NinoGuidanceCard`.
- `AssistantTipCard` é substituído pela orientação única.
- `PatrimonioSheet` sai do fluxo “Disponível hoje”; como não há outro uso confirmado, será removido após nova busca de referências na execução.
- `ComecePorAqui` não será inserido como oitavo módulo: seu conteúdo necessário será distribuído nos estados vazios das sete seções, preservando a ordem obrigatória.

## 9. Arquivos previstos

### Alterar

- `src/pages/Index.tsx`
- `src/components/home/HomeHeader.tsx`
- `src/components/home/PeriodPicker.tsx`
- `src/components/home/HeroDisponivelCard.tsx`
- `src/components/home/RitmoUnificadoCard.tsx`
- `src/components/home/QuickActions.tsx`
- `src/components/home/EmotionalCheckinCard.tsx`
- `src/components/NotificationBell.tsx`
- `src/components/assessor/AssessorFab.tsx`
- `src/lib/hooks/useFinancialSnapshot.ts`
- `src/lib/nino/diagnosis.ts` — somente adaptar campos de apresentação/confiança; sem mudar contrato ou RPC
- `src/index.css`
- `tailwind.config.ts`
- `src/test/home-composition-privacy.test.ts`
- `src/test/spending-rhythm.test.ts`
- `src/test/spending-projection-v5.test.ts`
- `src/test/nino-home-adapter.test.ts`

### Criar

- `src/components/home/NinoGuidanceCard.tsx`
- `src/components/home/AvailableBalanceDetails.tsx`
- `src/components/home/RhythmMethodSheet.tsx`
- `src/test/home-guidance.test.tsx`
- `src/test/home-states.test.tsx`

### Remover após confirmar referências novamente na execução

- `src/components/home/AssistantTipCard.tsx`
- `src/components/home/PrevisaoFechamentoCard.tsx`
- `src/components/home/PatrimonioSheet.tsx`

`HomeHeader`, `PeriodPicker`, `HeroDisponivelCard`, `RitmoUnificadoCard` e `EmotionalCheckinCard` podem ser renomeados fisicamente para os nomes finais apenas se a busca de imports confirmar uso exclusivo da Home; a preferência é evitar renomeação sem ganho funcional.

## 10. Testes e critérios verificáveis

### Unidade/contrato

- Confirmar `availableToday` sem investimentos/limite e sem recomposição no componente.
- Confirmar equação de `projectedEndBalance` e ausência de cálculo dessa equação em JSX.
- Confirmar dias sem gasto como zero, série líquida diária, reembolso e janelas comparáveis.
- Confirmar exclusão de transferência, investimento, pagamento de fatura e liquidação já representada.
- Confirmar que o adaptador preserva `snapshot_id`, conclusão, contraponto, forecast e ação vinculada.
- Confirmar que ação ausente/inválida não gera CTA.
- Confirmar que baixa confiança produz linguagem condicional e não percentual destacado.
- Confirmar privacidade em valor, tooltip, resumo do gráfico e detalhes de projeção.

### Composição/integração

- Teste estrutural passa a exigir exatamente sete seções na ordem aprovada.
- Teste garante apenas uma grande superfície escura e ausência das superfícies independentes de projeção/ação.
- Teste do erro/partial loading garante que campo ausente não renderiza `R$ 0,00`.
- Teste do seletor cobre mês, 30d, 90d, personalizado válido/inválido e label correspondente ao range efetivo.
- Teste do check-in preserva leitura/edição do registro de hoje.

### Verificação visual e funcional

- Capturas autenticadas nos quatro viewports, sem full-page automático, verificando dobra inicial, overflow, tooltip por toque, Sheet, foco, privacidade e estados vazios.
- Auditoria de contraste e árvore acessível; gráfico compreensível sem cor.
- Executar testes seletivos, suíte existente, typecheck e build.
- Navegar pelos quatro atalhos, ação do diagnóstico, composição, notificações, check-in e FAB.
- Confirmar ausência de mudanças na landing page, rotas, banco, Nino, Relatórios e WhatsApp.

## 11. Backend, RPCs e dependências

- **Não é necessário novo backend, migration, tabela, função ou RPC.** Os campos necessários já existem no snapshot financeiro e no diagnóstico v1.1.
- RPC mantida: `my_nino_diagnosis_context` via `useNinoDiagnosisContext()`.
- Hook financeiro mantido: `useFinancialSnapshot()`; ele será endurecido para estados de erro/parcialidade, sem alterar fórmulas.
- Dependências existentes suficientes: Recharts, Radix/shadcn, Phosphor e React Query. Nenhum pacote novo.
- Não será criado vínculo artificial entre o `snapshot_id` do diagnóstico e o snapshot financeiro client-side.
- A única informação solicitada mas não disponível é “principal contribuição” por ponto do gráfico; por ser opcional, será omitida. Se ela se tornar obrigatória, isso exigirá aprovação separada para estender o motor compartilhado, não a RPC da Home.

## 12. Riscos e mitigação

- **Risco de narrativa divergente:** forecast editorial e projeção numérica podem descrever horizontes diferentes. Mitigação: exibir a projeção numérica somente quando for coerente com a situação principal; detalhe identifica período e confiança, sem reescrever a conclusão.
- **Risco de parcialidade silenciosa:** queries auxiliares hoje não participam integralmente de `loading/error`. Mitigação: consolidar status no hook antes de redesenhar estados.
- **Risco de vazamento por acessibilidade:** Recharts e textos auxiliares podem conter valores. Mitigação: único formatador privado em toda saída visual e acessível.
- **Risco de regressão nas rotas de ação:** não usar heurística no CTA principal; validar diretamente a rota canônica segura já vinculada à ação.
- **Risco de semântica emocional:** novos rótulos podem fragmentar histórico. Mitigação: validar consumidores de `trigger_label` e manter mapeamento compatível sem migration.
- **Risco visual sem sessão:** a auditoria não conseguiu abrir a Home autenticada. Mitigação: a execução não será considerada pronta sem comparação visual autenticada nos quatro viewports.

## 13. Ordem segura de implementação

1. Congelar contratos com testes de snapshot, ritmo, diagnóstico, ação e privacidade.
2. Endurecer `useFinancialSnapshot()` para loading, erro e parcialidade sem tocar nas fórmulas.
3. Consolidar tokens semânticos e remover a terceira paleta paralela da Home.
4. Refatorar cabeçalho e seletor de período.
5. Refatorar o card de disponível e seu detalhe, removendo patrimônio desse contexto.
6. Refatorar ritmo, tooltip, explicação e acessibilidade.
7. Criar `NinoGuidanceCard` e absorver leitura, projeção e ação.
8. Remover os três módulos antigos do layout e distribuir onboarding nos estados vazios.
9. Unificar atalhos, check-in e reduzir ênfase do FAB sem alterar funções.
10. Executar testes, typecheck e build; corrigir somente regressões do escopo.
11. Validar visualmente e funcionalmente nos quatro viewports com sessão autenticada.
12. Apresentar evidências para aprovação. **Não publicar sem autorização explícita posterior.**

## 14. Critério final de aceite

A rodada estará concluída somente quando a Home tiver exatamente sete seções, uma única superfície escura, uma única narrativa do Nino, valores vindos exclusivamente dos contratos atuais, nenhuma ação fabricada, nenhum zero usado para campo ausente, privacidade integral, tooltip por toque, contraste AA e validação autenticada em mobile, tablet e desktop — sem backend novo, sem mudança contábil e sem publicação automática.