# Nino: plano para acabar com os erros de período e elevar a qualidade de forma sustentável

Data: 18/11/2026 · Escopo: refinamento técnico + plano de execução · Base: código lido, rodadas sintéticas, consultas ao banco e pesquisa externa.

> Resumo em uma frase: o Nino erra períodos porque **três lugares diferentes decidem as datas, cada um com sua lista de frases**, e a medição que temos hoje **só enxerga os casos que já consertamos**. A saída é um único módulo de tempo, que o modelo apenas escolhe (vocabulário fechado) e o código calcula, junto com uma medição que cobre perguntas novas.

---

## 1. Diagnóstico (o que está provado e o que ainda é hipótese)

### 1.1 Medições

| Conjunto | Conversas | Acertos | Leitura |
|---|---|---|---|
| Regressão completa (perguntas já consertadas) | 793 | **97,2%** | Passa quase tudo, porque foi montada em cima dos erros antigos. |
| Perguntas novas H01–H24 (baseline de 09/11) | 642 | **73,7%** (122 erradas, 47 sem resposta) | Perguntas que o Nino nunca "viu" caem para ~74%. |
| Período e comparação P01–P07 (hoje, após #461) | 40 | **55%** (6 erradas, 12 sem resposta) | A família da falha do usuário ainda quebra. |

Conclusão: a regressão mede memória, não capacidade. Cada correção por frase sobe a regressão e deixa o resto igual. Isso é exatamente o "bambu com arame" que você apontou.

Tráfego real (30 dias, só contagens): 220 mensagens recebidas, 395 respostas enviadas, 8 delas "não consegui/quero confirmar". A base real é pequena; os erros aparecem sobretudo quando você mesmo testa e nos usuários sintéticos.

### 1.2 Causas-raiz

**C1. Três resolvedores de datas que discordam entre si (provado por teste).** Rodei o mesmo texto nos três (hoje = 18/11/2026):

| Texto | `resolvePeriodPt` | `resolveExplicitPeriodPt` | `resolveMultiPeriodsPt` |
|---|---|---|---|
| "esse mês até hoje" | **18/11..18/11** (só hoje) | nada | 01/11..18/11 |
| "do dia 1 até hoje" | **18/11..18/11** | nada | **18/11..18/11** |
| "este mês" | 01/11..18/11 | nada | 01/11..18/11 |
| "mesmo período do mês passado" | 01/10..18/10 | nada | **nada** (descartado de propósito) |
| "desde o dia 1", "mês até agora", "até agora" | nada | nada | nada |
| "7 dias anteriores", "esse ano" | nada | nada | nada |

Efeito direto nos erros medidos: a pergunta "quanto gastei esse mês até hoje?" passou por `resolvePeriodPt` e foi lida como **o dia de hoje** ("R$ 0 até hoje… período de hoje"). A regex acha o token "hoje" antes de "esse mês".

**C2. Lista de frases no lugar de significado (provado).** `TOKEN_RX`, `resolvePeriodPt`, `resolveExplicitPeriodPt` e `PeriodShiftHint` enumeram redações. Toda variação não listada devolve "nada" e cai em recusa ("não consegui fechar essa comparação"), ou pior, numa leitura errada. Chave: o problema não é uma frase; é o desenho.

**C3. O contrato e a conta podem se contradizer, e a trava recusa (hipótese forte, lida no código, não testada em produção).** O contrato guarda as janelas que o modelo escreveu (`semantic_periods`). A trava `turn_period_vs_financial_ir_mismatch` exige que cada janela do contrato exista na conta. Minha correção do #461 troca outubro inteiro por 01/10–18/10 só na conta, então a trava vê divergência e recusa. Isso explica as 10 recusas de P01/P02.

**C4. Correções "depois do fato" brigam com as travas (consequência de C3).** Qualquer guarda que mude as datas depois que o contrato foi montado vai contra as travas de preservação. A correção tem de ocorrer **antes**, num só lugar.

**C5. A medição não é o motor de melhoria (provado).** O conjunto que roda toda semana é o mesmo de 98 cenários; a regressão está saturada. Faltava um conjunto de generalização com gabarito por dia (agora existe P01–P07) e um gate que o use.

**Ainda não sei (a investigar na Fase 0):**
- se o modelo escreve as datas em ISO (`2026-10-01..2026-10-31`) ou em português; isso decide onde a correção entra;
- por que 3 respostas de P01 mantiveram outubro inteiro (a guarda não disparou);
- por que P05 e P07 não apareceram na última rodada (filtro de aplicabilidade ou teto de custo).

---

## 2. Princípios (o que vamos seguir)

1. **Quem entende é o modelo; quem calcula é o código.** O modelo escolhe um *tipo* de janela de um vocabulário fechado; o código gera as datas. Datas nunca saem do modelo, e nenhuma regex "adivinha" frase.
2. **Uma só fonte de verdade para o tempo.** Contrato, conta e trava usam a mesma janela resolvida. Nada corrige datas depois.
3. **Dizer a suposição em vez de recusar.** Padrão seguro + frase na resposta ("Comparei os mesmos 18 dias…") em lugar de "não consegui". Recusar só quando faltar informação de verdade.
4. **Medir o que não foi consertado.** Todo release passa por um conjunto de generalização (perguntas novas), não só regressão.
5. **Estrangular, não reescrever.** Novo módulo ao lado, migração módulo a módulo, remoção do antigo ao final.

---

## 3. Arquitetura-alvo

### 3.1 Álgebra de tempo (um módulo)

Um vocabulário fechado e pequeno cobre praticamente todas as perguntas de período:

```ts
type TimeSpec =
  | { kind: "calendar_month"; offset: 0 | -1 | -2 | number; partial: "to_date" | "whole" }   // "esse mês", "mês passado", "outubro inteiro"
  | { kind: "named_month"; month: 1..12; year?: number; partial: "to_date" | "whole" }
  | { kind: "rolling"; days: number; anchor: "today" | "yesterday" }                          // "últimos 7 dias"
  | { kind: "rolling_previous"; days: number }                                               // "os 7 dias anteriores"
  | { kind: "day_range"; from_day: number; to_day: number; month_ref: MonthRef }             // "do dia 1 ao 15"
  | { kind: "week"; offset: 0 | -1 }
  | { kind: "year"; offset: 0 | -1; partial: "to_date" | "whole" }
  | { kind: "explicit"; from: "YYYY-MM-DD"; to: "YYYY-MM-DD" };                              // datas citadas literalmente

type Comparison = { current: TimeSpec; against: "same_days_previous_month" | "whole_previous_month" | "previous_window_same_length" | TimeSpec };
```

- **Entrada do modelo:** só estes campos, com **enum fechado** e esquema estrito (saída estruturada).
- **Saída do código:** `resolveTime(spec, now_sp) → { from, to, label, assumption? }`, puro e testável.
- **`assumption`** é preenchida quando o código aplicou um padrão (ex.: `same_days`), e a resposta a verbaliza.
- **Fuso:** sempre America/São_Paulo; dia de hoje calculado uma vez por turno.

### 3.2 Fluxo do turno

```
mensagem ─► modelo (TimeSpec, enum estrito) ─► validador ─► resolveTime (código)
                         ▲                         │ falha (1 vez)
                         └──── turno de reparo ────┘
                                                   ▼
                   janela resolvida única ─► contrato + conta + trava (mesma janela)
                                                   ▼
                              resposta + frase de suposição
```

- **Validador:** checa esquema, coerência (ex.: `rolling.days` entre 1 e 366) e consistência com a conversa. Falhou: **um** turno de reparo com o motivo; falhou de novo: pergunta curta e específica ao usuário, nunca a frase genérica.
- **Trava de preservação:** passa a comparar contra a janela **resolvida** (a única), eliminando C3/C4.

### 3.3 O que sai de cena (por estrangulamento)

`resolvePeriodPt`, `resolveExplicitPeriodPt`, `resolveMultiPeriodsPt/TOKEN_RX`, `PeriodShiftHint`, `SameWindowGuard` (#461) e os trechos duplicados em `reports-core/periods.ts` e `src/lib/reports/intelligent/periods.ts` passam a ser wrappers finos do módulo novo e depois são apagados.

---

## 4. Plano por fases

Cada fase termina com critério mensurável. Nenhuma fase depende de "achar que ficou bom".

### Fase 0: provar as causas (1 PR pequeno, sem mudar comportamento)
- Registrar, por turno, o que o modelo emitiu (`period_expressions` cru) e o que cada resolvedor devolveu. Medir quantos turnos reais/sintéticos têm discordância entre resolvedores.
- Reproduzir as 6 respostas erradas e 10 recusas de P01–P03 como testes (as respostas reais viram fixtures).
- Resolver as incógnitas de 1.2 (ISO ou português; por que a guarda não disparou; por que P05/P07 sumiram).
- **Saída:** causas C1–C3 confirmadas ou refutadas com evidência; lista fechada de cenários de tempo (≥ 60 redações reais anonimizadas do tráfego + 150 geradas).

### Fase 1: módulo de tempo único (puro, atrás de flag, sem tocar no Nino)
- `TimeSpec`, `resolveTime`, `describeAssumption`, tudo em TypeScript puro, espelhado no front só se necessário.
- **Testes de propriedade** (fim de mês, ano bissexto, virada de ano, "mesmos dias", 7 contra 7) com `fast-check`, mais a tabela de 1.2 como testes de caracterização.
- **Saída:** 100% das propriedades passando; módulo cobre os 150 + 60 casos do conjunto de tempo.

### Fase 2: contrato de turno com vocabulário fechado + validador + reparo
- Ajustar o contrato (`ConversationTurnContract`) para o modelo devolver `TimeSpec` em esquema estrito (saída estruturada do Claude com `strict: true`; verificar nos docs os limites do subconjunto de JSON Schema para enums).
- Validador + um turno de reparo.
- Trava de preservação lê a janela resolvida.
- **Atrás de flag por usuário**, ligada primeiro na conta do dono e nos sintéticos.
- **Saída:** P01–P07 ≥ 95% e perguntas novas de tempo ≥ 90% nos sintéticos; zero recusa por "janela divergente".

### Fase 3: migrar consumidores e apagar o antigo
- Em ordem: comparação → relatórios → Ticket/Metas (servidor) → proativo → front (`periodStore`, `financialComparison`).
- Cada migração: teste de equivalência (antigo vs novo nos casos antigos) e depois remoção.
- Remover `SameWindowGuard` e as listas de frases.
- **Saída:** um único resolvedor no repositório; `grep` de `TOKEN_RX`/`resolvePeriodPt` vazio fora do módulo.

### Fase 4: avaliação como motor (em paralelo desde a Fase 0)
- **Dois conjuntos:** *regressão* (o que consertamos) e *generalização* (perguntas novas, rotativas). Release só passa se **ambos** passarem.
- **Gates no CI:** generalização ≥ meta, queda máxima de 2 pontos contra a última rodada, zero WRONG em áreas protegidas.
- **pass^k (k=3)** para medir consistência; relatório semanal mostra por assunto e por estilo.
- **Rodada semanal:** metade fixa, metade sorteada **de um banco de perguntas novas** (alimentado com redações reais anonimizadas e variações geradas por modelo).
- **Saída:** painel de qualidade com "regressão vs generalização" lado a lado e histórico.

### Fase 5: demais classes de falha (depois do tempo)
Mesma receita (vocabulário fechado + código calcula + medir) para: referência a categoria ("e em mercado?"), seguimento de conversa, e o excesso de recusa. Política única: **responder com suposição dita > perguntar uma coisa específica > recusar**.

### Fase 6 (só depois): especialistas
Agentes especialistas para aconselhamento/coach, sobre o núcleo determinístico. Não entram antes das Fases 1–4.

---

## 5. Ferramentas, artigos e projetos pesquisados (e o que decidi)

| Item | O que é | Decisão |
|---|---|---|
| [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) | Tarefas, tentativas (trials), graders de código/modelo/humano; consistência com pass^k. | **Adotar o método.** Já temos graders de código; falta pass^k e o conjunto de generalização. |
| [Claude API: structured outputs / strict tool use](https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md) | Esquema garantido para a saída/entrada de ferramenta. | **Adotar** para `TimeSpec`. Pendente: confirmar no doc o suporte a `enum` no subconjunto de JSON Schema. |
| [Test of Time (arXiv 2406.09170)](https://arxiv.org/pdf/2406.09170) | Mostra que modelos falham mais em aritmética de tempo com vários passos. | **Reforça o princípio 1:** não pedir datas ao modelo. |
| Camada semântica para LLM (dbt MetricFlow, Cube; [ex.: benchmark da dbt Labs](https://datalakehousehub.com/blog/2026-05-semantic-layers-text-to-sql)) | O LLM escolhe métricas/dimensões governadas; o software calcula. Relato de 90%→98% com grounding (fonte de fornecedor, amostra pequena). | **Mesmo padrão** que o nosso desenho; não vale adotar a ferramenta, porque nosso motor financeiro já é a camada governada. |
| [Duckling](https://github.com/facebook/duckling) (Meta) | Parser de expressões de tempo, regras em Haskell; português com cobertura irregular e issues abertas. | **Não adotar** (stack pesada, cobertura em pt incerta). Útil como referência de casos. |
| [chrono-node](https://github.com/wanasit/chrono) | Parser de datas em JS; pt só parcial na v2. | **Não adotar como fonte de verdade.** Pode ajudar a gerar variações de teste. |
| `fast-check` | Testes de propriedade para TypeScript. | **Adotar** na Fase 1. |
| [promptfoo](https://github.com/promptfoo/promptfoo) (YAML + GitHub Action), DeepEval (pytest), Inspect AI | Frameworks de avaliação. | **Não adotar agora.** Nosso harness já tem gabarito por persona, juiz em camadas e worker; trocar custa mais que ganha. Reavaliar se o CI de generalização ficar pesado. Fontes de comparação são blogs de fornecedores. |

Pesquisa feita; o que **não** consegui confirmar: suporte exato a `enum` em strict mode, e se o chrono-node/Duckling resolvem as expressões brasileiras do nosso conjunto (precisaria teste). Nada na lista acima foi instalado.

---

## 6. Metas e como saberemos que deu certo

| Métrica | Hoje | Meta Fase 2 | Meta Fase 4 |
|---|---|---|---|
| Período/comparação (P01–P07) | 55% | ≥ 95% | ≥ 97% (pass^3 ≥ 90%) |
| Perguntas novas (generalização) | ~74% | ≥ 85% | ≥ 92% |
| Recusa "não consegui fechar…" em sintéticos | 12 de 40 | 0 por janela divergente | < 2% |
| Resolvedores de período no código | 3 + guarda + helpers | 1 novo + antigos em wrapper | 1 |

Reversão: cada fase atrás de flag por usuário; desligar a flag volta ao comportamento atual.

---

## 7. Riscos e decisões que dependem de você

1. **Custo das rodadas:** cada conversa sintética gasta ~12 mil tokens (a rodada de 40 gastou 500 mil). Proposta: gate de CI com amostra de 40–60 conversas e teto de tokens; rodada semanal maior no domingo. *Decida o teto mensal.*
2. **Padrão "mesmos dias":** aceito que, com mês aberto, o padrão seja comparar os mesmos dias e dizer isso. Quem quiser o mês fechado escreve "inteiro". *Confirmar que concorda.*
3. **Perguntas reais como insumo:** usar apenas **estrutura** e redação anonimizada, nunca nome/valor; o banco de generalização cresce com isso. *Confirmar.*
4. **Esforço estimado:** Fase 0 (1 PR), Fase 1 (1–2 PRs), Fase 2 (2 PRs), Fase 3 (4–6 PRs pequenos), Fase 4 (2 PRs). Sem migração de banco, exceto o banco de perguntas da Fase 4 (uma tabela).

## 8. Próximo passo imediato

Fase 0: instrumentar e reproduzir as 16 falhas como testes, resolver as três incógnitas e só então escrever o módulo de tempo. Isso também decide se a correção do #461 pode ser removida já na Fase 2.
