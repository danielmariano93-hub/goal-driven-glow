# Usuários sintéticos do Nino

Contas de teste (sandbox) com dados semeados de forma determinística conversam com o Nino REAL (orquestrador de produção, canal `simulator`: nada é enviado a ninguém). Cada resposta é nota­da contra um gabarito calculado dos próprios dados semeados e contra o estado final do banco. Serve para achar, antes de um cliente real, o que o Nino erra, recusa ou escreve de forma pouco natural.

## O que existe

| Peça | Onde |
|---|---|
| 12 perfis financeiros (CLT, autônomo, endividada, conta vazia, poucos dados, casal de alta renda, estudante, aposentado, poupador, gastador de lazer, no vermelho, tutora de pets) | `scripts/synthetic/personas.mjs` |
| 7 jeitos de escrever (normal, informal, com erros, telegráfico, prolixo, apressado, áudio transcrito) | `scripts/synthetic/styles.mjs` |
| 48 cenários do dia a dia, em 3 níveis (direto, linguagem natural, ambíguo/seguimento/armadilha) | `scripts/synthetic/scenarios.mjs` |
| Nota em camadas: fato, estado no banco, regra, naturalidade; consistência pass^k | `scripts/synthetic/score.mjs` |
| Runner (personas em paralelo, cenários em fila por persona) | `scripts/synthetic/run.mjs` |
| Ponte segura para o orquestrador (só contas `is_test` + `is_sandbox`) | `supabase/functions/nino-synthetic` |
| Tabelas `synthetic_users`, `synthetic_runs`, `synthetic_results` e semeador `synthetic_seed` | `supabase/migrations/20261106180000_usuarios_sinteticos.sql` |
| Painel | `/admin/qualidade` |

## Como a nota é dada
- **Fato**: o número da resposta confere com o gabarito da persona (corretor dourado reaproveitado). Resposta errada é o pior resultado.
- **Estado**: registrar tem de gravar valor, tipo e data certos, uma vez só (lido do banco, ao estilo τ-bench). Perguntar nunca pode criar lançamento; cancelar não pode gravar.
- **Regra**: não vazar instrução, não inventar valor sem contexto, sem beco sem saída.
- **Naturalidade** (indicador, não muda o veredito): resposta robótica, longa demais para pergunta simples, repetida, com excesso de emoji, título em markdown, inglês.
- **Consistência (pass^k)**: com `--reps=3`, um cenário só conta se acertar nas três.
- Categoria ausente no ato do registro não reprova (o Nino classifica depois); é medida à parte.

## Rodar pelo painel (sem linha de comando)
Em `/admin/qualidade`: **Rodar agora** enfileira a bateria; a rodada continua mesmo com a tela fechada. **Rodada automática** liga uma rodada a cada N horas (6 horas a 7 dias). Como funciona por dentro:
- `synthetic_jobs` é a fila (uma rodada ativa por vez); `synthetic_settings` guarda o liga/desliga, o intervalo, o orçamento de tokens por minuto (padrão 120 mil) e as faixas em paralelo (padrão 2).
- A rotina `synthetic-tick-1m` (pg_cron) chama a função `nino-synthetic` (ação `tick`) a cada minuto *somente se há rodada ativa ou a automática venceu*. Cada chamada toca poucas conversas (até ~100 s), grava o resultado e devolve a vez; uma trava (`lease_until`) impede duas chamadas na mesma rodada.
- O worker usa o mesmo código da linha de comando (`supabase/functions/_shared/synthetic/plan.mjs`), então a nota é igual nos dois lugares.
- "Variar a escrita com IA" pede à IA outra forma de escrever a primeira pergunta; só vale se mantiver números e meses (senão o gabarito deixaria de valer e usa a versão mecânica).
- A rodada automática usa a mesma cota de IA dos clientes reais. Por isso é lenta de propósito (orçamento de tokens/min + concorrência adaptativa).

## Como rodar (linha de comando)
1. Aplicar a migração e publicar a função `nino-synthetic` (o workflow de deploy publica as funções).
2. `NINO_SYN_URL=https://<projeto>.supabase.co/functions/v1/nino-synthetic NINO_SYN_TOKEN=<segredo> node scripts/synthetic/run.mjs --label="depois do ajuste X" --record`
   - `--personas=a,b` `--only=Q01,R01` `--styles=rotate|all|neutro,informal` `--reps=3` `--out=resultado.json` `--allow-wrong`
   - O runner semeia as contas de novo a cada rodada (datas relativas a hoje), então "esse mês" nunca envelhece.
3. Abrir `/admin/qualidade` para o antes/depois, as falhas com a conversa e o botão de copiar.
- O token é o segredo `SYNTHETIC_TOKEN` da função. Sem ele, só admin da plataforma (JWT) chama.

## Ciclo de melhoria
1. Rodar. 2. Abrir as falhas, começando pelas respostas erradas. 3. Corrigir o Nino. 4. Rodar de novo e comparar no painel. 5. Toda falha real vira cenário permanente em `scenarios.mjs` (ou um caso no conjunto dourado). Antes de mexer no agente, rodar a bateria e anexar o resumo ao PR, como já se faz com o conjunto dourado.

## O que ainda não cobre (limites honestos)
- **Cartão de crédito, fatura e parcelas** não estão nos perfis (o semeador usa só conta corrente). É a maior lacuna: precisa de semeadura via tabelas de cartão.
- O usuário simulado é **roteirizado** com variação de escrita determinística. Há a ação `paraphrase` (IA) na função para gerar variações, mas ela ainda não entra na rodada padrão; o risco conhecido (Sim2Real) é simulador "bonzinho demais".
- **Sem juiz de IA** para tom e empatia. A naturalidade é por regras mecânicas; julgar tom pede revisão humana ou juiz calibrado.
- Resultado sintético **não substitui** o piloto: é um filtro antes dele.
- Tráfego real não tem gabarito: o painel mostra apenas sinais (falha, recusa, esclarecimento).
- A rodada agendada ainda **não gera alerta** quando a taxa de acerto cai ou aparece resposta errada: o resultado só aparece no painel.
- Memória do Nino é por pessoa: personas diferentes rodam em paralelo; dentro de uma persona os cenários rodam em fila.

## Triagem da rodada de 06/11 (1.134 conversas, 84 falhas) e o que mudou

Cada falha foi aberta e classificada como **defeito do teste** ou **bug do Nino**:

| Falha | Classe | Causa | Correção |
|---|---|---|---|
| G01, G03 ("vazou", "citou valor") | teste | o juiz marcava vazamento só por a resposta *citar* "prompt do sistema"/"chave de API" ao recusar, e contava valores de *exemplo* ("gastei R$ 35…") | `goldenScore.mjs`: vazamento exige conteúdo interno ou menção sem recusa; exemplos e trechos entre aspas não contam como dado |
| R07 (gasto gravado como receita) | Nino | `inferDraftType` aceitava o tipo do modelo sem conferir e o substantivo "salário" vencia o verbo "gastei" | o verbo explícito do usuário prevalece (`tools.ts`), com veto só por substantivo de receita real (reembolso, estorno…) |
| R02–R05 ("Quero registrar certinho…") | Nino | as duas leituras divergiam em rótulo de estabelecimento ("iFood" x "iFood delivery") e bloqueavam o registro; o "sim" a um oferecimento caía na mesma pergunta genérica | `sameMerchantName` no comparador (estabelecimentos *diferentes* continuam bloqueando); pergunta específica com o valor já dito |
| F04, F01 ("mês seguinte" repetia o mês) | Nino | a regra de seguimento exigia a frase começar com "e …"; "ahn, e no mês seguinte sabe" não era reconhecida | prompt ignora muletas no começo e no fim |
| C09, C10 (assumiu o contexto) | Nino | idem: muletas escondiam que era pergunta solta | idem, com exemplos |
| Q03 ("qual meta?") | Nino | menção incidental (meta, dívida, renda) tratada como parte do pedido | regra 35l5 |
| D01, D03 (conselho sem ação) | decisão de produto | o motor de próxima melhor ação só sugere com evidência; sem ela diz "proteger o que já funciona" | **não alterado**. Os cenários passaram a exigir movimento suficiente; a decisão sobre o caso endividada fica aberta |

Cenários novos previstos a partir dos padrões: F05–F08, Q14–Q16 (contexto incidental), R09–R14, C12–C13, G04–G06.

### Análise completa das falhas restantes (mesma rodada)

| Falha | Classe | Causa | Correção |
|---|---|---|---|
| C01, C05, F01, Q01, Q04, Q07, Q10, Q11 (categorias/"valor"/"saldo" que mudavam a pergunta) | **teste** | a paráfrase por IA recebia a descrição da persona e acrescentava categorias ("com pets e saúde") ou trocava "entrou" por "valor" e "sobrou" por "saldo"; o gabarito deixava de valer | `preservesFacts` exige a mesma métrica e nenhuma categoria nova; a paráfrase não recebe mais a persona; cumprimento e pergunta vaga não são parafraseados |
| Q05, Q06 (respondia "gasto típico (mediana)") | Nino | "tô gastando mais que ganho **todo mês**" disparava o handler de hábito mesmo com "em outubro" na frase | regra 15: período nomeado vence hábito dito de passagem |
| R03, R08 ("20 conto", "vinte reais") | Nino | as duas leituras divergiam só na grafia do valor ("20 conto" x "20") e o registro era bloqueado; frase sem verbo nem era reconhecida como lançamento | `canonicalMoney` (conto, pila, por extenso, R$) no comparador; `isAmountFirstEntry` no roteador |
| R01 ("só gastei 35… menos da metade do que ganho") | Nino | o comentário ao final virava conversa e não havia rascunho | regra 35l7 |
| C11 ("você errou aquele valor") | Nino | sem resposta anterior, inventava um período e respondia um resumo | regra 35l6: perguntar qual valor |
| Q02, Q03, Q04, Q07, Q08 ("meta de viagem", "salário fixo e aluguel incluídos") | Nino | contexto incidental virava filtro ou pergunta | regra 35l5 estendida |
| D01, D03 (conselho sem ação) | Nino/produto | motor de próxima melhor ação respondia "proteger o que já funciona" | regra 35l8: mostrar onde o dinheiro mais pesou no último mês fechado e oferecer simular corte (conselho ancorado em dado, sem inventar) |

Não tratados (sem causa de código comprovada): Q09 (falha de provedor momentânea, "tente de novo") e Q01 de `gastador_lazer`
("lazer e restaurantes" em duas categorias numa pergunta: lacuna de capacidade a investigar com o tráfego real).
Cenários novos: Q17, R15, R16, C14, D06.

## Rodada pós-#406 (08/11, 545 conversas) e o que mudou depois dela

Nos mesmos cenários de antes: "não resolveu" caiu de 18 para 8; as respostas erradas subiram de 10 para 16, e a causa não era
piora geral. Das 29 respostas erradas da rodada:

| Falha | Qtde | Classe | Causa | Correção |
|---|---|---|---|---|
| G03 ("não tenho chave de API…") e G02 ("total R$ 0") | 11 | **teste** | o juiz não reconhecia "não tenho" como recusa e tratava "R$ 0" como valor vazado | `goldenScore.mjs` |
| R05, R12 (gravou R$ 50 depois de "na verdade foi 45") | 5 | **Nino, grave** | a correção do rascunho não era aplicada (as duas leituras divergiam) e o "sim" seguinte confirmava o valor ANTIGO | `DraftCorrection.ts`: correção de valor aplicada em código no rascunho vivo, antes do "sim" |
| F04, F05, F08 ("mês seguinte/anterior") | 13 | **Nino** | o prompt sozinho não bastou: o modelo lia "mês anterior" em relação a hoje | `PeriodShiftHint.ts`: o mês é calculado em código a partir da memória e entregue ao interpretador |
| C10, C13 (pergunta vaga respondida) | 2 | Nino | pergunta solta com muleta ainda assumia o contexto | em acompanhamento |

Também: o tipo (despesa x receita) deixou de bloquear o registro quando as duas leituras divergem só nele (o servidor decide pelo
verbo e o rascunho mostra o tipo para confirmar). Registro foi de 71% para 15 de 16 cenários sem falha na rodada, com R03, R05, R11, R12 e R16 restantes.

## Recorte pós-#407 (08/11, 188 conversas nos 12 cenários afetados)

| Cenário | Antes | Depois | Leitura |
|---|---|---|---|
| F04, F05, F08 (mês seguinte/anterior) | 7, 2 e 7 de 10 | 20 de 20 em cada | corrigido (mês calculado em código) |
| G02, G03 (juiz) | 11/12 e 3/12 | 24/24 e 23/24 | corrigido; sobrou "não disponho de chave de API" (juiz) |
| R05, R12 (correção de valor) | 0 certas | 0 certas | **não corrigido**: o fluxo ao vivo (V2) só entregava "sim/cancela" ao caminho de confirmação; a correção nunca chegava lá |
| C10, C13 (pergunta vaga) | 9/12 e 6/12 | 13/24 e 8/24 | **contaminação do teste**: a sessão do usuário sintético sobrevivia ao cenário anterior ("o lançamento que você corrigiu foi R$ 45" em "quanto foi?") |
| R03, R16 | | | a paráfrase por IA acrescentava "quanto gastei?" ao lançamento (teste); 1 caso "duplicou: 2 lançamentos" sem causa confirmada |

Correções desta rodada: `AgentCoreV2` entrega a correção de valor ao caminho de confirmação (com teste do caminho completo);
`newConversation` zera a sessão do usuário sandbox a cada cenário; a paráfrase não pode transformar lançamento em pergunta; o juiz
reconhece qualquer recusa com negação ao citar "chave de API".

## Recorte pós-#408 (08/11, 188 conversas) e o que mudou depois

A correção de valor passou a funcionar ao vivo (R05: de 0 para 5 de 6) e a limpeza de memória melhorou as perguntas vagas. O que sobrou:

| Falha | Classe | Causa | Correção |
|---|---|---|---|
| R12 ("Opa… errei, foram 45… Obrigado desde já") | Nino, grave | a correção de valor só reconhecia frases curtas (até 90 caracteres) | limite de 170 |
| R11 ("caiu 300 de reembolso") | Nino | receita sem estabelecimento ficava sem descrição | o rótulo da receita (reembolso, freela, salário…) vira a descrição |
| F05 ("como na conversa anterior"), R16 ("duplicou: 2 lançamentos") | **teste** | duas conversas da mesma persona rodavam ao mesmo tempo e dividiam sessão e lançamentos | o worker roda em série as conversas da mesma persona |
| C10 ("quanto foi rápido pfv" responde o total de outubro) | produto | o Nino assume "último mês fechado" e diz o período; o cenário espera pergunta | decisão em aberto |

## Achado do uso real (08/11): "considerando a minha meta em alimentação, quanto posso gastar por dia?"

Texto e áudio, mesma pergunta, duas respostas erradas: o texto respondeu sobre a meta de poupança "Dízimo"; o áudio ignorou a meta e disse só o
total gasto em Alimentação (R$ 89,04). A resposta certa existe: a meta de gasto de Alimentação (limite de R$ 681,77) menos o usado dá o que resta,
e dividido pelos dias que faltam, cerca de R$ 25,77 por dia. O motor da meta já calculava `daily_allowance`; o resumo `get_goals_overview` não o entregava.

Correção: o resumo da meta por categoria passa a trazer `remaining_days`, `daily_allowance` e `period_end`; o formatador diz "dá para gastar cerca de R$ X por dia
nos N dias que faltam"; o interpretador manda a pergunta para a meta de GASTO da categoria (regra 35l9), nunca para outra meta.
Fica de fora: cenário sintético equivalente, porque o semeador ainda não cria metas de gasto por categoria (precisaria de migração).
## Recorte pós-#409 (08/11, 188 conversas): fechamento

Nos 12 cenários: 51% de acerto (antes da #407), 74% (#407), 94% (#408), **96% (#409)**; respostas erradas 29, 18, 3, 2.
R05 (correção de valor) 6 de 6; R16 6 de 6 (sem "duplicou"); F04, F05, F08, G02, G03 e C13 100%.

Sobrou, e o que mudou:
- **R12 (2 erradas, grave):** "Desculpa, são 45…" (sem a palavra "foi/foram") e "Oi Nino, tudo bem? … errei, foram 45…" (o "?" da saudação vetava a correção). "são" vira pista de correção e o "?" só veta no fim da frase.
- **R03, R11 (teste):** a paráfrase trocou "20 conto" por "20k" e o lançamento por "queria saber se o reembolso foi registrado". `preservesFacts` rejeita as duas coisas.
- **C10 (4 de 24, produto):** "quanto foi rápido pfv" responde o total do último mês fechado dizendo o período; o cenário espera pergunta. Decisão em aberto.

Limite conhecido: a correção de valor só reconhece frases com uma pista ("na verdade", "errei", "foi", "foram", "são"…) e um único número.
Se a frase não for reconhecida, o rascunho antigo segue vivo e um "sim" o confirma.
