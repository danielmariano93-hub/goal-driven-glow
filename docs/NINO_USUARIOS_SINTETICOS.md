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

## Como rodar
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
- Memória do Nino é por pessoa: personas diferentes rodam em paralelo; dentro de uma persona os cenários rodam em fila.
