# Auditoria dos áudios de hoje: por que as respostas confundiram (e o que era a resposta certa)

## O que você perguntou e o que o Nino respondeu

| Hora | Pergunta (áudio) | Resposta do Nino |
|---|---|---|
| 10:42 | "Qual o dia que eu tenho em média o maior gasto?" | "Quarta-feira, cerca de R$ 27,77 por ocorrência" |
| 10:43 | "Então sexta e fim de semana não é onde eu gasto mais em média?" | "Sábado tem o maior ticket médio, R$ 49,37 por compra" |

Ambas estão erradas, e por motivos diferentes. Verificado nos dados reais da sua conta.

## Qual era a resposta correta

Gasto de consumo confirmado nas últimas 12 semanas (24/05 a 16/08), por dia da semana:

```text
dia        total 12 sem.   média por dia da semana   dias com gasto
Segunda    R$ 12.829,37    R$ 1.069,11               8 de 12
Sexta      R$ 12.682,93    R$ 1.056,91               10 de 12
Quarta     R$  6.486,33    R$   540,53               8 de 12
Quinta     R$  3.657,61    R$   304,80               8 de 12
Terça      R$  3.025,90    R$   252,16               8 de 12
Sábado     R$  2.448,13    R$   204,01               7 de 12
Domingo    R$  1.291,61    R$   107,63               7 de 12
```

Resposta honesta: **segunda e sexta são os seus dias pesados e estão praticamente empatados** (R$ 1.069 x R$ 1.057 por dia da semana); sexta é a mais frequente (10 das 12 semanas). Sábado e domingo são os seus dias mais leves, não os mais pesados. Ou seja: sua intuição sobre sexta estava certa, e as duas respostas do Nino ("quarta" e "sábado") estavam erradas.

Também importa dizer no ar que parte dessas datas vem do extrato do banco (data de lançamento), o que empurra compras de fim de semana para segunda. Isso muda a leitura de "segunda" e precisa ser dito, não escondido.

## Por que o Nino errou (causa confirmada nos dados)

1. **76% dos seus lançamentos são descartados do cálculo comportamental.** 264 despesas confirmadas (R$ 27.096,83) vêm de importação com `behavior_date_source = bank_posting_date` e confiança 0,35. O motor semanal exige confiança >= 0,65, então ele respondeu olhando só os ~89 lançamentos digitados à mão (R$ 5.209,23) e, dentro disso, só o "gasto ajustável" (R$ 2.839,53 nos últimos 84 dias). Daí sair "R$ 27,77" — um número que não corresponde a nada que você reconheça.
2. **A métrica publicada não é uma média.** O motor divulga `mediana dos dias ativos x taxa de dias ativos` chamando isso de "por ocorrência". É um índice interno, não responde "em média".
3. **Troca silenciosa de métrica entre os dois turnos.** O primeiro turno entrou pela rota `weekday_pattern`; o segundo caiu em rota genérica e o modelo escolheu "ticket médio por compra" por conta própria, respondendo outra pergunta e contradizendo o turno anterior sem reconhecer a contradição.
4. **Nenhuma das respostas disse o período** (12 semanas) nem a base do número, então não havia como você conferir.
5. **Os fatos diários estão atrasados:** a última linha de `behavioral_daily_facts` é 14/08, e faltam dias no período — o cálculo roda sobre uma janela incompleta.

## O que fazer (correção)

1. **Reabilitar as datas do extrato com transparência.** Lançamentos com data de postagem bancária entram na série semanal com peso e rótulo próprios, em vez de serem descartados. A resposta passa a incluir a ressalva de que datas de extrato concentram em dias úteis.
2. **Publicar métricas nomeáveis.** Toda resposta de padrão semanal passa a expor: total do período, média por dia da semana (todas as ocorrências) e média nos dias com gasto. O índice interno `mediana x taxa` deixa de ser o número dito ao usuário.
3. **Sempre declarar período e base.** "Nas últimas 12 semanas, sobre R$ X de gasto de consumo" no corpo da resposta.
4. **Bloquear troca de métrica.** Perguntas de continuidade sobre o mesmo assunto reusam a métrica do turno anterior; se a métrica mudar, o Nino precisa dizer que mudou e reconciliar com o que falou antes ("no total você gasta mais em segunda e sexta; por compra, o sábado é maior").
5. **Responder a pergunta fechada.** Quando você pergunta "não é sexta?", a resposta começa com sim/não sobre sexta e o fim de semana, depois traz o número.
6. **Empate declarado.** Quando os dois líderes ficam a menos de 15% de distância (segunda x sexta hoje), o Nino nomeia os dois em vez de eleger um.
7. **Recalcular os fatos diários** para a janela completa até hoje e alinhar o mesmo resultado no app e no WhatsApp.

## Oportunidade que os dados mostram

- **Concentração de sexta:** sexta tem gasto em 10 das 12 semanas, a maior frequência da semana. É o melhor ponto de intervenção — um aviso do Nino na sexta pela manhã tem mais efeito que qualquer relatório de fim de mês.
- **Estrutura de custo:** nas últimas 8 semanas, Moradia (R$ 8.243), Dívidas e empréstimos (R$ 7.166), Lazer (R$ 3.209) e Transporte (R$ 2.986, em 128 lançamentos pequenos) dominam. Transporte é gasto pulverizado e ajustável: é aí que uma meta por categoria funciona.
- **Qualidade de data:** corrigir a confiança das datas importadas melhora simultaneamente padrão semanal, antecipação de aperto e relatórios — os três hoje leem a mesma série truncada.

## Detalhes técnicos

- `supabase/functions/_shared/analytics/weekdayTruth.ts`: expor `mean_all_days` e `median_active_amount` como números públicos; manter `typical_amount` apenas como critério de ranking; empate declarado quando `margin_pct < 15%`.
- `supabase/functions/_shared/analytics/behavioralDate.ts` / `anticipation/facts.ts`: aceitar `bank_posting_date` na série comportamental com marcação `date_basis = "bank_posting"`, em vez de excluir por confiança < 0,65.
- `supabase/functions/_shared/intelligence/evidence.ts`: reescrever a composição da resposta com período, base monetária, sim/não direto e ressalva de data de extrato.
- `supabase/functions/_shared/intelligence/semanticQuery.ts`: reconhecer "em média" (hoje só reconhece "na média") e tratar pergunta de confirmação sobre dia nomeado como continuidade da métrica anterior.
- `agent/core` (CapabilityRouter/ToolRuntime): fixar a métrica do turno anterior quando a pergunta é follow-up; proibir o modelo de trocar de métrica sem reconciliar.
- Recalcular `behavioral_daily_facts` do usuário para a janela de 12 semanas até a data corrente.
