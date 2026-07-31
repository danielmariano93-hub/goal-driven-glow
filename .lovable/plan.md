## Diagnóstico (verificado no banco e no código)

1. **Editar lançamento dá erro — causa confirmada:** existem **duas versões** da função `update_credit_card_statement_item` no banco (uma com 3 parâmetros, outra com 6). Quando o app chama a função, o backend não consegue escolher entre elas e devolve erro de ambiguidade. Causa secundária provável (a confirmar na reprodução): o gatilho `sync_card_accounting_from_transaction` roda ao alterar o valor da transação e pode conflitar com o item de fatura já existente.

2. **Excluir rascunho dá erro — causa ainda não confirmada.** A fatura em revisão (`f89d85b2…`, total oficial R$ 4.636,08) não tem pagamentos, então a regra de bloqueio não deveria ativar. A hipótese principal é falha na exclusão das transações da importação por causa de gatilhos (split/investimento/cartão). O primeiro passo do plano é reproduzir e capturar a mensagem exata antes de corrigir.

3. **Valores positivos da fatura não existem — confirmado.** Os 44 itens gravados são só `purchase` (26) e `installment` (18). Não há nenhum item de `payment`, `refund` ou `adjustment`. Por isso os itens somam R$ 5.716,71 contra R$ 4.636,08 oficiais: falta exatamente a **linha de pagamentos/créditos de R$ 1.080,63**. Hoje a tela só permite editar itens existentes — não permite **adicionar** nem **excluir** item, então é impossível fechar a conciliação.

4. **Não existe "forçar conciliação" — confirmado.** Nenhuma função ou botão de fechamento assistido existe; aprovar fica bloqueado para sempre quando há divergência.

5. **Aba do Nino:** o hub tem duas visões, "Meu plano" e "O que aprendeu". A segunda expõe mecânica de aprendizado, que não é o que o usuário quer.

## O que será feito

### A. Backend de fatura (uma migration)
- Remover a versão antiga de 3 parâmetros de `update_credit_card_statement_item`, deixando uma assinatura única (fim do erro de ambiguidade); tornar os parâmetros econômicos opcionais.
- Aceitar valores de crédito: item de tipo `payment`/`refund`/`adjustment` passa a **subtrair** do total conciliado, com sinal tratado no servidor (o usuário digita valor positivo e escolhe o tipo).
- Novas funções:
  - `add_credit_card_statement_item` — inserir linha faltante (compra, pagamento, estorno, juros, tarifa, ajuste), criando a transação correspondente só quando fizer sentido contabilmente (pagamento/estorno não criam despesa).
  - `delete_credit_card_statement_item` — remover linha duplicada e a transação criada por ela.
  - `force_reconcile_credit_card_statement(p_statement_id, p_justification)` — cria **um item de ajuste explícito** com a diferença restante, zera a divergência, grava justificativa e trilha de auditoria, e marca a fatura como conciliada manualmente. Sempre auditável, nunca silencioso.
- Endurecer `discard_credit_card_statement`: exclusão em ordem segura (itens → transações → fatura), com mensagens de erro específicas em vez de erro genérico, e idempotência preservada.
- Todas as funções: `security definer`, `search_path` fixo, `EXECUTE` só para `authenticated` e `service_role`.

### B. UI da fatura (`src/pages/Cartoes.tsx`)
- Painel de conciliação no topo mostrando de forma explícita: **Total oficial · Compras/parcelas · Pagamentos e créditos · Diferença**, com a diferença sempre explicada em texto ("faltam R$ X em pagamentos/créditos não extraídos").
- Botão **"Adicionar pagamento/crédito da fatura"** e **"Adicionar lançamento"**, com formulário curto (tipo, descrição, valor, data, categoria).
- Ícone de excluir em cada linha.
- Botão **"Fechar conciliação com ajuste"** (o "forçar conciliação"), habilitado quando a diferença é diferente de zero, exigindo confirmação e uma justificativa curta; após isso, aprovar e pagar são liberados.
- Erros passam a exibir a mensagem real traduzida (nada de toast vazio), e todas as ações revalidam a fatura no servidor após executar (read-after-write).
- Mesmo layout funcional em mobile e desktop; botões nunca ficam desabilitados sem explicar o motivo.

### C. Aba do Nino
- Remover a visão "O que aprendeu" do hub. A aba passa a ter foco único: **o que está acontecendo e o que fazer**.
- Cada insight vira um cartão com: título direto, número que sustenta a afirmação, **de onde veio o dado** (período, categoria, nº de lançamentos considerados) e **uma ação** ("ver lançamentos", "ajustar meta", "registrar pagamento").
- Estado vazio honesto quando não há amostra suficiente, em vez de texto genérico.
- Controle de memória/dados do Nino não desaparece: fica acessível como link discreto em Perfil, para quem quiser corrigir dados.
- Nenhum insight sem lastro: só é exibido o que o motor consegue justificar com dados do próprio usuário.

### D. Verificação
- Reproduzir com Playwright na fatura real: editar item, adicionar pagamento de R$ 1.080,63, ver diferença ir a zero, aprovar; em outra fatura, excluir rascunho.
- Testes de regressão para as novas funções (sinais de crédito, ajuste forçado auditado, exclusão) e execução da suíte completa + build.
- Sem publicação em produção sem sua autorização.

## Detalhes técnicos
- Arquivos: nova migration em `supabase/migrations/`, `src/pages/Cartoes.tsx`, `src/pages/NinoHub.tsx`, `src/pages/AssessorAcompanhamentoV2.tsx`, novo teste em `src/test/`.
- `reconciliation_difference` é coluna gerada (`stated_total - reconciled_total`); o ajuste atua em `reconciled_total` via item de ajuste, sem alterar o total oficial do documento.
- Nenhuma alteração em MCP, WhatsApp, autenticação ou identidade visual.
