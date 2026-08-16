# Correção do lançamento que falhou ("KFC, R$ 50,40")

## O que realmente aconteceu

Rastreei o turno pelos registros do backend (mensagens, execuções do agente e chamadas de ferramenta):

1. 19:12:14 — você pediu: "registre esse lançamento de cinquenta reais e quarenta centavos feitos no KFC hoje". O valor veio **escrito em palavras**. O interpretador determinístico só entende dígitos (`R$ 50,40`), então não encontrou valor nenhum, classificou a mensagem como "desconhecida" e o turno caiu na capacidade genérica — não na de registro.
2. Sem a capacidade de registro, **nenhuma ferramenta foi chamada**: o cartão "Certo! Rascunhei aqui: … Confirma?" foi *escrito pelo modelo*, não gerado pelo sistema. Não existe nenhum rascunho salvo desse lançamento na base.
3. 19:12:35 — "Alimentação" apenas fez o modelo repetir o mesmo cartão inventado. Ainda sem ferramenta, ainda sem rascunho salvo.
4. 19:12:53 — "Confirmo" não tinha nada para confirmar. O modelo então tentou criar o rascunho, mas enviou os dados **sem o campo de tipo** (despesa/receita) e a ferramenta recusou (`invalid_type`). Resultado: "Ops, algo deu errado e não consegui registrar seu lançamento."

Ou seja: três falhas somadas — valor por extenso não reconhecido, cartão de rascunho podendo ser inventado pelo modelo, e a ferramenta de rascunho recusando em vez de inferir o óbvio.

## Correções

### 1. Valor em palavras passa a ser entendido
Novo leitor de números por extenso em pt-BR no interpretador: "cinquenta reais e quarenta centavos", "mil e duzentos", "cem", "trinta e sete", "duzentos e cinquenta", "meia" (0,50), "dois mil reais". Com o valor lido, a mensagem volta a ser classificada como lançamento e entra na rota de registro. Isso vale igualmente para texto e áudio, porque áudio transcrito entra no mesmo pipeline.

### 2. Pedido explícito de registro obriga a ferramenta
Quando a mensagem tem intenção clara de registrar ("registre", "lança", "anota", "gastei", "paguei", "comprei", "recebi") a capacidade passa a ser **registro com ferramenta obrigatória**: o turno só pode terminar em rascunho de verdade (salvo na base) ou em uma pergunta curta pelo dado que falta. Nada de resposta livre.

### 3. Cartão de rascunho nunca mais pode ser inventado
Guarda no validador de resposta: se o texto parece um rascunho/confirmação ("Rascunhei", "Confirma?", cartão com valor e categoria) e **nenhuma** ferramenta de rascunho foi executada com sucesso, a resposta é descartada e o registro é refeito pelo caminho determinístico. O usuário só vê "Confirma?" quando existe algo salvo para confirmar.

### 4. Tipo do lançamento é inferido, não recusado
`create_transaction_draft` passa a inferir despesa/receita a partir do próprio pedido (verbos de gasto x "recebi/salário/entrou/pix recebido") em vez de falhar com erro técnico. Recusa só permanece quando a frase é genuinamente ambígua — e aí a saída é uma pergunta, não um erro.

### 5. "Alimentação" e "Confirmo" passam a fazer sentido
- Resposta curta de categoria/data/meio de pagamento após um rascunho retoma o mesmo lançamento e o salva de fato (mesma mecânica de retomada já usada na simulação de gasto e na consultoria).
- "Confirmo" sem nada pendente responde com honestidade e ação: reconstrói o lançamento a partir da própria conversa e oferece registrar, em uma linha. Nunca "algo deu errado".

### 6. Fim da mensagem de erro genérica em registro
Falha de ferramenta em registro passa a produzir resposta específica sobre o dado que faltou ("não peguei o valor", "faltou dizer se foi gasto ou recebimento"), com o que já foi entendido preservado. "Ops, algo deu errado… tente novamente" deixa de ser uma saída possível nesse fluxo, e a proibição entra também nas instruções do assistente.

## Notas técnicas

- Arquivos: `_shared/agent/parser.ts` (novo leitor de extenso), `core/CapabilityRouter.ts` (registro com ferramenta obrigatória + retomada de slot de lançamento), `agent/tools.ts` (inferência de tipo, erros específicos), `core/ResponseValidator.ts` (guarda de rascunho inventado), `core/AgentCore.ts` (confirmação sem pendência), `agent/prompt.ts` (proibição de cartão sem ferramenta).
- Sem migration, sem mudança em motores financeiros, ledger, autenticação ou cálculo. O registro continua passando por `pending_confirmations` + RPC de execução, com confirmação explícita.
- Testes: valor por extenso (incluindo centavos e "mil"), rota obrigatória de registro, cartão inventado bloqueado, tipo inferido, retomada por categoria, "Confirmo" sem pendência. Suíte completa e depois deploy de `agent-chat`, `agent-run` e `whatsapp-webhook`.

## Entrega
Relatório com IMPLEMENTADO / TESTADO / NÃO IMPLEMENTADO (+motivo) / ARQUIVOS / TESTES, e o cenário do KFC reproduzido ponta a ponta.
