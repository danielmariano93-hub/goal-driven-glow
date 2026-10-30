# Causas, diagnóstico e alertas — refinamento técnico (30/10/2026)

Nada aqui foi implementado. Este documento existe para que a próxima etapa não quebre o que já funciona e não
estoure o consumo do Supabase. Convenções: **[verificado]** = conferido no código ou no banco nesta sessão;
**[derivado]** = calculado por mim a partir de dados verificados; **[provisório]** = proposta que precisa de decisão ou calibração.

## 0. O que queremos construir (resumo)

1. Uma só base de números (definições únicas de competência, renda base, compromissos).
2. Um **livro de causas**: para cada sintoma (caixa baixo, projeção negativa, atraso), uma decomposição com resíduo honesto e confiança.
3. Na Home, duas faces da mesma base: **"Por que está assim?"** (diagnóstico: passado e presente) e **"O que vem pela frente"** (alertas de antecipação: futuro).
4. Alertas só quando forem acionáveis, passando pelo governador único que já existe.

## 1. Regras permanentes de custo e escala

Valem para tudo daqui para frente (também registradas em `GUIA_DESENVOLVIMENTO_NINO.md`, seção 11). Cada regra tem uma checagem.

| # | Regra | Como se verifica |
|---|---|---|
| R1 | **Nenhuma rotina nova com frequência menor que 1 hora** sem aprovação explícita. Se algo precisa reagir em minutos, é **gatilho → fila → worker**, nunca polling cego. | Revisão de PR + `check-cost-budget` (seção 6). |
| R2 | **Todo poller é O(1) quando ocioso**: antes de chamar uma Edge Function, o SQL checa `EXISTS` na fila. Sem trabalho, sem invocação. | Teste lê `cron.job` e exige a guarda. |
| R3 | **Custo por usuário, não por execução.** Todo trabalho recorrente declara linhas lidas/escritas e milissegundos por usuário ativo por dia, e a conta para 10 mil usuários. | Campo obrigatório no corpo do PR. |
| R4 | **Calcular sob demanda e guardar em cache por versão** (`financial_ledger_versions` + deploy) é o padrão. Materialização periódica só quando ler é caro e o dado muda pouco. | Reuso de `derived/cache.ts`. |
| R5 | **Incremental**: recalcula só quem mudou (versão ou hash da entrada); pular é o caminho comum. | Contador `skipped` na telemetria do job. |
| R6 | **Escrita mínima**: nunca regravar linha sem mudança (`IS DISTINCT FROM`); não gravar snapshot idêntico ao anterior. | Revisão + teste de idempotência. |
| R7 | **Toda tabela que cresce com o tempo declara retenção** (TTL, job diário em lote, teto por usuário) antes do merge. | `check-cost-budget` lista tabelas sem retenção. |
| R8 | **Sem LLM em caminho recorrente.** LLM só reativo (pergunta do usuário) e com cache por hash da evidência. | Revisão. |
| R9 | **Realtime só em tabela de baixo volume** (hoje: `financial_ledger_versions`). Nunca em tabela quente. | `check-performance-architecture` já afirma isso. |
| R10 | **Aditivo e reversível**: migração só acrescenta; contrato existente não muda no lugar (versão nova); tudo atrás de flag; rollback = desligar a flag. | Revisão + teste de contrato. |
| R11 | **Uma definição por conceito**, nascida em `finance-core` e com paridade testada. Conceito novo não nasce em SQL solto. | `finance-core-parity.test.ts` + casos de ouro. |

## 2. Inventário do que existe hoje

### 2.1 Onde cada "cérebro" mora

| Superfície | Motor | Base de datas/renda | Como é atualizado |
|---|---|---|---|
| **Home** (Disponível, Resumo, Ritmo, Previsão, Compromissos) | Edge `home-snapshot` + `finance-core` (TS) [verificado] | competência da fatura; "Resumo do período" em regime de **caixa** (comentário no código) | sob demanda; cache por ledger + deploy; fila de refresh disparada por gatilho |
| **Diagnóstico / alertas da Home** | funções SQL `nino_evaluate_*`, `nino_diag_*` [verificado] | `occurred_at` (**data da compra**); renda média = soma de 90 dias ÷ 3 | cron de hora em hora, por usuário (agora incremental) |
| **Mapa Financeiro** (atrás de flag, só a conta do dono) | `finance-core` (TS), motores E0–E13 [verificado na especificação e nos dados] | competência, **meses fechados**, renda típica = mediana, regularidade por CV | ao abrir + job semanal |
| **Agente conversacional** | `tools.ts`, `engineTools`, `finance-core` | competência nas comparações (ajustado nesta sessão); motor de estabelecimentos por `occurred_at` | sob demanda |
| **Avisos proativos** | `agent-proactive-tick` + governador único | lê as situações do diagnóstico SQL | cron de hora em hora |
| **Change Agent** | `nino_behavior_wealth` | verdade financeira + estágios | sobre a recomendação canônica |

### 2.2 Definições divergentes (o problema central) [verificado]

| Conceito | Diagnóstico SQL (Home/avisos) | Mapa (TS) | Efeito |
|---|---|---|---|
| Base de datas | `occurred_at` (compra) | competência (fatura) | O guia (seção 4) manda usar competência; o SQL não segue. |
| Renda "normal" | média dos últimos 90 dias ÷ 3 | mediana dos meses fechados + regularidade | Para renda irregular (CV ≈ 0,67 na conta do dono) as duas divergem muito. |
| Compromissos ÷ renda | recorrências + parcelas de dívida + **fatura aberta de cartão** ÷ renda média (90 dias ÷ 3); alerta em 60% / 85% | parcelas de dívida normalizadas ÷ renda típica (mediana); atenção em 35%, crítico em 50% | Na conta do dono, em 27/10, o SQL deu **102,38%** (R$ 11.292,84 ÷ R$ 11.030,19): recorrências R$ 309,94 + parcelas de dívida R$ 3.732,90 + fatura aberta de cartão (~R$ 7,2 mil, **derivado por subtração**: a linha foi sobrescrita no mesmo dia). O Mapa deu **25,8%** (só dívidas ÷ renda típica). A fatura é consumo já feito e entrou como compromisso: o 102% foi **artefato da fórmula**, não fato sobre as finanças do dono. |
| Causa por categoria | blocos `spending_pace_change` e `category_shift` **desligados** (`if false`); só a categoria nº 1 | sem equivalente | Existem situações antigas gravadas, mas o motor atual não as gera. |
| Meta / dívida | só **uma** meta e **uma** dívida (a de maior prioridade/saldo) | todas | A Home pode mostrar "meta Dízimo pede mais que sua sobra" com **R$ 1,00** restante (visto na conta do dono). |

### 2.3 Perfil de custo atual [verificado, últimas 24 h e `pg_stat_statements`]

Rotinas por minuto ou quase:

| Job | Execuções/24 h | Observação |
|---|---|---|
| `split-message-pipeline-1m` | 1.440 | ~300 ms médios; **acumulado 6.296 s**; chama Edge Function sem checar fila |
| `finance-current-snapshot-worker-1m` | 1.440 | chama Edge Function **sem `EXISTS`**; ~122 mil chamadas `net.http_post` no acumulado |
| `whatsapp-send-dispatch-1m` | 1.440 | já tem a guarda `EXISTS` na fila [verificado]; custo ~29 ms |
| `documents-cleanup-2m` | 720 | |
| `ops-alerts-5m` | 288 | **~4,2 s por execução** (3.400 s acumulados) |
| `nino-intelligence` (diagnóstico) | 33 | ~4,2 s médios, até 18 s |

Outros pontos:
- Consulta de Realtime (WAL): **574 mil chamadas, 6.079 s** acumulados. Cada cliente conectado paga esse custo.
- Crescimento do diagnóstico, **sem política de retenção encontrada** (só limpeza de backtest e uma limpeza pontual de eventos): `nino_diagnosis_snapshots` com 24.277 linhas (51 MB) para 12 usuários em 86 dias; `financial_situation_evidence` 53.373 linhas (27 MB); `financial_situation_events` 3.448 linhas (19 MB). **[derivado]** cerca de 8 MB por usuário em 86 dias; sem retenção, 10 mil usuários dariam da ordem de **80 GB só nessas três tabelas**. O tick incremental feito hoje reduz as gravações, mas a retenção continua faltando.
- **A evidência é o maior desperdício [verificado]:** 51.571 das 53.373 linhas (96,6%) são cópia exata da linha anterior da mesma situação (500 a 2.000 linhas por situação). A trava anti-duplicação (`nino_diag_evidence_dedupe_guard`) existe no repositório (migração `20260917130000`) mas **não existe em produção**. A evidência segue crescendo 1,3 a 1,7 mil linhas por dia com 12 usuários.
- **O banco e o repositório divergem [verificado]:** 473 migrações aplicadas contra 499 arquivos; os carimbos de versão diferem, então a comparação é por conteúdo. A migração de "Free readiness" (trava de evidência, dedupe de eventos, snapshot idempotente) não está aplicada. Falta uma reconciliação completa por conteúdo.
- **Dependência escondida [verificado]:** o painel de saúde (`admin_platform_status`) marca um job como "atrasado" após 30 min sem batimento (`job_heartbeats`). Cortar as chamadas ociosas de um poller sem manter um batimento barato causaria falso alarme.
- Um incidente já ocorreu: a fila de categorização reescrevia 1.111 linhas por minuto (52 milhões de atualizações). Corrigido (PR #340), mas é o padrão que as regras R2 e R6 previnem.

### 2.4 Guardas que já existem e devemos reaproveitar [verificado]
- Cache derivado por `ledger_version` + `DENO_DEPLOYMENT_ID` (`derived/cache.ts`).
- Fila de refresh do snapshot disparada por gatilho em `transactions`, ignorando UPDATE técnico.
- Realtime só em `financial_ledger_versions`.
- `check-performance-architecture.mjs`, `check-agent-dependents.mjs`, `check-tx-selects.mjs`, teste de paridade do `finance-core`.
- Janelas de ledger limitadas (3 meses para trás, 1 para frente por padrão).

### 2.5 Fatura de cartão: natureza e metodologia [verificado nos dados do dono]

**Pergunta:** a fatura é compromisso fixo? **Resposta:** não como um todo, e também não é só variável. É **mista**.

Metodologia (3 testes): (1) natureza do custo (fixo, variável, misto); (2) compromisso = obrigação já contratada, paga independentemente de decisões futuras (a mesma lógica do "comprometimento de renda" como serviço da dívida; critério de conhecimento geral, não verificado aqui); (3) substância sobre forma e competência contra caixa: a fatura é o meio de pagamento, o que importa é o conteúdo; contar a fatura e as compras é dupla contagem.

Composição das faturas do dono por mês de competência (transações de cartão):

| Mês | À vista | Parcelas | Parcelas antecipadas | Total | % parcelas |
|---|---|---|---|---|---|
| Jul | 3.582,19 | 2.107,52 | – | 5.689,71 | 37% |
| Ago | 1.500,03 | 2.888,68 | – | 4.388,71 | 66% |
| Set | 2.228,83 | 3.398,52 | – | 5.627,35 | 60% |
| Out | 689,79 | 4.536,41 | 4.252,02 | 9.478,22 | 48% (45% antecipadas) |

Cronograma de parcelas futuras (`credit_card_installments`, alimentado pelas faturas enviadas; a antecipação aparece como parcela **cancelada** nos meses futuros):

| Mês | Agendadas | Canceladas |
|---|---|---|
| Nov | R$ 1.661,98 (19) | R$ 1.755,11 (4) |
| Dez | R$ 686,38 (9) | R$ 949,12 (2) |
| Jan | R$ 411,15 (5) | R$ 949,12 (2) |
| Fev | R$ 49,52 (2) | R$ 949,12 (2) |
| Mar | – | R$ 949,12 (2) |

**Definição proposta:** compromissos conhecidos de um mês = recorrências + parcelas de dívida + **parcelas de cartão agendadas (não canceladas)** do cronograma. A fatura em aberto é item de **caixa e calendário**, decomposta por conteúdo, nunca somada como compromisso. Antecipação é liquidação que reduz compromissos futuros. Em outubro, com parcelas de cartão, os compromissos do dono foram R$ 8.579,25 (**77,8%** da renda média), não 102% nem 37%.

**Correção:** uma estimativa anterior (cerca de R$ 2,6 mil/mês por mais 5 meses, saldo de R$ 6,9 mil) foi **retirada**: ignorava antecipações e quitações; vale o cronograma acima.

**Pontos abertos:** (a) a cobertura depende das faturas enviadas (fatura não importada = parcela futura ausente); a definição deve declarar a confiança; (b) em novembro há 4 parcelas canceladas (R$ 1.755,11) mas só 2 lançamentos marcados como antecipados (R$ 1.053,92): reconciliar antes de contar com o número.

## 3. Matriz de risco de regressão

| Mudança planejada | O que pode quebrar | Salvaguarda |
|---|---|---|
| Unificar definições (competência, renda base, compromissos) | Avisos proativos e Home mudam de número; mensagens já enviadas ficam inconsistentes; agente cita valor diferente | Modo **sombra**: calcular o novo e o antigo para os 12 usuários, relatório de diferenças, **nenhuma mensagem muda** até o relatório ser aceito. Atrás de flag. |
| Livro de causas em `finance-core` | Divergência entre cópia do app e das Edge Functions; payload do `home-snapshot` cresce | `sync-finance-core` + teste de paridade; campo **novo e opcional** (contrato `home_snapshot.v5` aditivo); limite de tamanho no payload. |
| Novos cards na Home | `check-performance-architecture` (Home não pode baixar diagnóstico completo nem abrir segundo caminho de leitura); lentidão ao abrir | Os cards leem **o mesmo** `home-snapshot`; sem chamada nova; teste de arquitetura estendido. |
| Revisão dos alertas | Perder alerta útil; duplicar com o diagnóstico; estourar o orçamento de atenção | Passar pelo governador existente; teste de dedup por assunto; contagem antes/depois por tipo. |
| Mexer em funções `nino_*` do SQL | Quebra o consumo pelo agente (`AgentCore`), por avisos proativos e pelo admin | `check-agent-dependents` + testes de contrato; funções novas ao lado das antigas, troca por flag. |
| Qualquer cron novo ou alterado | Custo e contenção | R1/R2; medir antes e depois com `pg_stat_statements`. |

## 4. Desenho alvo (sem rotina nova)

**Livro de causas** (`finance-core/causeLedger.ts`, espelhado): função pura.
- Entrada: o **mesmo** ledger compacto que o `home-snapshot` já carrega + os indicadores do Mapa (renda típica, essenciais, reserva, compromissos).
- Saída `CauseLedger` v1: sintoma, decomposição por **identidade contábil** (variação do caixa livre = Δ renda − Δ fixos − Δ parcelas − Δ variáveis − Δ pontuais ± timing), **resíduo não explicado**, mecanismo por regra (estrutural, calendário, compromissos antecipados, comportamento, reserva), confiança e referências de evidência. Linguagem: fato e associação afirmam; hipótese comportamental só como pergunta (guarda do Mapa já existente).
- **Onde roda**: dentro do `home-snapshot`, já cacheado por versão do ledger. Custo marginal: CPU em memória, **zero consultas novas**.

**Alertas de antecipação** derivam do mesmo snapshot (ritmo e projeção, meta de categoria consumida, compromissos próximos) e carregam o "motor" do alerta (o que pesa) com link para o "por quê". Passam pelo governador existente. Disparo: mudança de ledger (fila que já existe) e a rodada horária (`agent-proactive-hourly`, que já existe).

**Agente conversacional**: "por quê?" lê o livro de causas por ferramenta (cache), com o ancoramento de aviso que já foi feito.

**Orçamento alvo por usuário ativo/dia [provisório]:** 0 jobs novos; ≤ 1 leitura de cache por abertura da Home; escrita só quando o ledger muda; snapshot de diagnóstico só quando o conteúdo muda; retenção de 90 dias para histórico fino.

## 5. Fases, critérios de saída e reversão

| Fase | Entrega | Critério de saída | Reversão |
|---|---|---|---|
| **F0** | Guarda `EXISTS` nos pollers do snapshot e dos lembretes da divisão (com batimento barato), trava de evidência duplicada, retenção de 90 dias e compactação única da evidência. Migrações `20261030120000` a `120300` (A a D **aplicadas em produção em 30/10**) | Chamadas ociosas caem; nenhum job falha nem aparece "atrasado"; evidência deixa de crescer; custo medido antes/depois | Restaurar as funções anteriores e `cron.alter_job` |
| **F1** | Definições únicas (compromissos a partir do cronograma de parcelas, sem a fatura aberta) + modo sombra do diagnóstico novo | Relatório de diferenças dos 12 usuários explicado; testes de paridade SQL↔TS com gabarito SQL independente | Flag desligada |
| **F2** | `causeLedger` + casos de ouro (a piora real da conta do dono: julho, agosto, outubro) | Decomposição fecha com o gabarito; resíduo declarado; zero causa inventada | Campo opcional ignorado |
| **F3** | Home: "Por que está assim?" e "O que vem pela frente", atrás de flag | `check-performance-architecture` verde; sem consulta nova; tempo de abertura igual ou menor | Flag |
| **F4** | Revisão de qualidade dos alertas | Alertas sem ação possível removidos; dedup com diagnóstico; contagem por tipo antes/depois | Flag |
| **F5** | Abertura gradual da flag | Zero resposta errada nos casos de ouro; custo por usuário dentro do orçamento | Flag |

### 5.1 Resultado medido do F0 [verificado em produção, 30/10]
- **Evidência do diagnóstico:** 53.373 → **1.802** linhas (51.571 removidas, exatamente as duplicatas previstas); as 108 situações mantêm evidência. Dois recálculos completos do diagnóstico da conta do dono (8 situações detectadas em cada) gravaram **0** linhas novas (antes, uma por situação por avaliação). Nenhuma mensagem foi criada.
- **Pollers por minuto:** 20 de 20 execuções com sucesso após a mudança; worker do snapshot ~38 ms (antes ~67 ms); batimento dos lembretes da divisão fresco (renovado a cada ≤10 min); 80 lembretes pendentes, 0 vencidos (guarda coerente).
- **Retenção:** job `nino-diagnosis-retention-daily` (04:35 UTC) criado; hoje nada é apagado (dado mais antigo tem 86 dias).
- **Não reclamado:** o tamanho físico da tabela de evidência ficou em 30 MB (o espaço é reaproveitado pelo autovacuum; `VACUUM FULL` trava a tabela e não foi executado).
- **Achado novo:** o batimento de `whatsapp-send` está em 12:06 (mais de 30 min), porque a guarda existente nunca grava batimento em repouso; o painel de saúde tende a mostrar "atrasado" para esse job sem haver falha. Correção proposta, de baixo risco: o mesmo batimento barato dos lembretes.

## 6. Backlog de custo já medido (fora do escopo, mas a regra manda registrar)

Ordenado por retorno/esforço:
1. `finance-current-snapshot-worker-1m` e `split-message-pipeline-1m`: guarda `EXISTS` antes de invocar a Edge Function (corta ~122 mil e ~61 mil chamadas quando ociosos).
2. Retenção das tabelas do diagnóstico (snapshots, evidência, eventos).
3. `ops-alerts-5m` a ~4 s por execução: investigar e/ou reduzir frequência.
4. Custo do Realtime (WAL, 574 mil chamadas): conferir se só o canal esperado está inscrito.
5. `documents-cleanup-2m`: avaliar a guarda `EXISTS` (`whatsapp-send-dispatch-1m` já a tem).

**Extensão proposta do CI:** `check-cost-budget` (em `check-performance-architecture`): falha se houver job com agenda menor que 1 h sem guarda `EXISTS`, ou tabela nova com crescimento sem retenção declarada.

## 7. Decisões que dependem do dono do produto
1. A "casa" do livro de causas é a Home (com ponte para o Mapa) ou o Mapa?
2. Retenção do histórico fino do diagnóstico: 90 dias é aceitável?
3. ~~Podemos executar o F0?~~ Autorizado e concluído (resultados na seção 5.1).
4. O usuário típico do Nino tem renda irregular como a do dono? (Define a base de "renda normal".)

## 8. O que não foi verificado
Reconciliação completa entre as 499 migrações do repositório e as 473 aplicadas (só uma divergência foi confirmada por conteúdo); de onde o Nino lê parcelas futuras além de `credit_card_installments`; o valor exato da fatura em 27/10 (linha sobrescrita). Telas renderizadas; o comportamento do Mapa para outros usuários (só a conta do dono tem flag); custo real do `home-snapshot` por abertura; se o gate estrutural está ativo na conta do dono; a extrapolação para 10 mil usuários é aritmética simples, sem teste de carga.
