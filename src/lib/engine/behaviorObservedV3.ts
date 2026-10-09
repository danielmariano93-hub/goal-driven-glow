/* eslint-disable @typescript-eslint/no-explicit-any */
// Motor canônico da leitura "Nino observa" v3 (`behavior_observed.v3`). Puro;
// espelhado para `_shared/finance-core`.
//
// Diferenças em relação à v2 (auditoria do redesenho de hábitos):
//  - Nota só existe com EVIDÊNCIA SUFICIENTE. Base parcial vira sinal qualitativo
//    (sem nota, sem ranking) e base ausente vira "ainda não sei" — nunca 0.
//  - Volume de acesso ao app (dias de uso, telas de Movimentos/Planejamento) deixa de
//    ser prova de consciência, planejamento ou consistência: demonstra uso, não hábito.
//  - Ausência de dado não vira valor: sem dívida registrada ≠ relação saudável com
//    dívidas; sem projeção ≠ projeção ruim; patrimônio positivo não é constante 7.
//  - Cada dimensão carrega um registro de proveniência (fontes, janela, cobertura,
//    versão do método, o que foi observado, o que falta, o que NÃO prova).
import {
  emotionalScore,
  type BehaviorDimensionKey,
  type EvidenceState,
  type ObservedBehaviorProfile,
  type ObservedDimension,
  type ObservedEvidenceRecord,
  type ObservedFactor,
} from "./behaviorDimensions";
import type { ObservedProfileV2Input } from "./behaviorObserved";

export const OBSERVED_V3_METHODOLOGY_VERSION = "behavior_observed.v3";
const DAY_MS = 86_400_000;

type Confidence = "low" | "medium" | "high";
type Component = { value: number | null; weight: number };

const clamp = (v: number, min = 0, max = 10) => Math.max(min, Math.min(max, v));
const round1 = (v: number | null): number | null => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
const brl = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;

function weighted(components: Component[]): number | null {
  const ok = components.filter((c) => c.value != null && Number.isFinite(c.value) && c.weight > 0) as Array<{ value: number; weight: number }>;
  if (!ok.length) return null;
  const total = ok.reduce((s, c) => s + c.weight, 0);
  return ok.reduce((s, c) => s + c.value * c.weight, 0) / total;
}

function confidenceWeight(v: Confidence) {
  return v === "high" ? 1 : v === "medium" ? 0.75 : 0.5;
}

function historyDays(firstAt?: string | null, now = Date.now()): number {
  if (!firstAt) return 0;
  const t = new Date(firstAt).getTime();
  return Number.isFinite(t) ? Math.max(1, Math.floor((now - t) / DAY_MS) + 1) : 0;
}

function weeksWithCheckins(rows: Array<{ occurred_at: string }>, now: number, days = 35): number {
  const cutoff = now - days * DAY_MS;
  const weeks = new Set<string>();
  for (const row of rows) {
    const d = new Date(row.occurred_at);
    if (!Number.isFinite(d.getTime()) || d.getTime() < cutoff) continue;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    weeks.add(monday.toISOString().slice(0, 10));
  }
  return weeks.size;
}

function scoreFromReserveMonths(months: number): number {
  if (months <= 0) return 0;
  if (months <= 0.5) return months * 4;
  if (months <= 1) return 2 + (months - 0.5) * 4;
  if (months <= 3) return 4 + (months - 1) * 1.5;
  if (months <= 6) return 7 + (months - 3);
  return 10;
}

/** O que cada dimensão NÃO prova (limite editorial fixo, nunca frase positiva universal). */
export const DIMENSION_LIMITS: Record<BehaviorDimensionKey, string> = {
  awareness: "Ter feito check-ins mostra atenção ao tema; não prova que você entende para onde o dinheiro vai, nem que gastar menos é estar consciente.",
  planning: "Metas e compromissos cadastrados mostram intenção de se organizar; só a execução ao longo do tempo diz se o plano funciona. Abrir telas de planejamento não entra na conta.",
  control: "Cumprir limites que você mesmo escolheu é um sinal de controle; gasto alto, sozinho, não prova impulsividade, e gasto baixo não prova autocontrole.",
  consistency: "Repetir um comportamento verificável por semanas indica hábito; vários registros no mesmo dia não formam hábito.",
  security: "Mede liquidez e folga depois dos compromissos já conhecidos; não prova que você está protegido de imprevistos específicos, e não ter dívida não equivale a segurança.",
  wealth: "Aportes recorrentes indicam construção de patrimônio; a frequência não diz se a alocação é boa.",
  calm: "Vem do que você mesmo declara nos check-ins. O Nino não deduz emoção a partir de transações.",
  debt: "Mede o peso e a tendência das dívidas registradas. Não ter dívida cadastrada não significa que não exista nenhuma.",
};

/** O que a dimensão pretende medir (frase humana, sem fórmula). */
export const DIMENSION_INTENT: Record<BehaviorDimensionKey, string> = {
  awareness: "Se você presta atenção ao seu dinheiro e reconhece os próprios padrões.",
  planning: "Se você antecipa e estrutura seus gastos antes de eles acontecerem.",
  control: "Se o seu gasto fica dentro dos limites que você mesmo escolheu.",
  consistency: "Se os seus comportamentos financeiros se repetem de forma estável ao longo das semanas.",
  security: "Se você tem margem para absorver imprevistos sem desorganizar o mês.",
  wealth: "Se você transforma renda em patrimônio de forma recorrente.",
  calm: "Como você mesmo diz que se sente em relação ao dinheiro.",
  debt: "O peso e a tendência das dívidas que você registrou.",
};

type Draft = {
  state: EvidenceState;
  score: number | null;
  confidence: Confidence;
  summary: string;
  source: string;
  factors: ObservedFactor[];
  origin: ObservedEvidenceRecord["origin"];
  window: string;
  coverage: string;
  observed: string[];
  unknown: string[];
  reason: string | null;
};

function finalize(key: BehaviorDimensionKey, d: Draft): ObservedDimension {
  const scored = d.state === "sufficient" && d.score != null;
  return {
    score: scored ? round1(d.score) : null,
    confidence: scored ? d.confidence : "low",
    evidence: d.summary,
    source: d.source,
    factors: d.factors,
    state: scored ? "sufficient" : d.state === "sufficient" ? "partial" : d.state,
    record: {
      state: scored ? "sufficient" : d.state === "sufficient" ? "partial" : d.state,
      origin: d.origin,
      window: d.window,
      coverage: d.coverage,
      methodology_version: OBSERVED_V3_METHODOLOGY_VERSION,
      observed: d.observed.slice(0, 3),
      unknown: d.unknown,
      limit: DIMENSION_LIMITS[key],
      unavailable_reason: scored ? null : d.reason,
    },
  };
}

const f = (key: string, label: string, value: number | null, weight: number | null): ObservedFactor => ({
  key, label, weight, value: value == null || !Number.isFinite(value) ? null : round1(value),
});

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type ObservedV3Options = {
  /** Respostas de contexto da pessoa ainda válidas (padrões e "o que pesa"): evidência declarada de reconhecimento de padrões. */
  declaredContextAnswers?: number;
};

/** Sem reconhecimento declarado de padrões, a consciência medida só por check-ins não passa deste teto. */
export const AWARENESS_CHECKIN_ONLY_CAP = 7;

export function buildObservedProfileV3(input: ObservedProfileV2Input, now: number = Date.now(), opts: ObservedV3Options = {}): ObservedBehaviorProfile {
  const { financialRow, checkins, txStats, goalCycles, planningStats, investmentStats } = input;
  const payload = (financialRow?.payload ?? {}) as any;
  const snapshot = payload?.snapshot ?? {};
  const current = snapshot?.rhythm?.current ?? {};
  const projection = snapshot?.projection ?? {};
  const netWorth = snapshot?.netWorth ?? {};
  const netWorthBridge = snapshot?.netWorthBridge ?? {};
  const performance = snapshot?.periodPerformance ?? {};
  const goals: any[] = Array.isArray(snapshot?.activeCategoryGoals) ? snapshot.activeCategoryGoals : [];

  const txHistory = historyDays(txStats?.first_at, now);
  const checkin30 = checkins.filter((r) => now - new Date(r.occurred_at).getTime() <= 30 * DAY_MS);
  const direct30 = checkin30.filter((r) => r.financial_calm_score != null);
  const legacy30 = checkin30.filter((r) => r.financial_calm_score == null);
  const checkinWeeks = weeksWithCheckins(checkins, now);

  // 1) Consciência — check-ins (reconhecimento declarado). Uso do app e cobertura de
  // categorização automática não entram: não provam que a pessoa entende o dinheiro.
  const awareness = (() => {
    const n = checkin30.length;
    const declared = Math.max(0, Math.floor(opts.declaredContextAnswers ?? 0));
    const countScore = n ? clamp((n / 8) * 10) : null;
    const weekScore = checkinWeeks ? clamp((checkinWeeks / 4) * 10) : null;
    const recognition = declared > 0 ? clamp((declared / 2) * 10) : null;
    const raw = weighted([{ value: countScore, weight: 0.5 }, { value: weekScore, weight: 0.3 }, { value: recognition, weight: 0.2 }]);
    const sufficient = n >= 4 && checkinWeeks >= 2;
    // Check-ins medem atenção ao tema; entender os próprios padrões só se comprova com o que a pessoa reconhece.
    const capped = sufficient && raw != null && declared === 0 && raw > AWARENESS_CHECKIN_ONLY_CAP;
    const score = raw == null ? null : declared === 0 ? Math.min(raw, AWARENESS_CHECKIN_ONLY_CAP) : raw;
    const observed: string[] = [];
    if (n) observed.push(`Você fez ${n} check-in${n === 1 ? "" : "s"} em ${checkinWeeks} semana${checkinWeeks === 1 ? "" : "s"} recente${checkinWeeks === 1 ? "" : "s"}.`);
    observed.push(declared > 0
      ? `Você respondeu ${declared} pergunta${declared === 1 ? "" : "s"} sobre os seus padrões.`
      : "Você ainda não respondeu perguntas sobre os seus padrões; por isso a nota não passa de 7,0.");
    return finalize("awareness", {
      state: sufficient ? "sufficient" : n > 0 ? "partial" : "none",
      score: sufficient ? score : null,
      confidence: "medium", // fonte principal (check-ins): nunca "alta"
      summary: n
        ? `${n} check-in${n === 1 ? "" : "s"} nos últimos 30 dias, em ${checkinWeeks} semana${checkinWeeks === 1 ? "" : "s"}${capped ? "; sem perguntas respondidas sobre padrões, a nota para em 7,0" : ""}.`
        : "Ainda não há check-ins para o Nino ler sua atenção ao dinheiro.",
      source: "checkins+declared_context",
      factors: [f("checkin_count", "Check-ins nos últimos 30 dias", countScore, 0.5), f("checkin_weeks", "Semanas com check-in", weekScore, 0.3), f("recognized_patterns", "Padrões que você reconheceu", recognition, 0.2)],
      origin: [{ key: "checkins", label: "Seus check-ins", kind: "declared" }, { key: "context_answers", label: "Suas respostas sobre padrões", kind: "declared" }],
      window: "últimos 30 dias (respostas: 45 dias)",
      coverage: `${n} check-in${n === 1 ? "" : "s"} em ${checkinWeeks} semana${checkinWeeks === 1 ? "" : "s"} (mínimo: 4 em 2 semanas)`,
      observed,
      unknown: declared > 0 ? ["Se você revisa seus gastos além dos check-ins."] : ["Se você reconhece os seus padrões de gasto: responder as perguntas dos insights ajuda."],
      reason: n ? "Poucos check-ins para uma leitura confiável." : "Nenhum check-in nos últimos 30 dias.",
    });
  })();

  // 2) Planejamento — estrutura (metas, recorrências) SÓ conta com execução verificada.
  const activeGoals = num(planningStats?.active_category_goals) ?? goals.length;
  const recurring = num(planningStats?.active_recurring_rules) ?? 0;
  const closedCycles = goalCycles.filter((c) => c.closed_at || c.final_status);
  const hitCycles = closedCycles.filter((c) => {
    const actual = Number(c.actual_spend), target = Number(c.target_snapshot);
    return Number.isFinite(actual) && Number.isFinite(target) && target > 0 && actual <= target;
  });
  const cycleHitRate = closedCycles.length ? hitCycles.length / closedCycles.length : null;
  const overshoot = closedCycles.length
    ? avg(closedCycles.map((c) => {
        const actual = Number(c.actual_spend), target = Number(c.target_snapshot);
        return Number.isFinite(actual) && Number.isFinite(target) && target > 0 ? Math.max(0, actual / target - 1) : 0;
      }))
    : null;
  const cycleScore = cycleHitRate == null ? null : clamp(cycleHitRate * 10 - Math.min(4, (overshoot ?? 0) * 10));
  const goalsOnTrackCount = goals.filter((g) => ["on_track", "achieved"].includes(String(g?.status))).length;
  const currentGoalScore = goals.length ? (goalsOnTrackCount / goals.length) * 10 : null;

  const planning = (() => {
    const structure = activeGoals > 0 || recurring > 0;
    const goalsStruct = activeGoals > 0 ? clamp((activeGoals / 3) * 10) : null;
    const recStruct = recurring > 0 ? clamp((recurring / 3) * 10) : null;
    const sufficient = structure && closedCycles.length >= 1;
    const score = weighted([{ value: cycleScore, weight: 0.5 }, { value: goalsStruct, weight: 0.3 }, { value: recStruct, weight: 0.2 }]);
    const observed: string[] = [];
    if (activeGoals) observed.push(`${activeGoals} meta${activeGoals === 1 ? "" : "s"} de gasto ativa${activeGoals === 1 ? "" : "s"}.`);
    observed.push(recurring ? `${recurring} compromisso${recurring === 1 ? "" : "s"} recorrente${recurring === 1 ? "" : "s"} cadastrado${recurring === 1 ? "" : "s"}.` : "Nenhum compromisso recorrente cadastrado.");
    if (closedCycles.length) observed.push(`${hitCycles.length} de ${closedCycles.length} ciclo${closedCycles.length === 1 ? "" : "s"} de meta fechou${closedCycles.length === 1 ? "" : "aram"} dentro do limite.`);
    return finalize("planning", {
      state: sufficient ? "sufficient" : structure ? "partial" : "none",
      score: sufficient ? score : null,
      confidence: closedCycles.length >= 3 ? "high" : "medium",
      summary: structure
        ? `Encontrei estrutura de planejamento (${activeGoals} meta${activeGoals === 1 ? "" : "s"}, ${recurring} recorrência${recurring === 1 ? "" : "s"}); ${closedCycles.length ? "há ciclos fechados para verificar a execução" : "ainda não há ciclo fechado para verificar a execução"}.`
        : "Ainda não encontrei metas nem compromissos recorrentes cadastrados.",
      source: "goals+recurring_rules+goal_cycles",
      factors: [f("goals", "Metas de gasto ativas", goalsStruct, 0.3), f("recurring", "Compromissos recorrentes", recStruct, 0.2), f("closed_cycles", "Ciclos de meta cumpridos", cycleScore, 0.5)],
      origin: [
        { key: "goals", label: "Metas que você cadastrou", kind: "direct" },
        { key: "recurring_rules", label: "Compromissos recorrentes", kind: "direct" },
        { key: "goal_cycles", label: "Ciclos de meta fechados", kind: "derived" },
      ],
      window: "metas atuais e ciclos fechados",
      coverage: `${closedCycles.length} ciclo${closedCycles.length === 1 ? "" : "s"} fechado${closedCycles.length === 1 ? "" : "s"} (mínimo: 1)`,
      observed,
      unknown: closedCycles.length ? ["Se as metas foram revisadas e ajustadas ao longo dos meses."] : ["Se as metas foram acompanhadas e cumpridas: ainda não há um ciclo fechado."],
      reason: structure ? "Há estrutura, mas falta execução verificada para avaliar a qualidade do planejamento." : "Sem metas ou compromissos cadastrados.",
    });
  })();

  // 3) Controle — resultado contra limites que a própria pessoa escolheu.
  const control = (() => {
    const sufficient = closedCycles.length >= 1;
    const score = weighted([{ value: cycleScore, weight: 0.65 }, { value: currentGoalScore, weight: 0.35 }]);
    const observed: string[] = [];
    if (closedCycles.length) observed.push(`${hitCycles.length} de ${closedCycles.length} ciclo${closedCycles.length === 1 ? "" : "s"} de meta fechou${closedCycles.length === 1 ? "" : "aram"} dentro do limite.`);
    if (goals.length) observed.push(`${goalsOnTrackCount} de ${goals.length} meta${goals.length === 1 ? "" : "s"} ${goals.length === 1 ? "está" : "estão"} no ritmo neste mês.`);
    return finalize("control", {
      state: sufficient ? "sufficient" : goals.length ? "partial" : "none",
      score: sufficient ? score : null,
      confidence: closedCycles.length >= 3 ? "high" : "medium",
      summary: sufficient
        ? `${hitCycles.length} de ${closedCycles.length} ciclo${closedCycles.length === 1 ? "" : "s"} de meta dentro do limite; as metas deste mês complementam.`
        : goals.length ? `${goalsOnTrackCount} de ${goals.length} metas deste mês no ritmo; ainda não há ciclo fechado.` : "Ainda não há limites escolhidos para medir controle.",
      source: "goal_cycles+current_goals",
      factors: [f("closed_cycles", "Ciclos de meta fechados dentro do limite", cycleScore, 0.65), f("current_goals", "Metas deste mês no ritmo", currentGoalScore, 0.35)],
      origin: [
        { key: "goal_cycles", label: "Ciclos de meta fechados", kind: "derived" },
        { key: "current_goals", label: "Metas deste mês", kind: "derived" },
      ],
      window: "ciclos fechados + mês atual",
      coverage: `${closedCycles.length} ciclo${closedCycles.length === 1 ? "" : "s"} fechado${closedCycles.length === 1 ? "" : "s"} (mínimo: 1)`,
      observed,
      unknown: ["Se os gastos acima do limite foram planejados ou decisões do momento (o Nino só vê o valor)."],
      reason: goals.length ? "As metas deste mês ainda não fecharam: o resultado é parcial." : "Sem metas de gasto para comparar.",
    });
  })();

  // 4) Consistência — repetição de comportamento verificável (ritmo de gasto + check-ins por semana).
  const typical = Array.isArray(current?.series)
    ? current.series.map((r: any) => Number(r?.typicalAmount)).filter((v: number) => Number.isFinite(v) && v > 0)
    : [];
  const consistency = (() => {
    const mean = avg(typical);
    const variance = mean && typical.length >= 14 ? typical.reduce((s: number, v: number) => s + (v - mean) ** 2, 0) / typical.length : null;
    const cv = variance != null && mean ? Math.sqrt(variance) / mean : null;
    const rhythm = cv == null ? null : clamp(10 - cv * 5);
    const weeks = checkinWeeks ? clamp((checkinWeeks / 5) * 10) : null;
    const sufficient = rhythm != null;
    const score = weighted([{ value: rhythm, weight: 0.7 }, { value: weeks, weight: 0.3 }]);
    const observed: string[] = [];
    if (typical.length) observed.push(`${typical.length} dia${typical.length === 1 ? "" : "s"} com ritmo de gasto observado.`);
    if (checkinWeeks) observed.push(`Check-ins em ${checkinWeeks} semana${checkinWeeks === 1 ? "" : "s"} recente${checkinWeeks === 1 ? "" : "s"}.`);
    return finalize("consistency", {
      state: sufficient ? "sufficient" : observed.length ? "partial" : "none",
      score: sufficient ? score : null,
      confidence: typical.length >= 21 && checkinWeeks >= 3 ? "high" : "medium",
      summary: sufficient ? `Ritmo de gasto estável em ${typical.length} dias${checkinWeeks ? ` e check-ins em ${checkinWeeks} semanas` : ""}.` : "Ainda não há semanas suficientes para observar repetição de hábitos.",
      source: "rhythm_stability+checkin_weeks",
      factors: [f("rhythm", "Estabilidade do gasto diário", rhythm, 0.7), f("checkin_weeks", "Semanas com check-in", weeks, 0.3)],
      origin: [{ key: "transactions", label: "Seus lançamentos", kind: "derived" }, { key: "checkins", label: "Seus check-ins", kind: "declared" }],
      window: "últimas semanas",
      coverage: `${typical.length} dia${typical.length === 1 ? "" : "s"} de ritmo (mínimo: 14)`,
      observed,
      unknown: ["Quais hábitos específicos se repetem (aportes, revisão semanal, pagamento em dia)."],
      reason: "Menos de 14 dias de ritmo de gasto para medir estabilidade.",
    });
  })();

  // 5) Segurança — liquidez e folga depois dos compromissos já conhecidos.
  const security = (() => {
    const expense = num(snapshot?.monthlyTotals?.expense);
    const hasExpense = expense != null && expense > 0;
    const available = Math.max(0, num(snapshot?.availableToday) ?? num(financialRow?.available_balance) ?? 0);
    const reserveValue = Math.max(0, num(investmentStats?.emergency_reserve_value) ?? 0);
    const buffer = available + reserveValue;
    const months = hasExpense ? buffer / (expense as number) : null;
    const reserveScore = months == null ? null : scoreFromReserveMonths(months);
    const freeKnown = num(projection?.freeAfterKnownCommitments);
    const freeScore = freeKnown != null && hasExpense ? clamp(5 + (freeKnown / (expense as number)) * 5) : null;
    const sufficient = reserveScore != null && freeScore != null && txHistory >= 30;
    const observed: string[] = [];
    if (months != null) observed.push(`Caixa${reserveValue > 0 ? " + reserva marcada" : ""} cobre cerca de ${months.toFixed(1).replace(".", ",")} ${months < 1.95 ? "mês" : "meses"} das despesas atuais.`);
    if (freeKnown != null) observed.push(freeKnown >= 0 ? `Depois dos compromissos já conhecidos sobram ${brl(freeKnown)} no mês.` : `Os compromissos já conhecidos superam o saldo em ${brl(-freeKnown)}.`);
    return finalize("security", {
      state: sufficient ? "sufficient" : hasExpense ? "partial" : "none",
      // Liquidez é a evidência principal: folga futura não compensa caixa quase zero (teto = reserva + 3).
      score: sufficient ? Math.min(weighted([{ value: reserveScore, weight: 0.7 }, { value: freeScore, weight: 0.3 }]) as number, (reserveScore as number) + 3) : null,
      confidence: reserveValue > 0 && txHistory >= 30 ? "high" : "medium",
      summary: months != null ? `O caixa cobre cerca de ${months.toFixed(1).replace(".", ",")} ${months < 1.95 ? "mês" : "meses"} das despesas atuais.` : "Ainda não há despesas suficientes para estimar sua margem de segurança.",
      source: "liquid_reserve+free_after_commitments",
      factors: [f("reserve", "Meses de despesa cobertos", reserveScore, 0.7), f("free_after_commitments", "Folga após compromissos conhecidos", freeScore, 0.3)],
      origin: [
        { key: "balances", label: "Saldos das suas contas", kind: "direct" },
        { key: "investments", label: "Investimentos marcados como reserva", kind: "direct" },
        { key: "projection", label: "Compromissos previstos", kind: "derived" },
      ],
      window: "mês atual",
      coverage: `${txHistory} dias de histórico (mínimo: 30)`,
      observed,
      unknown: reserveValue > 0 ? ["Imprevistos específicos que podem acontecer."] : ["Nenhum investimento foi marcado como reserva de emergência: a leitura considera só o caixa."],
      reason: !hasExpense ? "Sem despesas no mês para estimar a cobertura." : txHistory < 30 ? "Menos de 30 dias de histórico." : "Sem projeção de compromissos conhecidos.",
    });
  })();

  // 6) Patrimônio — aportes recorrentes; poupança do mês sozinha é apenas sinal parcial.
  const wealth = (() => {
    const contributions = Math.max(0, num(investmentStats?.contributions_90d) ?? 0);
    const days = Math.max(0, num(investmentStats?.contribution_days_90d) ?? 0);
    const income = Math.max(0, num(snapshot?.monthlyTotals?.income) ?? 0);
    const savingsRate = num(performance?.savingsRate);
    const regularity = days > 0 ? clamp((days / 6) * 10) : null;
    const rate = contributions > 0 && income > 0 ? clamp((contributions / (income * 3)) * 50) : null;
    const savings = savingsRate != null ? clamp(5 + savingsRate * 12.5) : null;
    const sufficient = days >= 2;
    const observed: string[] = [];
    if (days > 0) observed.push(`Aportes em ${days} dia${days === 1 ? "" : "s"} nos últimos 90 dias, somando ${brl(contributions)}.`);
    else observed.push("Nenhum aporte registrado nos últimos 90 dias.");
    if (savingsRate != null) observed.push(`Poupança do mês: ${Math.round(savingsRate * 100)}% da renda.`);
    return finalize("wealth", {
      state: sufficient ? "sufficient" : days > 0 || savingsRate != null ? "partial" : "none",
      score: sufficient ? weighted([{ value: regularity, weight: 0.5 }, { value: rate, weight: 0.3 }, { value: savings, weight: 0.2 }]) : null,
      confidence: days >= 4 ? "high" : "medium",
      summary: days > 0 ? `Aportes em ${days} dias nos últimos 90 (${brl(contributions)}).` : "Ainda não há aportes recorrentes para medir construção de patrimônio.",
      source: "investment_contributions+savings",
      factors: [f("contribution_days", "Regularidade dos aportes (90d)", regularity, 0.5), f("contribution_rate", "Aportes sobre a renda", rate, 0.3), f("savings", "Poupança do mês", savings, 0.2)],
      origin: [{ key: "investments", label: "Aportes registrados", kind: "direct" }, { key: "income", label: "Renda do mês", kind: "derived" }],
      window: "últimos 90 dias",
      coverage: `${days} dia${days === 1 ? "" : "s"} com aporte (mínimo: 2)`,
      observed,
      unknown: ["Se há aportes feitos fora do que está registrado no Nino.", "Se a alocação dos investimentos é adequada ao seu objetivo."],
      reason: days === 0 ? "Sem aportes registrados: pode ser que não existam, ou que não tenham sido lançados." : "Poucos aportes para chamar de recorrência.",
    });
  })();

  // 7) Tranquilidade — só o que a pessoa declara. Estimativa antiga nunca vira nota.
  const calm = (() => {
    const values = direct30.map((r) => Number(r.financial_calm_score)).filter(Number.isFinite);
    const legacyValues = legacy30.map(emotionalScore).filter(Number.isFinite);
    const sufficient = values.length >= 3;
    const mean = avg(values);
    const last = direct30.length ? Number([...direct30].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))[0].financial_calm_score) : null;
    const observed: string[] = [];
    if (values.length) observed.push(`${values.length} ${values.length === 1 ? "medição direta" : "medições diretas"} de tranquilidade nos últimos 30 dias${mean != null ? ` (média ${mean.toFixed(1).replace(".", ",")})` : ""}.`);
    if (legacyValues.length) observed.push(`${legacyValues.length} registro${legacyValues.length === 1 ? "" : "s"} antigo${legacyValues.length === 1 ? "" : "s"} são estimativas, não medições, e ficam fora da nota.`);
    return finalize("calm", {
      state: sufficient ? "sufficient" : values.length || legacyValues.length ? "partial" : "none",
      score: sufficient ? mean : null,
      confidence: values.length >= 10 ? "high" : "medium",
      summary: values.length ? `${values.length} ${values.length === 1 ? "medição direta" : "medições diretas"} em 30 dias${last != null && !sufficient ? `; a última foi ${last.toFixed(0)}/10` : ""}.` : "Ainda não há medições diretas de tranquilidade.",
      source: "direct_financial_calm",
      factors: [f("direct", "Tranquilidade informada nos check-ins", mean, 1)],
      origin: [{ key: "checkins", label: "O que você informou nos check-ins", kind: "declared" }],
      window: "últimos 30 dias",
      coverage: `${values.length} ${values.length === 1 ? "medição direta" : "medições diretas"} (mínimo: 3)`,
      observed,
      unknown: ["O motivo das oscilações: o Nino só pergunta, não deduz."],
      reason: "Menos de 3 medições diretas nos últimos 30 dias.",
    });
  })();

  // 8) Dívidas — carga e tendência das dívidas REGISTRADAS. Sem registro ≠ sem dívida.
  const debt = (() => {
    const assets = num(netWorth?.assets) ?? 0;
    const openingDebts = num(netWorthBridge?.openingDebts);
    const closingDebts = num(netWorthBridge?.closingDebts) ?? num(netWorth?.owed);
    const hasDebt = closingDebts != null && closingDebts > 0;
    const reduction = hasDebt && openingDebts != null && openingDebts > 0 ? ((openingDebts as number) - (closingDebts as number)) / (openingDebts as number) : null;
    const trend = reduction == null ? null : clamp(5 + reduction * 15);
    const burden = hasDebt && assets > 0 ? (closingDebts as number) / assets : null;
    const load = burden == null ? null : clamp(10 / (1 + 0.5 * burden));
    const sufficient = hasDebt && load != null && txHistory >= 20;
    const observed: string[] = [];
    if (hasDebt) observed.push(`Dívida registrada de ${brl(closingDebts as number)}${assets > 0 ? ` frente a ${brl(assets)} em ativos` : ""}.`);
    else observed.push("Nenhuma dívida está registrada hoje.");
    if (reduction != null) observed.push(`O saldo devedor ${reduction >= 0 ? "caiu" : "subiu"} ${Math.round(Math.abs(reduction) * 100)}% no período.`);
    return finalize("debt", {
      state: sufficient ? "sufficient" : "partial",
      score: sufficient ? weighted([{ value: trend, weight: 0.4 }, { value: load, weight: 0.6 }]) : null,
      confidence: openingDebts != null && openingDebts > 0 && txHistory >= 20 ? "high" : "medium",
      summary: hasDebt ? `Dívida registrada de ${brl(closingDebts as number)}.` : "Não encontrei dívidas registradas; isso não prova que não existam.",
      source: "debt_trend+debt_load",
      factors: [f("principal_trend", "Tendência do saldo devedor", trend, 0.4), f("debt_load", "Dívida frente aos ativos", load, 0.6)],
      origin: [{ key: "debts", label: "Dívidas que você registrou", kind: "direct" }, { key: "assets", label: "Seus ativos", kind: "direct" }],
      window: "snapshot atual e período anterior",
      coverage: hasDebt ? `${txHistory} dias de histórico (mínimo: 20)` : "nenhuma dívida registrada",
      observed,
      unknown: hasDebt ? ["Atrasos e juros efetivamente pagos (o Nino só vê o saldo)."] : ["Se existem dívidas fora do Nino (cartão, empréstimos, financiamentos)."],
      reason: hasDebt ? (load == null ? "Sem ativos registrados para comparar com a dívida." : "Histórico curto para ler a tendência.") : "Sem dívida registrada: o Nino não avalia uma relação com dívidas que ele não vê.",
    });
  })();

  const dimensions: Record<BehaviorDimensionKey, ObservedDimension> = { awareness, planning, control, consistency, security, wealth, calm, debt };
  const all = Object.values(dimensions);
  const scored = all.filter((d) => d.score != null) as Array<ObservedDimension & { score: number }>;
  const overall = scored.length
    ? scored.reduce((s, d) => s + d.score * confidenceWeight(d.confidence), 0) / scored.reduce((s, d) => s + confidenceWeight(d.confidence), 0)
    : null;
  const confAvg = scored.length ? scored.reduce((s, d) => s + confidenceWeight(d.confidence), 0) / scored.length : 0;
  const profileConfidence: Confidence = scored.length >= 6 && txHistory >= 30 && confAvg >= 0.82 ? "high" : scored.length >= 4 && confAvg >= 0.62 ? "medium" : "low";

  return {
    overallScore: round1(overall),
    coverage: scored.length,
    asOf: financialRow?.as_of_date ?? null,
    dimensions,
    methodologyVersion: OBSERVED_V3_METHODOLOGY_VERSION,
    overallConfidence: profileConfidence,
    historyDays: txHistory,
    partialCount: all.filter((d) => d.state === "partial").length,
  };
}
