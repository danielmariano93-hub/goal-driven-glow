# Nino: respostas curtas deixam de ser coladas na pergunta anterior

## O que aconteceu (confirmado nos dados)

Às 20:39 (SP) de 19/08 você escreveu "Estou me sentindo atento". A resposta enviada foi:
"Não vou te dar número que eu não consiga provar... me diga a categoria e o período".

Nada foi registrado: o último check-in emocional no banco é de 18/08. O turno rodou com a
capacidade `money_leaks` (vazamentos de dinheiro), não com o check-in emocional.

Causa provada: o Nino tratou sua frase como **complemento da conversa anterior**. A regra de
continuação considera "continuação" qualquer mensagem com 6 palavras ou menos que não cite
palavra financeira. Sua frase tem 4 palavras, então ela foi **colada na sua pergunta anterior**
(sobre gastos/metas) e reroteada para a rota financeira. O roteador sozinho acerta: testado com
"Estou me sentindo atento", ele decide corretamente pelo check-in emocional. Quem quebra é a
colagem.

Isso não afeta só emoção. Toda resposta curta e autossuficiente sofre o mesmo: "cansado",
"pode registrar", "no crédito", "foi ontem", "obrigado, e agora?" — todas podem ser grudadas na
pergunta financeira anterior e sair com resposta desconexa.

## O que vai mudar

### 1. Continuação deixa de ser "mensagem curta"

Só é continuação quando a mensagem **realmente depende** da anterior: começa com conector
("e...", "no mês passado", "e em agosto"), traz só período/pronome demonstrativo
("nessa categoria", "o mesmo"), ou é pergunta truncada ("quanto?"). Frase autossuficiente
— sujeito + verbo, resposta a uma pergunta do Nino, declaração de sentimento — nunca é colada.

### 2. Uma rota determinística nunca é atropelada pela continuação

Quando a mensagem crua já tem motor determinístico próprio (check-in emocional, registro,
dívida, meta, snapshot), a herança de assunto não pode trocar a rota. A herança passa a agir
apenas quando a leitura crua ficou em "geral".

### 3. O Nino passa a lembrar o que ele perguntou

Quando o Nino faz uma pergunta que espera resposta (lembrete de humor, "qual valor?",
"qual cartão?"), fica gravado na memória da conversa um "aguardando: X" com validade curta.
A próxima mensagem é lida como resposta a esse X. Assim, "cansado", "atento", "no crédito"
ou até um emoji são entendidos, mesmo sem palavra-chave.

### 4. Sentimento reconhecido com mais naturalidade

Resposta de uma palavra, nota de 1 a 5, emoji e frases como "hoje foi um dia pesado",
"tô meio pra baixo", "dia bom" passam a resolver para o catálogo oficial de emoções
(tranquilo, atento, preocupado, confiante, impulsivo, frustrado, celebrando, culpado).
O texto original vira observação do registro, sem inventar sentimento que você não disse.
Se ainda assim não der para reconhecer, o Nino pergunta em uma linha — nunca responde
sobre outro assunto.

### 5. Registrar sentimento passa a devolver algo útil

Hoje o recibo é seco. Depois de registrar, o Nino sempre entrega em seguida um retorno
determinístico: a associação observada entre esse sentimento e o seu gasto (quando o seu
histórico já permite), ou o gasto de hoje comparado ao seu padrão do mesmo dia da semana,
com um passo pequeno e concreto. Sempre a partir dos motores canônicos — nada estimado.

### 6. Recusa honesta deixa de pedir "categoria e período"

A mensagem de bloqueio por falta de prova só fala de categoria/período quando a pergunta era
financeira. Em qualquer outro caso, o Nino responde de forma coerente com o que foi dito.

## Detalhes técnicos

- `ConversationOrchestrator.ts`: reescrever `isContextOnly` — remover o critério "≤ 6 palavras"
  e exigir marcador explícito de dependência (conector inicial, período isolado, anáfora,
  pergunta truncada). `buildTurnPlan` ganha o motivo da decisão para auditoria.
- `AgentCore.ts`: a reclassificação por `followup`/`composed` (linhas ~428-434) só substitui a
  capacidade quando a leitura crua é `general`; caso contrário mantém a rota determinística.
- Novo `ConversationExpectation`: campo `awaiting` (`{ kind, slots, asked_at }`) em
  `ConversationMemory`, gravado quando o turno termina em pergunta (`reply_kind: "question"`)
  e quando o proativo de humor é enfileirado (`ProactiveEngineV2` / `CommunicationDispatcherV3`,
  kind `emotional_checkin_due`). TTL curto (12h) e consumo no turno seguinte, antes do
  `CapabilityRouter`; `awaiting.kind = "emotional_checkin"` força
  `capability = emotional_checkin` com `required_tool = log_emotional_checkin`.
- `emotionParse.ts`: ampliar sinônimos (dia pesado, pra baixo, dia bom, na correria, sem
  paciência…), aceitar emoji (😌🙂😟😤😞⚡🎉) e resposta de palavra única; manter catálogo
  canônico como única saída.
- `tools.ts` (`log_emotional_checkin`): guardar o texto original em `notes` quando não houver
  observação explícita e devolver sempre `prospective_signal` a partir de
  `emotionFinance.ts`/snapshot canônico.
- `DeterministicAnswers.ts` (`formatEmotionalCheckin`): recibo + retorno útil + convite curto;
  estado "sem histórico suficiente" explícito, sem número inventado.
- `AgentCore.ts` (~879): mensagem de bloqueio do Truth Gate condicionada a pergunta financeira.
- Testes em `src/test/`: colagem indevida (frase curta autossuficiente não herda assunto),
  resposta ao lembrete de humor registra e responde com retorno útil, "atento"/emoji/nota 4
  resolvem para o catálogo, e uma pergunta financeira curta de continuação real ("e em agosto?")
  continua herdando o assunto.

Sem mudança de esquema no banco (a expectativa vive no estado da sessão já existente).
