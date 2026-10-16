# Emocional / Hábitos: o que é medido e o que a ciência sustenta

Avaliação honesta do estado em 16/10/2026. Nada abaixo é uma escala psicométrica validada hoje.

## O que o Nino mede hoje

| Hábito (roda) | Como a nota nasce | Natureza | Validado? |
|---|---|---|---|
| Consciência | nº de check-ins + semanas com check-in + respostas de contexto | uso do app (engajamento) | Não. Mede frequência de uso, não consciência |
| Planejamento | metas/recorrências cadastradas + metas mensais cumpridas | comportamento registrado | Não (proxy razoável, pesos arbitrários 0,5/0,3/0,2) |
| Controle de impulso | metas mensais cumpridas + metas do mês no ritmo | adesão a limites | Não. O rótulo diz "impulso", o dado diz "cumpriu limite" |
| Consistência | estabilidade do gasto diário + semanas com check-in | comportamento registrado | Não |
| Segurança | meses de gasto cobertos pelo caixa + folga após compromissos | indicador financeiro | Conceito próximo de reserva de emergência, sem limiar de literatura |
| Patrimônio | regularidade dos aportes (líquidos de resgate) + taxa sobre renda + poupança do mês | comportamento registrado | Não |
| Tranquilidade | 1 item 0-10 ("quanto o dinheiro pesa hoje") nos check-ins | autorrelato, item único | Não. Item inventado, sem versão validada |
| Dívidas | peso da dívida sobre o patrimônio + tendência | indicador financeiro | Não |
| "Você se deu X" (roda) | 1 pergunta por hábito, escala 0-10 | autorrelato, item único | Não |
| Emoção × gasto | pareamento check-in ↔ gasto próximo | associação observacional | Não é causal; o texto já diz isso |

Limiares como 14 dias de histórico, 4 check-ins em 2 semanas, 3 respostas de tranquilidade vêm de decisão de produto, não de estudo.

## Onde a literatura oferece âncoras validadas

Verificado por busca em 16/10/2026 (resumos, não o texto completo):

- **Escala de Bem-Estar Financeiro do CFPB (10 itens).** Existe adaptação transcultural para o português do Brasil, com 834 participantes, alfa de Cronbach 0,89 e fator único (Howat-Rodrigues, Laks e Marinho, 2021; [PMC8317546](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8317546/)). Cobre segurança financeira presente e futura e liberdade de escolha. É a melhor âncora para **Segurança** e **Tranquilidade**.
- **Escala de Autocontrole (Tangney).** Há adaptação brasileira da versão completa de 36 itens (Gouveia e colaboradores, 2013, *Avaliação Psicológica*; consistência interna 0,62 a 0,82). Não encontrei validação brasileira da versão breve. Âncora possível para **Controle**, com a ressalva de que mede autocontrole geral, não de gasto.
- **PANAS.** Há versão brasileira (amostra comunitária de 3.728 pessoas em São Paulo e Rio) que sustenta duas dimensões, afeto positivo e negativo. Útil se o check-in emocional quiser medir afeto, hoje ele não mede.

Não verificado nesta pesquisa (citado de memória, confirmar antes de usar): escala de tendência à compra por impulso (Rook & Fisher), InCharge Financial Distress Scale, "Big Three" de alfabetização financeira (Lusardi & Mitchell).

## Recomendação

1. **Nomear o que se mede.** Onde o dado é um proxy, o rótulo deve dizer o proxy: "Controle de impulso" mede cumprimento de limites; "Consciência" mede frequência de check-ins.
2. **Ancorar o autorrelato em instrumento validado**, aplicado a cada 30 a 90 dias, não a cada check-in: a escala de bem-estar financeiro do CFPB (versão PT-BR) para Segurança/Tranquilidade. Os 10 itens e a regra de pontuação vêm do artigo de adaptação.
3. **Manter o que o Nino mede de melhor: comportamento registrado.** Isso é objetivo e é o diferencial. Não rotular como traço psicológico.
4. **Nunca inferir emoção a partir de gasto.** Já é regra do produto; manter.
5. **Declarar limites na tela** (já feito em "O que esta nota não prova") e não apresentar nota com precisão de uma casa decimal quando o dado é de item único.

Decisões de produto pendentes (não alteradas neste PR): renomear "Controle de impulso" e "Consciência"; adotar a escala CFPB-PT como questionário periódico; tornar a nota de Tranquilidade a partir dela.
