# Mapa Financeiro — especificação técnica (v0.2)

Escrita em 16/10/2026. Nada aqui foi implementado. Este documento é o refinamento antes da construção: auditoria do que existe, decisões, contratos de cada motor, fontes de dados, fórmulas, camada de IA, plano de entrega e testes.

Convenções: **[verificado]** = conferido no código ou no banco da conta do dono nesta sessão. **[derivado]** = calculado por mim a partir de fonte citada. **[provisório]** = regra de produto sem base científica, precisa de calibração. **[decisão]** = definido pelo dono do produto.

---

## Status de execução (atualizado em 16/10/2026)

| Fase | Status | Onde |
|---|---|---|
| 0 — Correções imediatas (P-01, P-02, P-03, P-13) | **Feita e em produção** | PR #268 |
| Nome da aba "Mapa Financeiro" (D1) | **Feito e em produção** (rota `/app/mapa`; `/app/emocoes` redireciona) | PR #269 |
| 1 — Fundações (contratos, E0, E1, tabelas, flag, endpoint em sombra) | **Feita e em produção** (em sombra, só conta piloto) | PR #270 |
| 2 — Saúde financeira (E2 a E5, campos novos, captura guiada, UI "Entender") | Motores **em produção** (PR #271); tela e captura guiada **em revisão** | PR da tela |
| 3 — Hábitos (E6 a E8, agendador E13) | Pendente | depois da 2 |
| 4 — Evolução, recomendação e IA (E10 a E12) | Pendente | depois da 3 |
| 5 — Troca do conteúdo da aba e remoção do legado | Pendente | depois da 4 |
| 6 — Validação com pessoas | Pendente | contínuo |

Decisões de produto registradas em 16/10/2026: nome Mapa Financeiro (feito); flag única `mapa_access` por ora, só a conta do dono; captura guiada de taxa/tipo de dívida, liquidez dos investimentos e flag de essencial aprovada; pergunta mensal de estimativa de gasto aprovada (exploratória); piloto só na conta do dono; CFPB mantido em 15 dias.

## 0. Decisões fechadas

| # | Decisão | Fonte |
|---|---|---|
| D1 | O nome da aba passa a ser **Mapa Financeiro** (hoje "Emocional", rota `/app/emocoes`) | [decisão] |
| D2 | **Abandonar notas 0–10** para os pilares de saúde financeira; mostrar valor em unidade natural (meses, % da renda, R$) com status e confiança | [decisão] |
| D3 | Questionário CFPB **a cada 15 dias** (objetivo: o usuário perceber cedo e agir cedo) | [decisão] — riscos e salvaguardas em 6.9 |
| D4 | Estrutura em 3 camadas (Saúde financeira, Hábitos, Bem-estar percebido), sem nota geral única | proposta aceita |
| D5 | Antes de construir: este refinamento | [decisão] |

---

## 1. Escopo

**Dentro:** nova arquitetura de medição e leitura (motores puros, contrato de dados, persistência, evolução, recomendação, camada de IA), nova aba, migração do que existe.
**Fora (não priorizar):** gamificação nova, nota geral, novo sistema de metas (reusar `category_spending_goals`, `weekend_commitments`, `savings goals`), copiar o FinHealth Score (licenciamento).

---

## 2. Auditoria do estado atual (as-is)

### 2.1 Mapa técnico

```
UI (src/pages/Emocoes.tsx, HabitsV2.tsx)
  └─ loadBehavioralDashboardSnapshot (src/lib/behavioral/dashboardSnapshot.ts)
       ├─ RPC behavioral_dashboard_snapshot()  ← SQL: financial_snapshot, stats, goal_cycles, planning/investment stats
       ├─ nino-insights action "goals" (history de metas, #263)
       └─ buildObservedProfileV3 / V2 (src/lib/engine/behaviorObserved*.ts)   ← 8 "dimensões", nota 0–10
Servidor: behavior-observed-weekly + _shared/behavioral/observedRuntime.ts
  └─ MESMO motor via finance-core (espelho gerado), grava behavior_observed_snapshots (semanal, overall_score)
Check-ins: emotional_checkins (mood, financial_calm_score, control, urge)
Contexto: habit_context_answers; roda "Você se deu X": behavioral_assessments
Bem-estar: financial_wellbeing_responses (CFPB, #265)
```

Contratos que já existem e devem ser **reusados**, não recriados:
`finance_contract.v4` (pontes de caixa e patrimônio em `bridges.ts`, inclui `confidence` e `reconciliation_difference`), `reportDashboard.v1`, `spending_goals.v1` (`goalHistory`), `NarrativeEvidencePack`/`NarrativeGuard`, `weekend_commitments`, `fetchAllPages`, ledger canônico (`behavioralMetricAmount`, `reportingCompetenceDate`, `isRealMonthlyMovement`).

### 2.2 Defeitos encontrados (todos [verificado] salvo indicação)

| ID | Defeito | Evidência | Gravidade |
|---|---|---|---|
| P-01 | **Segurança divide o caixa pelo gasto do mês parcial.** `months = (caixa+reserva) / monthlyTotals.expense` e `monthlyTotals` é do mês corrente até hoje. Na conta do dono: caixa R$ 1.437,69 e gasto de outubro até o dia 16 de R$ 1.584,57 dão "0,9 mês". Pelo gasto típico dos 3 meses fechados ([derivado] SQL: ~R$ 22,5 mil, 15,3 mil e 15,9 mil em jul/ago/set) seria ~0,08 mês | `behaviorObservedV3.ts` bloco 5 | **Alta** (número publicado errado em ~10×) |
| P-02 | **Taxa de poupança com renda parcial**: "-643% da renda" = resultado do mês ÷ R$ 208,67 de renda recebida até agora. Aritmética certa, denominador incompleto | `wealth` usa `periodPerformance.savingsRate` | **Alta** (mensagem enganosa) |
| P-03 | **Acompanhamento e Consistência medem uso do app** (nº de check-ins, semanas com check-in) | blocos 1 e 4 | Alta (conceito errado) |
| P-04 | **Planejamento premia existência** (6 metas + 6 recorrências cadastradas) | bloco 2 | Média |
| P-05 | Cumprimento de metas mistura períodos fechados e mês em andamento (corrigido na fonte em #263, ainda sem normalização por tipo de período) | bloco 3 | Média |
| P-06 | Patrimônio sem separar valorização, transferência e resgate usado para pagar dívida (aporte líquido corrigido em #264, ainda parcial) | bloco 6 | Média |
| P-07 | Dívidas sem custo, serviço da dívida, atraso, tipo: **6 de 6 dívidas ativas sem `interest_rate_pct`** na conta do dono; não existe campo de tipo (rotativo, financiamento…) | consulta ao banco | **Alta** |
| P-08 | **Dois motores (v2 e v3) escolhidos por flag ligada a WhatsApp ativo** (`habits_v2_enabled`): leitura diferente por usuário e por canal | `observedRuntime.ts` | Média |
| P-09 | Lógica dividida entre SQL (RPC de snapshot) e TS; já causou divergência (metas, #263) | RPC vs motor | Média |
| P-10 | **Renda irregular não é modelada.** Renda mensal do dono (jun a set, [derivado] SQL): ~R$ 34,5 mil, 7,7 mil, 8,5 mil, 24,4 mil; outubro 0,2 mil até agora. Coeficiente de variação ~0,67. Todo indicador "sobre a renda" é instável | consulta ao banco | **Alta** |
| P-11 | "Despesa essencial" só existe como regex sobre o nome da categoria em `reportDashboard.ts`; `categories` não tem flag | schema | Média |
| P-12 | Investimentos sem classe de liquidez; só `reserve_role` | schema | Média |
| P-13 | **Limiar da escala CFPB errado.** Configurei "variação ≥ 3 pontos conta como mudança". Com confiabilidade marginal 0,89 e escala de desvio ~15, o erro padrão de medida é ~5 e a mudança individual confiável é ~14 pontos [derivado: 15·√(1−0,89) ≈ 5,0; 1,96·√2·5,0 ≈ 13,8; base: relatório técnico do CFPB, tabela 6 e seção 4.3]. O cartão hoje narra ruído | `financialWellBeing.ts` `fwbChange` | **Alta** (comunica mudança que não existe) |
| P-14 | Notas 0–10 e `overall_score` semanal persistidos como se fossem medida; o veredito "melhorou/piorou" deriva deles | `behavior_observed_snapshots` | Alta (conceitual) |
| P-15 | Mensagens proativas recebiam números sem rótulo (corrigido em #264); precisa virar contrato padrão | `NarrativeEvidencePack` | Média |
| P-16 | Dados da conta do dono mostram lacunas de captura: 0 respostas de contexto, 2 compromissos de fim de semana, 6 dívidas sem taxa, 9 categorias de despesa | consultas | Informativo |

### 2.3 O que está bom e fica
Ledger canônico e pontes financeiras, histórico de metas, `weekend_commitments`, explicabilidade ("de onde vem esta nota"), feedback "isso representa minha realidade?", snapshots semanais (estrutura), pipeline de espelhamento `finance-core`, régua de voz e guarda de narrativa.

---

## 3. Princípios de arquitetura

1. **Um só motor, uma só fonte.** Toda fórmula vive em `src/lib/engine/mapa/*` (puro, sem I/O) e é espelhada para as Edge Functions pelo `sync-finance-core`. UI, WhatsApp, assessor e jobs só leem o resultado. Nenhuma fórmula em SQL nem em componente.
2. **Métrica antes de rótulo.** Cada indicador nasce com definição, fórmula, unidade, janela, numerador, denominador, elegibilidade e tratamento de exceção. A nota (quando existir) é derivada, nunca a origem.
3. **Ausência de dado ≠ desempenho ruim.** O estado `insufficient` carrega códigos de motivo e a pergunta ou ação que o resolveria.
4. **Realizado ≠ previsto ≠ estimado.** Cada número carrega `evidence_kind`.
5. **Mês parcial nunca vira razão.** Razões usam meses fechados (ou janela móvel de N dias com cobertura completa de renda).
6. **Renda irregular é cidadã de primeira classe** (E1).
7. **Determinístico primeiro, IA só para redação e conversa**, sempre sobre um pacote de evidências rotulado e guardado (seção 8).
8. **Sem inferência de emoção, causa ou diagnóstico** a partir de transações.
9. **Versionar tudo** (`formula_version`, `contract_version`); mudança de fórmula marca a série como não comparável.
10. **Observabilidade.** Toda leitura registra elegibilidade, flags de qualidade e latência.

---

## 4. Modelo de domínio e contratos

### 4.1 Tipos centrais (TS, em `src/lib/engine/mapa/contracts.ts`)

```ts
export const MAPA_CONTRACT = "mapa_financeiro.v1";

export type Layer = "saude" | "habitos" | "bem_estar";
export type PillarId =
  | "equilibrio" | "seguranca" | "dividas" | "futuro"          // saude
  | "execucao" | "planejamento" | "acompanhamento"             // habitos
  | "bem_estar";                                               // bem_estar
export type Direction = "higher_better" | "lower_better" | "neutral";
export type Status = "ok" | "atencao" | "critico" | "sem_dados";
export type Confidence = "alta" | "moderada" | "insuficiente";
export type EvidenceKind = "ledger" | "balance" | "goal" | "declared" | "estimate" | "derived";

export interface IndicatorReading {
  id: string;                 // ex.: "seguranca.meses_cobertos"
  pillar: PillarId;
  layer: Layer;
  value: number | null;       // null quando sem dados
  unit: "meses" | "pct" | "pct_pontos" | "brl" | "dias" | "contagem" | "pontos_cfpb";
  direction: Direction;       // sentido favorável
  status: Status;
  confidence: Confidence;
  window: { start: string; end: string; kind: "meses_fechados" | "movel_dias" | "pontual"; n: number };
  evidence: EvidenceKind[];
  inputs: Record<string, number | string | null>;   // numerador, denominador, etc. (auditável)
  reasons: string[];          // códigos: "no_income_history", "essential_flag_missing"...
  needs?: { kind: "capture" | "history" | "connect"; code: string }; // o que destrava
  change?: Change | null;
  formula_version: string;
}

export interface Change {
  previous: number | null;
  delta: number | null;
  direction: "melhorou" | "piorou" | "parecido" | "indefinido";   // aplica Direction
  comparable: boolean;
  not_comparable_reason?: "formula_changed" | "data_completeness_changed" | "window_mismatch" | "within_measurement_error";
}

export interface MapaReading {
  contract: typeof MAPA_CONTRACT;
  as_of: string;
  data_quality: DataQuality;          // E0
  income: IncomeBaseline;             // E1
  indicators: IndicatorReading[];
  structural: StructuralFlags;        // E11 gate
  recommendation: Recommendation | null;
  questions_due: QuestionDue[];       // E13
}
```

Invariantes verificadas por teste de contrato: `value===null ⇔ status==="sem_dados"`; `status!=="sem_dados" ⇒ confidence!=="insuficiente"`; `unit` coerente com `id`; `change.direction` respeita `direction`; nenhum campo com `NaN`/`Infinity`.

### 4.2 Persistência

- `map_readings` (nova): `user_id, as_of date, period_kind ('semanal'|'mensal'), indicator_id, value numeric, unit, status, confidence, data jsonb (inputs, window, reasons), formula_version, contract_version, created_at`; `unique(user_id, as_of, period_kind, indicator_id)`; RLS por dono; índices por `(user_id, indicator_id, as_of desc)`.
- `financial_wellbeing_responses` (existe): manter. Adicionar `deferred_at` e `skipped` no scheduler (E13), não nesta tabela.
- `map_questions` (nova): `id, user_id, kind, due_at, asked_at, answered_at, skipped_at, channel, payload jsonb`.
- `behavior_observed_snapshots` e `behavioral_assessments`: **congeladas** (somente leitura), mantidas para histórico; o Mapa não as usa para evolução.

### 4.3 Endpoint
Ação nova `map` em `nino-insights` (ou função `mapa-financeiro`) que: carrega dados paginados, roda E0→E11, devolve `MapaReading`. Cache por `evidence_hash` (hash dos insumos) com TTL curto. Cron semanal grava `map_readings`.

---

## 5. Fontes de dados

| Fonte | Tabelas/contratos | Uso | Lacuna / ação |
|---|---|---|---|
| Lançamentos | `transactions` (competência, `movement_kind`, `settles_card_id`, estorno) via ledger canônico | E1, E2, E5, E6 | já paginado (`fetchAllPages`) |
| Saldos e cartões | contas, `card_exposure.v2`, `financial_current_snapshots` | E2, E3 | confiança de conciliação vem das pontes |
| Compromissos futuros | agenda deduplicada (recorrências, parcelas, faturas, dívidas) | E2, E7 | separar certo × estimado (existe) |
| Renda esperada | `incomeProjection.ts` (configurada ou inferida) | E1 | rotular como estimativa |
| Dívidas | `debts` (saldo, parcela, vencimento, `interest_rate_pct`) | E4 | **capturar taxa e tipo** (P-07) |
| Investimentos | `investments`, `investment_movements`, `reserve_role` | E3, E5 | **classe de liquidez** (P-12) |
| Metas | `category_spending_goals`, ciclos, `goalHistory` | E6, E7 | normalizar tipos de período |
| Compromissos de fim de semana | `weekend_commitments` | E6 | usar como `Commitment` |
| Categorias | `categories` | E3 | **flag essencial** (P-11) |
| Check-ins | `emotional_checkins` | só E0 (qualidade/atualização) e insight emoção×gasto | sai da nota de qualquer pilar |
| Contexto | `habit_context_answers`, `observed_feedback` | E7, E8 | 0 respostas na conta do dono |
| Bem-estar | `financial_wellbeing_responses` | E9 | texto PT validado: 3/10 itens |

**Novos campos mínimos (migrações):** `categories.essential boolean null` (tri-estado: null = não confirmado), `investments.liquidity text` (`d0|d1|d30|longo|desconhecida`), `debts.kind text` (`cartao_rotativo|emprestimo_pessoal|financiamento|cheque_especial|informal|outro`), uso obrigatório-assistido de `debts.interest_rate_pct` (captura guiada, aceita "não sei").

---

## 6. Motores: contrato, regras e fórmulas

Notação: **meses fechados** = meses civis completos em America/Sao_Paulo, data de competência (`reportingCompetenceDate`). `W` = até 6 meses fechados mais recentes, mínimo 3 para razões.

### E0 — Data Quality Gate (DQG)
**Entrada:** contas/cartões, última sincronização, lançamentos, diferença de conciliação das pontes.
**Saída:** `DataQuality { months_history, closed_months, accounts_covered, last_sync_age_days, reconciliation_difference, duplicate_suspects, flags[], eligibility: Record<indicatorId, 'ok'|'parcial'|'bloqueado'> }`.
**Regras:** `closed_months<3` ⇒ razões de renda bloqueadas; `reconciliation_difference` acima de tolerância ⇒ `confidence` máxima "moderada" para tudo que usa caixa; sync de Open Finance > 7 dias ⇒ aviso. Check-in e frequência de registro entram aqui como **qualidade/atualização do dado**, nunca como nota de pilar.

### E1 — Income Baseline (novo, base de todas as razões)
```
I_m = renda operacional do mês fechado m (ledger, competência)
typical = mediana(I_m, W)
CV = desvio_padrao(I_m, W) / media(I_m, W)       // zeros contam
regularity = regular (CV<0,25) | variavel (0,25–0,6) | irregular (>0,6)   [provisório]
```
Saída: `{ typical, regularity, months_used, mtd_received, confidence }`. Mês corrente **só** aparece como "recebido até agora", nunca em razão. Exemplo [derivado]: renda do dono jun–set ⇒ mediana ≈ R$ 16,4 mil, CV ≈ 0,67 ⇒ **irregular**.

### E2 — Equilíbrio (saúde)
Indicadores (todos sobre meses fechados):
- `equilibrio.resultado_3m` (R$): Σ(renda + estornos − consumo) dos 3 últimos fechados.
- `equilibrio.taxa_poupanca_3m` (% da renda): `Σresultado / Σrenda` (agregado, não média de taxas). Exige Σrenda>0 e ≥2 meses com renda. Mês parcial excluído (corrige P-02).
- `equilibrio.cobertura_30d` (razão): `(caixa + entradas certas 30d) / (compromissos 30d + fatura)`; variante `com_estimativa` separada. Direction: higher_better; ok ≥ 1.
- `equilibrio.tendencia` (R$/mês): inclinação OLS do resultado nos últimos 4–6 fechados; só narra se |inclinação| > 0,5×desvio.
Consumo exclui transferência, pagamento de fatura, amortização de dívida (já regra do ledger); dívida paga aparece em E4.

### E3 — Segurança e resiliência (saúde)
```
essential_monthly = mediana por mês fechado de [consumo em categorias essenciais confirmadas + parcelas de dívida + recorrências essenciais], deduplicado
  fallback: se <80% do consumo tem flag confirmada ⇒ usa consumo total e rotula "gastos totais" (nunca finge "essenciais")
liquid = Σ caixa (>0 e cheque especial como negativo) + Σ investimentos com liquidity ∈ {d0,d1,d30}
meses_cobertos = liquid / essential_monthly                // denominador = típico de meses fechados, NUNCA o mês parcial (corrige P-01)
```
- `seguranca.meses_cobertos` (meses), direction higher_better.
- `seguranca.choque_1_renda` (booleano): `liquid ≥ typical` (OECD-like: pagar despesa de 1 mês de renda sem crédito). Para renda irregular usa mediana e avisa.
- `seguranca.obrigacoes_30d`: razão `liquid / (compromissos 30d)`.
Status [provisório, "referência prática"]: meta de meses por estabilidade da renda — regular 3, variável 4,5, irregular 6. `ok` ≥ meta; `atencao` ≥ 1; `critico` < 1. O texto sempre diz que é referência prática e não regra científica.

### E4 — Dívidas (saúde)
- `dividas.comprometimento_renda` (% da renda típica): `Σ parcela mensal normalizada / typical`. Exige E1 com `closed_months≥3`. [provisório] atenção > 35%, crítico > 50%.
- `dividas.atrasos` (contagem e R$): `next_installment_due < hoje` + cartão em atraso.
- `dividas.custo_medio` (% a.m.): média ponderada pelo saldo de `interest_rate_pct`; exige taxa em ≥ 70% do saldo, senão `sem_dados` com `needs: capture:debt_rate` (hoje 6/6 faltam).
- `dividas.trajetoria` (R$ e %): variação do principal pela ponte patrimonial excluindo novas contratações (`loan_proceeds`) e juros; `novas_contratacoes_90d`.
- `dividas.perfil`: composição por `kind` (rotativo × longo prazo); sem `kind`, não classifica.
Nunca avalia pelo saldo bruto (R$ 66 mil não é bom nem ruim sozinho).

### E5 — Construção de futuro (saúde)
Usa `computeNetWorthBridge` sem refazer conta:
- `futuro.patrimonio_liquido_3m` (R$): variação decomposta em resultado operacional, rendimento, valorização, amortização de dívida, juros, **resgates e aplicações como transferências, não resultado**.
- `futuro.poupanca_liquida_3m` (R$): resultado operacional dos meses fechados.
- `futuro.progresso_metas` (%): metas de poupança, progresso × ritmo.
- `futuro.resgates_explicados`: etiqueta heurística [provisório] de resgate usado para dívida (pagamento de dívida em até 7 dias do resgate). Sem etiqueta ⇒ "uso não identificado", nunca "destruiu patrimônio".
Corrige P-06.

### E6 — Execução (hábitos)
Abstração `Commitment { id, kind: 'meta_categoria'|'fim_de_semana'|'poupanca_recorrente', period, target, realized, status: 'cumprido'|'estourado'|'em_andamento' }` construída sobre `goalHistory` e `weekend_commitments` (sem criar tabela nova de metas).
- `execucao.aderencia` (% dos períodos comparáveis cumpridos): `cumpridos / (cumpridos+estourados)` nos últimos K ≥ 3 períodos **do mesmo tipo**; exige n ≥ 3, senão `sem_dados`.
- `execucao.sequencia`: períodos consecutivos cumpridos.
- `execucao.revisoes`: nº de ajustes do plano (meta editada com histórico preservado).
Repetição = **regularidade**, nunca "hábito formado" (Lally: automaticidade varia muito entre pessoas).

### E7 — Planejamento (hábitos)
- `planejamento.viabilidade` (razão): `(essential_monthly + Σ contribuições mensais de metas + compromissos recorrentes não essenciais) / typical`. ≤ 1 cabe; > 1 não cabe. Depende de E1.
- `planejamento.recorrentes_registrados` (%): recorrências **detectadas no histórico** (detector de padrão recorrente) que já estão cadastradas ÷ detectadas. (A "cobertura das despesas conhecidas" proposta antes é circular: o motor já inclui tudo que está cadastrado.)
- `planejamento.intencionalidade` (% planejado): respostas voluntárias "já planejo" ÷ respondidas, últimos 90 dias, n ≥ 5.
Não premia quantidade de metas (corrige P-04).

### E8 — Acompanhamento (hábitos)
- `acompanhamento.calibragem_total` (% de erro): pergunta mensal "quanto você acha que gastou no mês passado?"; `|estimado − real| / real`; direction lower_better; exige ≥ 2 respostas.
- `acompanhamento.categoria_que_mais_pesou` (acerto booleano e tendência).
- `acompanhamento.reconhecimento_padroes` (%): "isso faz sentido?" ≥ "sim" ÷ respondidas.
Marcado **exploratório** na UI (construto novo, sem validação da literatura). Sem respostas ⇒ `sem_dados` com `needs: capture:estimativa_mensal`.

### E9 — Bem-estar percebido (CFPB)
- Pontuação oficial (já implementada): soma 0–40 → tabela 18–61 / 62+ → 14–95.
- **Cadência: 15 dias [decisão D3].**
- **Variação confiável:** `RCI = 1,96·√2·SEM`, `SEM = 15·√(1−ρ)`, ρ = 0,89 (18–61, online) ⇒ **≈ 14 pontos** [derivado do relatório técnico do CFPB]. Regras de narrativa:
  - |Δ| < 14 ⇒ "dentro da variação normal da medida" (nunca "subiu/caiu");
  - |Δ| ≥ 14 ⇒ "mudança que vai além do esperado pela medida";
  - **tendência** só com ≥ 4 medições: média das 2 últimas × 2 anteriores, mesmo critério.
  O SEM em IRT varia ao longo da escala (maior nos extremos); 14 é aproximação, marcar [provisório] e revisar quando houver dados próprios.
- Sem narrativa por item isolado (item único é mais ruidoso).
- Texto PT: itens 2, 3 e 10 validados; 7 de tradução do Nino (pendente de obter a versão final dos autores).

### E10 — Evolução
Entrada: `map_readings` + leitura atual. Saída: `Change` por indicador.
Regras: janelas comparáveis (mensal×mensal, mesma janela); `comparable=false` se `formula_version` mudou, se a **completude** dos dados mudou (ex.: nova conta importada) ou se a janela difere; `direction` aplica o sentido favorável (dívida que cai = melhorou); margem de "parecido" por indicador (em % do valor ou erro de medida no E9); nunca compara mês parcial.

### E11 — Prioridade e recomendação
**Gate estrutural primeiro:** `structural = essential_monthly/typical > 0,8` ou `comprometimento_renda > 0,5` ou `equilibrio` negativo em 3 de 3 meses. Se estrutural, a recomendação é estrutural (renegociar, revisar essenciais, aumentar renda) e **não** dica de comportamento (COM-B: capacidade e oportunidade antes de motivação). Senão:
`prioridade = severidade × reversibilidade × confiança`; escolhe **uma** ação mapeada a recurso existente (criar/ajustar meta, compromisso de fim de semana, revisar recorrências, plano de dívida). Contrato: `Recommendation { id, indicator_ids, evidence_refs, rationale_keys, action:{type, deeplink, params}, suppress_until, guardrails[] }`. Respeita feedback (não repete o recusado) e orçamento de atenção (máx. 1 recomendação ativa). Lazer alto com tudo mais em dia **não** gera recomendação.

### E12 — Camada de IA (ver seção 8)

### E13 — Captura de contexto e agendador de perguntas
`QuestionDue { kind: 'cfpb'|'estimativa_mensal'|'planejado_vs_hora'|'taxa_divida'|'essencial_categoria'|'liquidez_investimento', reason, priority }`.
Orçamento de atenção [provisório]: máx. 1 pergunta ativa por dia e 3 por semana (exceto CFPB a cada 15 dias, que é independente); cada pergunta tem "pular" e "depois"; pular registra `skipped_at` e adia 7 dias; canal app e WhatsApp com a mesma `map_questions`. Pergunta só existe se destrava um indicador (`needs`) ou valida uma recomendação.

---

## 7. Cálculos de referência (casos de teste dourados)

Fixtures geradas por script a partir da conta do dono, anonimizadas, e casos sintéticos:

| Caso | Entrada | Esperado |
|---|---|---|
| G1 mês parcial | caixa 1.437,69; gasto típico 17,9 mil; gasto MTD 1,6 mil | Segurança ≈ 0,08 mês (nunca 0,9); `reasons` sem "mes_parcial" |
| G2 renda parcial | renda MTD 208,67; resultado −1.341 | `taxa_poupanca_3m` usa só meses fechados; outubro não entra |
| G3 renda irregular | renda 34k, 7,7k, 8,5k, 24k | `regularity=irregular`, meta de reserva 6 meses |
| G4 patrimônio com resgate | aplicou 8k, resgatou 10,6k em 90d; 1 resgate pago a dívida | patrimônio decomposto; resgate "usado para dívida" etiquetado, não "queda" |
| G5 dívida sem taxa | 6 dívidas, 0 com taxa | `custo_medio: sem_dados`, `needs: capture:debt_rate` |
| G6 CFPB ruído | 50 → 56 | "dentro da variação normal" |
| G7 CFPB mudança | 44 → 60 | "mudança além do esperado" |
| G8 estrutural | essenciais 85% da renda | recomendação estrutural, sem dica de comportamento |
| G9 sem histórico | 1 mês de dados | todos os pilares de razão `sem_dados` com `needs: history` |

---

## 8. Camada de IA (engenharia de IA)

**Onde a IA entra:** (a) redigir a explicação da recomendação e o resumo do Mapa; (b) conversar sobre o Mapa no app e no WhatsApp; (c) classificar respostas livres de contexto (opcional, com baixa confiança ⇒ pergunta de confirmação). **Onde não entra:** nenhuma nota, status, limiar, cálculo ou escolha de recomendação.

**Contrato de entrada — `MapaEvidencePack`** (extensão do `NarrativeEvidencePack`):
`facts[]` (cada fato com `label` em português, `value`, `unit`, `evidence_kind`, `window`, `confidence`), `allowed_numbers`, `allowed_claims`, `prohibited_claims` (causa, emoção, diagnóstico, juízo moral, promessa, "você deveria gastar menos" sem passar pelo gate estrutural), `tone` (régua de voz existente), `reading_level`.
**Contrato de saída:** JSON `{ title, body, bullets?, question? }` validado por esquema.
**Guarda (pós-geração, determinística):** todo número do texto ∈ `allowed_numbers` (já existe); unidade e rótulo coerentes; sem termos proibidos; limites da régua de voz (`checkNotificationVoice`); `audit-copy`; se falhar ⇒ fallback para template determinístico (nunca envia texto reprovado).
**Avaliação (offline, antes de cada mudança de prompt/modelo):** conjunto de ≥ 60 pacotes (G1–G9 e adversariais: renda irregular, sem dados, pobreza estrutural, dívida alta, usuário em sofrimento); métricas: fidelidade factual (100% dos números permitidos), 0 afirmações causais/emocionais/diagnósticas, taxa de fallback, legibilidade; amostragem com LLM-juiz e revisão humana. Prompts versionados; telemetria `llm_calls` já existente.
**Custo, latência e privacidade:** chamadas só em eventos (abrir Mapa com cache por `evidence_hash`, recomendação nova); modelo pequeno para redação; o pacote leva agregados e rótulos, **sem descrições cruas de transações, nomes de pessoas ou identificadores**. Respostas do CFPB são dado pessoal sensível: finalidade declarada, exclusão e exportação (LGPD), não vão ao prompt (apenas "bem-estar percebido: faixa").

---

## 9. Experiência (arquitetura de informação, não design visual)

Três camadas na aba **Mapa Financeiro**:
1. **Entender** — três blocos (Saúde financeira, Hábitos, Bem-estar). Cada indicador: valor em unidade natural, chip de status, seta de evolução com sentido favorável, selo de confiança, "de onde vem" (fonte, janela, cobertura). Pilar sem dado mostra o que falta e um botão para resolver.
2. **Agir** — **uma** recomendação priorizada, com a evidência e a ação (deeplink).
3. **Evoluir** — histórico comparável, compromissos assumidos e seu resultado, percepção declarada.

Percepção × observado: sem "Nino 7,0 × Você 3,0". Pergunta-se a percepção **onde a unidade casa** (ex.: "quantos meses sua reserva cobre?" × valor real) e mantém-se "isso representa minha realidade? Sim / Em parte / Não".

### 9.1 Salvaguardas do ciclo de 15 dias (D3)
Risco: em 15 dias, mudança real do CFPB costuma ficar abaixo do erro de medida (≈ 14 pontos), então a maior parte das leituras será "dentro do normal", o que pode cansar ou parecer que o app "não nota nada". Mitigações aprovadas para o desenho:
- o valor percebido de agir cedo vem dos **indicadores financeiros e de execução (semanais)**, não só do CFPB; o CFPB é o termômetro de bem-estar;
- resultado do CFPB mostra a **série** (últimas medições), não só o último;
- botão "adiar" e "pular"; lembrete suave, nunca insistente;
- métrica de produto monitorada: taxa de resposta por ciclo, abandono, tempo para responder;
- **critério de decisão acordado de antemão:** se a taxa de resposta ficar abaixo de ~40% após 3 ciclos, propor 30 dias (a decisão continua sendo sua).

---

## 10. Migração (strangler)

1. **Sombra:** novo motor roda em paralelo ao v3 para a conta do dono (e, com consentimento, outras), sem UI; relatório de diferenças por indicador.
2. **Flag única** `mapa_enabled(user)` (substitui `habits_v2_enabled`, elimina a divergência por canal, P-08).
3. UI nova atrás da flag, rota `/app/mapa` com redirecionamento de `/app/emocoes`; item de navegação "Mapa Financeiro" (`appNavigationRegistry`, `guide/catalog`).
4. Congelar `behavior_observed_snapshots`/`behavioral_assessments`; remover motores v2/v3 e o job semanal antigo após estabilizar.
5. **Rollback:** desligar a flag volta ao v3 sem perda; leituras novas ficam em `map_readings`.

---

## 11. Plano de entrega

| Fase | Entrega | Esforço | Critério de aceite |
|---|---|---|---|
| **0 — Correções imediatas (valem em qualquer arquitetura)** | P-13 limiar CFPB (3 → ~14 e linguagem "dentro da variação"); P-01 denominador de Segurança (meses fechados); P-02 não exibir taxa com renda parcial; trocar texto de rótulos de Acompanhamento/Consistência para "frequência de uso" até a migração | 1–2 dias | casos G1, G2, G6, G7 verdes; nenhum número publicado com mês parcial |
| **1 — Fundações** | contratos, E0, E1, `map_readings`, `map_questions`, fixtures dourados, endpoint em sombra | 1,5–2 sem | contrato validado, G1–G9 reproduzíveis |
| **2 — Saúde financeira** | E2, E3, E4, E5, campos novos (`essential`, `liquidity`, `debts.kind/taxa`) e captura guiada, UI "Entender" parcial | 3–4 sem | indicadores com unidade natural, `sem_dados` com `needs`, sem nota 0–10 |
| **3 — Hábitos** | E6, E7, E8, agendador E13 | 2–3 sem | aderência sobre períodos comparáveis; planejamento sem premiar quantidade |
| **4 — Evolução, recomendação, IA** | E10, E11, E12 (pacote, guarda, avaliação) | 3 sem | gate estrutural testado; 0 falhas de fidelidade no conjunto de avaliação |
| **5 — Troca de aba** | renomear para Mapa Financeiro, rota, flag, remoção do legado | 1 sem | sombra sem divergência não explicada por 2 semanas |
| **6 — Validação** | testes com pessoas de perfis distintos; acompanhamento individual antes/depois; só então experimento controlado se a base permitir | contínuo | compreensão, ação e resultado, não só engajamento |

Observação: o nome "Mapa Financeiro" entra na Fase 5 para não trocar o rótulo antes de o conteúdo existir. Se preferir trocar antes (rótulo + título), é uma mudança trivial e independente.

---

## 12. Estratégia de testes

- **Unitários** por motor (puros), incluindo casos extremos (zero renda, mês único, dívida sem taxa).
- **Propriedade:** monotonicidade (mais caixa ⇒ meses cobertos não diminui), invariância de unidade, ausência de `NaN`.
- **Contrato:** esquema de `MapaReading` e invariantes da seção 4.1.
- **Dourados:** G1–G9 (seção 7), fixtures do dono geradas por script versionado.
- **Paridade SQL/TS:** onde ainda houver SQL, teste de que o número é idêntico ao do motor.
- **Cópia:** `audit-copy` e régua de voz sobre todo texto gerado e estático.
- **Tela real:** capturas com rede simulada e dados da conta do dono (método já usado), checagem humana dos números.
- **Sombra:** comparativo automático v3 × Mapa com relatório de diferenças.
- **IA:** conjunto de avaliação da seção 8 como portão de CI para mudar prompt ou modelo.
- **Desempenho:** orçamento p95 do endpoint (alvo < 1,5 s com cache), leituras sempre paginadas.

---

## 13. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Muitos `sem_dados` (captura insuficiente) | `needs` com ação direta, agendador com orçamento de atenção, começar pelo que o ledger calcula sozinho |
| Renda irregular quebra razões | E1 com mediana, regularidade e meses fechados; reserva-meta por estabilidade |
| Fadiga de perguntas e do CFPB a cada 15 dias | orçamento de atenção, adiar/pular, métrica de resposta, critério de revisão para 30 dias |
| Texto PT do CFPB não 100% validado | rótulo na tela; obter a versão final dos autores; trocar as 7 frases |
| Limiares [provisório] tratados como fato | marcação explícita no código e na tela ("referência prática") e calibração com dados reais |
| IA escrevendo número ou causa errada | pacote rotulado, guarda determinística, fallback, conjunto de avaliação como portão |
| Divergência SQL × TS | motor único em `finance-core`, SQL só carrega dados |
| Aversão a notas piora ansiedade (alerta do CFPB sobre feedback de pontuação) | linguagem não punitiva, nada de nota geral, foco em ação possível |

---

## 14. Decisões que ainda dependem do dono do produto

1. **Flag de "essencial" nas categorias:** aprovar o fluxo de confirmação pelo usuário (sugestão inicial por categoria, usuário confirma).
2. **Captura guiada de taxa e tipo de dívida** e de **liquidez dos investimentos** (campos novos, com "não sei").
3. **Pergunta mensal de estimativa de gasto** (Acompanhamento): aprovar como construto exploratório.
4. **Fase 0 imediata:** posso corrigir já P-13, P-01 e P-02 em PR separado, antes das fundações?
5. **Consentimento e LGPD** para respostas do CFPB (texto de finalidade, exclusão e exportação).
6. **Piloto da sombra:** só a conta do dono, ou convidar mais pessoas com consentimento?
7. Obter a **versão final em português do CFPB** com os autores (DOI 10.47626/2237-6089-2020-0034).

---

## 15. Fontes

- CFPB, *Measuring financial well-being* (guia, 2015) e *Scale development technical report* (2017): itens, tabela de pontuação, confiabilidade marginal (tabela 6).
- Howat-Rodrigues, Laks e Marinho (2021), versão brasileira do CFPB, [PMC8317546](https://pmc.ncbi.nlm.nih.gov/articles/PMC8317546/).
- Ponchio e Cordeiro (2020), PFWB no Brasil, [RIMAR](https://periodicos.uem.br/ojs/index.php/rimar/article/download/45854/751375150858).
- Harkin et al. (2016), monitoramento de progresso e alcance de metas (meta-análise), [PubMed 26479070](https://pubmed.ncbi.nlm.nih.gov/26479070/).
- Lally et al. (2010), formação de hábitos, [doi:10.1002/ejsp.674](https://doi.org/10.1002/ejsp.674).
- Michie, van Stralen e West (2011), COM-B, [doi:10.1186/1748-5908-6-42](https://doi.org/10.1186/1748-5908-6-42).
- Demais referências de apoio e ressalvas: `docs/economia-comportamental-medicao.md` e `docs/emocional-base-cientifica.md`.
