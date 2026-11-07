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
