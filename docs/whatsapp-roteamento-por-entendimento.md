# WhatsApp: roteamento por entendimento (não por palavra-chave)

## Incidente de 15/10/2026
Atalho `!ja … Registre esse novo gasto … Valor: R$ 30,00` respondido com "Sua parte pendente em «rolê» é R$ 20,00".
Causa: um filtro anterior ao agente (`detectParticipantIntent`) casava a palavra "valor" com "perguntando o valor da dívida do rolê"
e, como havia cobrança nas últimas 24 h (cobranças atrasadas saem 2×/dia), o filtro estava sempre aberto. O comando do produto
(`!ja`) só era reconhecido DEPOIS, dentro do agente, então nunca chegou lá.

## Regra de arquitetura
1. **Sinais explícitos** decidem sozinhos (não são palpite): comando do produto (`!ja`), responder/citar a cobrança,
   responder à pergunta que o próprio Nino fez.
2. **Todo o resto é entendimento**: `inboundAddressee` lê a mensagem com o contexto e responde a quem ela se dirige
   (`split_charge` × `own_finance` × `unclear`). Só age como cobrança com confiança ≥ 0,85; incerteza → pergunta;
   modelo fora do ar → fluxo normal (o produto principal), nunca o do rolê.
3. **Palavra-chave não decide destino.** O teste `split-reply-target` falha se o roteador voltar a usar o classificador por palavras.
4. Toda decisão registra `basis` (explícito / entendimento / falha segura), confiança e erro no log `split_reply_decision`.

## Como evitar a próxima
- Novo "desvio" antes do agente precisa: (a) sinal explícito OU leitura de entendimento; (b) caso de teste com o texto real do
  fluxo mais usado (registro de gasto) **dentro** do contexto novo; (c) falha segura = fluxo normal.
- Monitorar: mensagens com atalho cuja resposta seguinte foi `split_support` (deve ser zero).
