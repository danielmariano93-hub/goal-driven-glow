# Voz das mensagens que o Nino inicia (benchmark)

## Referência
Notificação de um app de hábitos que o dono do produto admira (tela de bloqueio):

> **Eu fico de olho 👀**
> Mas o hábito é seu.
> Já deixei tudo preparado. Vamos revisar juntos?

## Por que funciona (critérios)
1. **Curta:** 3 frases de 3 a 5 palavras. Lê-se na tela de bloqueio sem abrir nada.
2. **Uma ideia por frase**, sem número solto e sem jargão.
3. **Primeira pessoa e calor humano:** parceiro que acompanha, não relatório.
4. **A decisão é da pessoa:** "o hábito é seu". O app apoia, não cobra.
5. **Reduz esforço:** o convite vem com o trabalho adiantado ("já deixei preparado").
6. **Um convite único para agir junto:** "Vamos revisar juntos?".

## O que o Nino soma (e a referência não faz na tela de bloqueio)
- **Dizer DO QUE se trata.** A referência depende de a pessoa já saber qual hábito é. O Nino fala de dinheiro concreto: o
  assunto (Claro, Celular, meta Lisboa) entra na 1ª frase ou no título.

## Regras do Nino (verificáveis, `checkNotificationVoice`)
- No máximo 3 frases, até 18 palavras cada (prompt do redator pede até 14).
- No máximo 2 números; nada de "R$ 1316.16" cru.
- Sem jargão: ocorrências, periodicamente, padrão, comportamento, amostra, score, diagnóstico.
- No máximo 1 pergunta, e ela fecha a mensagem.
- Se há assunto declarado (`evidence.subject`), ele aparece.

## Honestidade da voz
"Já deixei preparado" **só** é permitido quando a evidência traz `prepared` (algo realmente pronto, por exemplo uma regra
recorrente em rascunho). O redator recebe `PREPARADO: ...` apenas nesses casos e é proibido de prometer preparo sem isso.
Voz calorosa não pode virar promessa falsa.

## Antes e depois (textos reais da conta do dono, 08–15/10)
| Antes | Depois (já no código) |
|---|---|
| "Tem um comportamento se repetindo: as despesas ocorrem periodicamente. O valor típico é R$ 202,59 e foram registradas 3 ocorrências. Faz sentido pra você esse padrão?" | **“Claro” parece se repetir todo mês** — “Claro” apareceu 3 vezes, sempre perto de R$ 202,59. Quer que o Nino registre isso sozinho todo mês? |
| **Que tal colocar o Nino em dia?** "Percebi uma tendência sua: há 25 dias sem atualizar ou consultar seus dados, e nos últimos 30 dias você registrou apenas 6 atividades. Faz sentido pra você esse padrão?" | **Faz um tempinho que a gente não se fala** — Faz 25 dias que você não passa por aqui. O controle é seu, eu só ajudo. Leva 2 minutos: vamos retomar juntos? |
| **Como você está hoje?** "Um check-in de poucos segundos ajuda o Nino a entender o contexto das suas decisões, sem julgamento." | **Como você está hoje?** Sem julgamento, só para eu entender o seu dia. Posso te perguntar como você está? |
| Pergunta padrão do tom "comportamento": "Faz sentido pra você esse padrão?" | "Vamos olhar isso juntos?" |

## Próximos (não feitos)
Resumo da semana (período futuro e "sem alterações"), aviso por dia da semana ("Percebi uma tendência sua…"), ritmo/consumo
projetado. Cada um deve passar pela régua e ter teste com o texto real.
