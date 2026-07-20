# Categorização, Home e Pulso — contrato de implantação

Este pacote corrige, de forma integrada, os problemas de categorização, dicas,
Pulso Financeiro, dívidas, filtros e responsividade relatados em produção.

## Regras de categorização

- Uma categoria escolhida manualmente ensina somente o histórico do próprio usuário.
- O preenchimento em lote aplica apenas alias pessoal confirmado ou padrões universais de alta confiança.
- Transferências, aplicações, resgates, pagamentos de fatura, estornos e operações ambíguas nunca recebem categoria automaticamente.
- Itens que não atingirem confiança suficiente permanecem em **Sem categoria** para revisão humana.
- A tela de Movimentações permite buscar por nome/descrição, filtrar Sem categoria e executar a categorização segura.

## Correções funcionais

- **Nova dica** gera um insight diferente, atualiza o card imediatamente e informa rate limit/erro ao usuário.
- O Pulso deixa de esconder falhas de leitura ou gravação e oferece tentativa novamente.
- A Home exibe um filtro de período compacto e atalhos para Divisão do Rolê e Relatórios.
- Uma despesa categorizada como dívida não é inventada como saldo devedor: a Home orienta o usuário a cadastrar o saldo ainda devido.
- Cabeçalho, campos e seletor de categoria respeitam a largura do celular.

## Implantação obrigatória

O commit sozinho atualiza o frontend, mas as correções só ficam completas após:

1. aplicar `supabase/migrations/20260720193000_category_learning_and_safe_backfill.sql`;
2. implantar as Edge Functions `insights-generate` e `pulse-compute`;
3. publicar o frontend;
4. abrir **Movimentações → Sem categoria → Categorizar com segurança**;
5. revisar manualmente o que continuar sem categoria (é a proteção contra lançamentos contábeis incorretos).

## Aceite

- Buscar `Uber` retorna lançamentos cuja descrição contenha Uber.
- O filtro Sem categoria não mistura itens categorizados.
- Categorizar com segurança não altera aplicações, resgates, transferências nem faturas.
- Editar a categoria de um lançamento e salvar ensina lançamentos futuros equivalentes.
- Nova dica troca o conteúdo sem recarregar a página.
- O Pulso mostra resultado ou erro acionável; nunca um vazio enganoso.
- A edição de lançamento não cria rolagem horizontal em 320, 375 e 430 px.
- Divisão do Rolê e Relatórios aparecem como atalhos na Home.
