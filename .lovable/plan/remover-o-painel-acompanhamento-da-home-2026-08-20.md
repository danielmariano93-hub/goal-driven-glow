# Remover o painel "Acompanhamento" da Home

## Por que

A Home deve responder disponível → ritmo → explicação → projeção → ação. O bloco "Como você está" repete a natureza de highlight/insight e ocupa espaço nobre logo abaixo da orientação do Nino.

## Estado verificado

- O card aparece apenas na Home (`src/pages/Index.tsx`), alimentado por `useFinancialPerformance`.
- Os mesmos highlights de performance já têm superfícies dedicadas: seção de performance nos Relatórios Inteligentes e a área de acompanhamento do Nino (`/app/nino`).
- A captura de sinais de aprendizado por tópico (`registerTopicSignal`, sinais `opened`/`acted`) hoje existe **somente** dentro desse card no app. Removê-lo sem compensação apaga essa fonte de aprendizado no app.

## O que fazer

1. Remover o bloco de acompanhamento da Home: excluir o componente `AcompanhamentoCard`, o import e a chamada de `useFinancialPerformance` em `Index.tsx`. A ordem da Home passa a ser cabeçalho, período, disponível hoje, atalhos, orientação do Nino, ritmo, previsão de fechamento, compromissos e check-in emocional.
2. Preservar o aprendizado: mover a instrumentação `opened` / `acted` para as superfícies que continuam exibindo highlights (acompanhamento do Nino e seção de performance do relatório), mantendo o mesmo contrato de tópico e sinais — sem mudar motor, RPC ou cálculo.
3. Manter intactos os motores `financial_performance.v1`, snapshots e ranking do Advisor; nada de backend, migration ou lógica de negócio muda.

## Técnico

- Arquivos: `src/pages/Index.tsx`, remoção de `src/components/home/AcompanhamentoCard.tsx`, ajustes pontuais em `src/pages/AssessorAcompanhamentoV2.tsx` e `src/components/relatorios/ReportPerformanceSection.tsx` apenas para registrar os sinais.
- Nenhuma alteração de identidade, paleta, landing page, autenticação ou banco.

## Validação

- Rodar os testes existentes e conferir que nada mais importa `AcompanhamentoCard`.
- Verificar a Home autenticada em 390×844 e 1280×1800: sem espaço vazio, sem sobreposição e primeira viewport com saldo e início do ritmo.
- Confirmar que os highlights continuam visíveis nas superfícies dedicadas e que abrir/agir por lá ainda gera sinal de afinidade.
