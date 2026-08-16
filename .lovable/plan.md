# Por que o lançamento falhou de novo (16/08, 19:59)

Rastreei o turno pelos registros de execução e chamadas de ferramenta:

1. Você mandou "Registre essa despesa" com o cartão colado (R$ 50,40 — KFC — Alimentação — 16/08). A rota certa foi escolhida (`transaction_entry`) e a ferramenta de rascunho **foi** chamada, com valor, descrição, categoria e data corretos.
2. A ferramenta recusou com `account_not_found`. Motivo real: **nenhuma conta foi informada** e o resolvedor devolve "não encontrei" quando o campo vem vazio — mesmo você tendo **uma única conta ativa** ("Banco Itau"). Ou seja, ele pediu um dado que já era óbvio a partir dos seus próprios dados.
3. Sem rascunho salvo, o modelo escreveu a pergunta em prosa livre e ainda **inverteu o papel**: "Ah, Nino! Esqueci de perguntar em qual conta foi esse gasto." — falou como se fosse você.
4. Você respondeu "Sim". Como nada havia sido salvo, a confirmação caiu na resposta seca "Não encontrei nada pendente para confirmar", perdendo um lançamento que estava 100% completo.

Resumo: um dado inferível (conta única) virou bloqueio; o bloqueio virou prosa com persona errada; e a confirmação virou beco sem saída.

## Correções

### 1. Conta única deixa de ser pergunta
Quando o pedido não menciona conta, o rascunho passa a usar a conta padrão do usuário: se existe **exatamente uma** conta ativa, ela é usada sem perguntar. Com duas ou mais, a pergunta continua — mas determinística e listando os nomes reais ("Em qual conta eu registro? (Banco Itau, Nubank)"), nunca prosa inventada. Vale para lançamento por texto, áudio e para o fluxo `!ja`, que já se comportava assim (era a origem da inconsistência).

### 2. Cartão colado é lido como lançamento estruturado
Mensagens no formato do próprio cartão do Nino ("• *Despesa:* R$ 50,40 / • *Descrição:* KFC / • *Categoria:* … / • *Data:* …") passam a ser interpretadas deterministicamente, com os campos extraídos direto das linhas, em vez de dependerem do modelo reler o texto.

### 3. Falha de lançamento nunca mais sai em prosa livre
`account_not_found` entra na mensagem honesta de falha de lançamento (com a lista de contas). Em turno de registro, se a ferramenta falhou, a resposta é sempre a pergunta determinística pelo dado que falta — o modelo não escreve nada nesse caminho.

### 4. Guarda de persona
Nova regra no validador de resposta: se o texto trata "Nino" como interlocutor ou fala na pele do usuário ("Ah, Nino!", "esqueci de perguntar" dirigido a si mesmo), a resposta é descartada e substituída pela versão determinística. A proibição também entra nas instruções do assistente.

### 5. "Sim" logo depois de um lançamento completo registra de fato
Confirmação sem pendência deixa de ser beco sem saída: quando o turno anterior foi um pedido de registro com valor e descrição legíveis, o sistema reconstrói o rascunho a partir daquela mensagem, salva e confirma no mesmo turno. Só se a mensagem anterior não tiver dados é que volta o "me conte a operação primeiro".

## Notas técnicas

- `agent/tools.ts`: `resolveAccountId` ganha resolução de conta padrão (única conta ativa) quando o hint é ausente/vazio; `create_transaction_draft` passa a devolver a lista de contas junto do erro quando há ambiguidade real.
- `agent/parser.ts`: leitor de cartão colado (linhas com Despesa/Receita, Descrição, Categoria, Data, Conta) alimentando o intent de transação.
- `core/ResponseValidator.ts`: `entryFailureMessage` cobre `account_not_found`; nova guarda `PERSONA_INVERSION_RX`.
- `core/AgentCore.ts` + `core/PolicyEngine.ts`: confirmação sem pendência reconstrói o lançamento do turno anterior antes de responder.
- `agent/prompt.ts`: proibição explícita de falar como o usuário ou endereçar "Nino".
- Sem migration, sem mudança em motores financeiros, ledger ou autenticação. Registro continua via `pending_confirmations` + RPC, com confirmação explícita.
- Testes: conta única resolvida sem pergunta, duas contas gerando pergunta com nomes, cartão colado interpretado, falha de conta com mensagem honesta, persona invertida bloqueada, "Sim" após lançamento completo salvando. Suíte completa e depois deploy de `agent-chat`, `agent-run` e `whatsapp-webhook`.

## Entrega
Relatório com IMPLEMENTADO / TESTADO / NÃO IMPLEMENTADO (+motivo) / ARQUIVOS / TESTES, com o cenário do KFC reproduzido ponta a ponta.
