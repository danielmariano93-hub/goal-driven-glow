# Meu Nino — fatura atômica, histórico e MCP

Base obrigatória: `f9795ed1d85dc063fc5c00cbf77fa511a7f3ba12` (`Added MCP agent integrations`).

## Ordem de implantação na Lovable

1. Aplicar `supabase/migrations/20260731120000_invoice_atomic_save_and_statement_payment.sql`.
2. Fazer deploy de `assistant-review-actions`.
3. Executar `npm run build` para regenerar o bundle MCP e confirmar que `supabase/functions/mcp/index.ts` contém `list_card_statements` e `settle_card_statement`.
4. Fazer deploy da função `mcp`.
5. Executar typecheck, testes e build. Não publicar o frontend antes de reportar as evidências.
6. Após aprovação, publicar o frontend.

## Recuperação da revisão que já foi editada

Não reprocessar o PDF, não apagar `extracted_items` e não sobrescrever linhas com `user_edited_at` preenchido.

Localizar a importação de fatura mais recente do proprietário do projeto cujo status esteja em `needs_review`, `partially_confirmed` ou `failed`. Reportar antes: `document_id`, status, quantidade total, quantidade editada pelo usuário, confirmada, pendente e ignorada.

Se houver somente uma candidata inequívoca, executar a confirmação usando os IDs das linhas não ignoradas/não rejeitadas por meio de `confirm_invoice_import_atomic`, com a identidade daquele usuário e chave `lovable-recovery:<document_id>:20260731`. A função deve validar a conciliação antes e fazer rollback integral em qualquer erro. Não alterar valores, descrições, categorias, parcelamentos, cartão ou decisões do usuário para forçar fechamento.

Se a conciliação não passar, não aprovar artificialmente. Retornar o JSON completo de validação (`difference`, `gap_section`, `gap_amount`, subtotais) e manter a revisão pronta para o usuário corrigir sem refazer edições.

## Evidências exigidas

- Uma falha simulada em `finalize_invoice_statement` não deixa transações, status ou fatura parciais.
- Retry com a mesma chave não duplica lançamentos nem pagamentos.
- A revisão antiga abre com linhas já confirmadas pelo fluxo legado selecionadas para recuperação.
- Cartões mostra todas as faturas e tags: em aberto, parcial, paga, atrasada e revisar.
- Pagamento integral e parcial atualizam conta, pagamento, alocação, fatura e parcelas na mesma transação.
- Pagamento da fatura tem `movement_kind=card_payment` e não entra novamente em consumo/receita.
- MCP lista faturas e exige `confirmed_by_user=true` + `idempotency_key` para baixar pagamento.

## Rollback

Reverter o frontend e as duas Edge Functions. As novas funções SQL podem permanecer sem uso; para remoção explícita: `DROP FUNCTION public.confirm_invoice_import_atomic(uuid,uuid[],text);` e `DROP FUNCTION public.settle_credit_card_statement(uuid,uuid,numeric,date,text);`.
