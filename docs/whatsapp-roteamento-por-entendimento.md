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

## Segundo incidente (15/10, 11:18): "Que registro é esse?" respondido com a cobrança do rolê
O classificador de entendimento rodou, mas recebeu como contexto **só** as mensagens de cobrança. Sem enxergar o aviso de
"Registrei R$ 500…" mandado 1 minuto antes, só havia um assunto possível e ele escolheu o rolê.
Regra: o entendimento precisa receber a **conversa real** (últimas mensagens de qualquer assunto, com há quantos minutos e se é
sobre o rolê), com a mais recente em destaque. Contexto montado só com as evidências de uma hipótese produz essa hipótese.

## Aviso proativo de "gasto novo" só para fato recente
O gatilho `nino_tx_behavioral_event` marcava LARGE_SPEND para qualquer lançamento confirmado, inclusive um de 27/05 vinculado
a uma dívida; o Nino anunciou "Registrei R$ 500" 16 h depois. Agora só gera evento se `occurred_at` for de até 3 dias atrás.

## Mensagem automática precisa de contexto (15/10)
"Registrei R$ 500,00 em um gasto relevante" obrigou a pessoa a perguntar "que registro é esse?". Regra: toda mensagem que o
Nino inicia sobre um lançamento/meta/dívida diz **do que está falando** (descrição, categoria, valor, quando) e nunca depende de a
pessoa adivinhar. O evento comportamental passou a carregar `category_name`, `goal_name` e `debt_name`, e
`describeEventForMessage` monta o "quê · quanto · quando". Sem descrição, a mensagem admite isso ("um lançamento sem descrição")
em vez de ficar solta. Novos templates automáticos devem usar o mesmo helper e ter teste com um caso real.

## Notificação "Isso parece acontecer todo mês" (15/10)
Texto recebido: "Tem um comportamento se repetindo: as despesas ocorrem periodicamente. O valor típico é R$ 202,59 e foram registradas 3
ocorrências." Quatro falhas encadeadas: (1) o detector sabia que era a "Claro" mas não passou o nome na evidência nem no texto;
(2) o título fixo do template apagou o título específico; (3) o redator recebeu só números e uma abertura vaga; (4) nada exigia
que a mensagem dissesse do que fala. Contrato novo: `evidence.subject` → o redator é obrigado a citá-lo e a guarda reprova
(`missing_subject`) e cai no texto do motor; título do template não apaga o assunto; "ocorrências/periodicamente" viram jargão barrado.
Também corrigido no SQL do diagnóstico: valor "R$ 1,316.16" (locale) e dívida atrasada sem nome / "1 dias".
