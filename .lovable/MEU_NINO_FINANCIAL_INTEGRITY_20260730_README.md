# MeuNino — integridade financeira e experiência

## Objetivo

Este patch corrige a confirmação de faturas, preserva créditos e antecipações,
melhora a categorização, unifica o cálculo de ritmo entre Home e Relatórios,
libera a categoria de reembolsos da Divisão do Rolê e reformula a experiência
emocional.

## Ordem de implantação

1. Aplicar o patch sobre a `main` atual.
2. Executar a migration
   `20260730123000_financial_import_integrity_hotfix.sql`.
3. Implantar as Edge Functions:
   - `assistant-ingest-document`
   - `assistant-review-actions`
   - `insights-generate`
   - funções que empacotam `_shared/agent` no fluxo do assessor/WhatsApp.
4. Configurar `AI_MODEL_REASONING` com um modelo de raciocínio suportado pelo
   gateway. O fallback do código é `google/gemini-2.5-pro`.
5. Executar `npm test` e `npm run build`.
6. Validar em homologação antes de publicar.

## Smoke tests obrigatórios

- Importar uma fatura com compra, parcela, estorno e antecipação.
- Confirmar que `compras - créditos - pagamentos = total oficial`.
- Simular falha em uma linha e confirmar que a revisão não fecha nem perde
  edições; corrigir e repetir.
- Conferir que o último ponto do gráfico tem os mesmos valores de média total e
  ritmo típico exibidos na Home.
- Editar somente a categoria de um recebimento da Divisão do Rolê.
- Criar uma categoria de receita no seletor e aplicá-la ao reembolso.
- Colar um JSON com categoria, parcela e crédito no assessor e conferir o total
  líquido antes da confirmação.

## Critérios de aceite

- Nenhuma compra de cartão movimenta conta corrente no momento da compra.
- Pagamento/antecipação da fatura não vira nova despesa nem receita.
- Estorno reduz o consumo e a fatura.
- Dias sem gastos entram no denominador da média.
- Home e Relatórios usam `spending_rhythm.v2`.
- Confirmação parcial permanece aberta, informa a falha e permite retry.
- Categorias editadas pelo usuário têm origem auditável.
