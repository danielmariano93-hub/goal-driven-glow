import { BEHAVIOR_DIMENSIONS, type BehaviorDimensionKey, type ObservedBehaviorProfile, type ObservedDimension, type ObservedFactor } from "./behaviorDimensions";

// Evolução dos hábitos: compara a leitura observada de agora com a de um
// snapshot antigo e explica a diferença pelos componentes de cada dimensão.
// Puro e sem I/O. O Nino só afirma "melhorou/piorou" quando há dois pontos
// reais para comparar; sem isso diz que ainda não dá para comparar.

export const BEHAVIOR_CHANGE_THRESHOLD = 0.5;
const DAY_MS = 86_400_000;

type Confidence = "low" | "medium" | "high";

export type SnapshotDimension = { score: number | null; confidence: Confidence; factors?: ObservedFactor[] };

export type ObservedSnapshot = {
  week_start: string;
  overall_score: number | null;
  coverage: number;
  confidence: Confidence;
  methodology_version?: string;
  dimensions: Partial<Record<BehaviorDimensionKey, SnapshotDimension>>;
};

export type ChangeDirection = "better" | "worse" | "same" | "new";

export type FactorChange = { key: string; label: string; value: number | null; previous: number | null; delta: number | null; weight: number | null; impact: number | null };

export type DimensionChange = {
  key: BehaviorDimensionKey;
  label: string;
  score: number | null;
  previous: number | null;
  delta: number | null;
  direction: ChangeDirection;
  /** Menor confiança entre a leitura atual e a base. */
  confidence: Confidence;
  evidence: string;
  factors: FactorChange[];
  /** Componentes que mais explicam a variação (ou, sem base, os que mais pesam na nota). */
  drivers: FactorChange[];
  why: string;
};

export type BehaviorVerdictKind = "better" | "same" | "worse" | "insufficient";

export type BehaviorVerdict = {
  kind: BehaviorVerdictKind;
  headline: string;
  summary: string;
  improved: number;
  worsened: number;
  stable: number;
  baselineDate: string | null;
  overallDelta: number | null;
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (v: number) => v.toFixed(1).replace(".", ",");
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function weakestConfidence(current: Confidence, baseline?: Confidence): Confidence {
  if (!baseline) return current;
  return CONFIDENCE_RANK[current] <= CONFIDENCE_RANK[baseline] ? current : baseline;
}

/** Segunda-feira (America/Sao_Paulo) da semana da data. */
export function weekStartOf(date: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Linha gravável do perfil observado de agora. */
export function snapshotFromProfile(
  profile: ObservedBehaviorProfile & { overallConfidence?: Confidence; methodologyVersion?: string },
): Omit<ObservedSnapshot, "week_start"> {
  const dimensions: ObservedSnapshot["dimensions"] = {};
  for (const dim of BEHAVIOR_DIMENSIONS) {
    const row = profile.dimensions[dim.key];
    if (!row) continue;
    dimensions[dim.key] = { score: row.score, confidence: row.confidence, factors: row.factors };
  }
  return {
    overall_score: profile.overallScore,
    coverage: profile.coverage,
    confidence: profile.overallConfidence ?? "low",
    methodology_version: profile.methodologyVersion ?? "behavior_observed.v2",
    dimensions,
  };
}

/**
 * Base de comparação: o snapshot mais recente com ~30 dias; se o histórico ainda
 * é curto, o mais antigo com pelo menos 7 dias. Sem isso, não há comparação.
 */
export function pickBaseline(snapshots: ObservedSnapshot[], today: string): ObservedSnapshot | null {
  const t = new Date(`${today}T12:00:00Z`).getTime();
  const ageOf = (s: ObservedSnapshot) => Math.round((t - new Date(`${s.week_start}T12:00:00Z`).getTime()) / DAY_MS);
  const sorted = [...snapshots].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  const month = [...sorted].reverse().find((s) => ageOf(s) >= 26);
  if (month) return month;
  return sorted.find((s) => ageOf(s) >= 7) ?? null;
}

function directionOf(delta: number | null): ChangeDirection {
  if (delta == null) return "new";
  if (Math.abs(delta) < BEHAVIOR_CHANGE_THRESHOLD) return "same";
  return delta > 0 ? "better" : "worse";
}

function factorChanges(current: ObservedDimension, base: SnapshotDimension | undefined): FactorChange[] {
  const baseByKey = new Map((base?.factors ?? []).map((f) => [f.key, f]));
  return (current.factors ?? []).map((f) => {
    const prev = baseByKey.get(f.key)?.value ?? null;
    const delta = f.value != null && prev != null ? round1(f.value - prev) : null;
    return {
      key: f.key, label: f.label, value: f.value, previous: prev, delta, weight: f.weight,
      impact: delta != null && f.weight != null ? round1(delta * f.weight) : null,
    };
  });
}

function whyText(change: Pick<DimensionChange, "direction" | "delta" | "drivers" | "score" | "evidence">): string {
  if (change.score == null) return "Ainda não há dados suficientes para o Nino medir esta dimensão.";
  if (change.direction === "new") {
    const top = change.drivers[0];
    return top
      ? `Primeira leitura. O que mais pesa na nota agora: ${top.label.toLowerCase()} (${top.value != null ? fmt(top.value) : "sem dado"}/10).`
      : change.evidence;
  }
  if (change.direction === "same") return "Sem mudança relevante em relação à base de comparação.";
  // só cita componentes que andaram na mesma direção da nota (senão a frase se contradiz)
  const moved = change.drivers.filter((d) => d.delta != null && Math.abs(d.delta) >= 0.3 && Math.sign(d.delta) === Math.sign(change.delta!));
  if (!moved.length) return `Variou ${change.delta! > 0 ? "+" : "−"}${fmt(Math.abs(change.delta!))}, sem um componente isolado que explique sozinho.`;
  const parts = moved.slice(0, 2).map((d) => `${d.label.toLowerCase()} ${d.delta! > 0 ? "subiu" : "caiu"} (${fmt(d.previous!)} → ${fmt(d.value!)})`);
  return `${change.direction === "better" ? "Melhorou" : "Piorou"} porque ${parts.join(" e ")}.`;
}

/** Variação por dimensão: nota atual contra a base, com os componentes que explicam. */
export function compareDimensions(profile: ObservedBehaviorProfile, baseline: ObservedSnapshot | null): DimensionChange[] {
  return BEHAVIOR_DIMENSIONS.map((dim) => {
    const cur = profile.dimensions[dim.key];
    const prevDim = baseline?.dimensions[dim.key];
    const score = cur?.score ?? null;
    const previous = prevDim?.score ?? null;
    const delta = score != null && previous != null ? round1(score - previous) : null;
    const factors = cur ? factorChanges(cur, prevDim) : [];
    const ranked = [...factors].sort((a, b) => {
      if (delta != null) return Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0);
      return (b.weight ?? 0) * (b.value ?? 0) - (a.weight ?? 0) * (a.value ?? 0);
    });
    const direction = directionOf(delta);
    const base = {
      key: dim.key, label: dim.label, score, previous, delta, direction,
      // Uma reconstrução histórica de baixa confiança nunca pode virar, só porque
      // a leitura atual é forte, uma afirmação de que o hábito melhorou/piorou.
      confidence: weakestConfidence(cur?.confidence ?? "low", prevDim?.confidence),
      evidence: cur?.evidence ?? "", factors, drivers: ranked.slice(0, 3),
    };
    return { ...base, why: whyText(base) };
  });
}

/**
 * Veredito: se melhorou, piorou ou ficou parecido. Considera as dimensões com
 * dois pontos comparáveis; baixa confiança em qualquer um dos pontos não conta.
 */
export function buildBehaviorVerdict(changes: DimensionChange[], baseline: ObservedSnapshot | null, overall: number | null): BehaviorVerdict {
  const comparable = changes.filter((c) => c.delta != null && c.confidence !== "low");
  const improved = comparable.filter((c) => c.direction === "better").length;
  const worsened = comparable.filter((c) => c.direction === "worse").length;
  const stable = comparable.filter((c) => c.direction === "same").length;
  const overallDelta = overall != null && baseline?.overall_score != null ? round1(overall - baseline.overall_score) : null;
  const common = { improved, worsened, stable, baselineDate: baseline?.week_start ?? null, overallDelta };
  if (!baseline || comparable.length < 3) {
    return {
      kind: "insufficient", ...common,
      headline: "Ainda não dá para dizer se você melhorou",
      summary: baseline
        ? "Poucas dimensões têm dados confiáveis nos dois momentos. O Nino compara conforme o histórico cresce."
        : "A leitura de hoje foi guardada. Em cerca de uma semana o Nino já compara com ela e mostra o que mudou.",
    };
  }
  const net = improved - worsened;
  const kind: BehaviorVerdictKind = net >= 2 ? "better" : net <= -2 ? "worse" : "same";
  const headline = kind === "better" ? "Seus hábitos estão melhorando" : kind === "worse" ? "Seus hábitos pioraram neste período" : "Seus hábitos estão parecidos com antes";
  return {
    kind, ...common, headline,
    summary: `${improved} ${improved === 1 ? "dimensão melhorou" : "dimensões melhoraram"}, ${worsened} ${worsened === 1 ? "piorou" : "pioraram"} e ${stable} ${stable === 1 ? "ficou estável" : "ficaram estáveis"} desde ${baseline.week_start.split("-").reverse().join("/")}.`,
  };
}

export type HabitSeriesPoint = { week: string; score: number | null };

/** Série por dimensão para a linha de evolução: snapshots + leitura de agora. */
export function habitSeries(snapshots: ObservedSnapshot[], profile: ObservedBehaviorProfile, thisWeek: string): Record<BehaviorDimensionKey, HabitSeriesPoint[]> {
  const byWeek = new Map(snapshots.map((s) => [s.week_start, s]));
  const weeks = [...new Set([...snapshots.map((s) => s.week_start), thisWeek])].sort();
  const out = {} as Record<BehaviorDimensionKey, HabitSeriesPoint[]>;
  for (const dim of BEHAVIOR_DIMENSIONS) {
    out[dim.key] = weeks.map((week) => ({
      week,
      score: week === thisWeek ? profile.dimensions[dim.key]?.score ?? null : byWeek.get(week)?.dimensions[dim.key]?.score ?? null,
    }));
  }
  return out;
}

export const MONEY_IMPACT_MIN_DAYS = 8;

export type MoneyImpact =
  | { sufficient: false; pairedDays: number }
  | { sufficient: true; pairedDays: number; sensitiveAvg: number; calmAvg: number; extraPerDay: number; sensitiveDays: number; extraTotal: number; upliftPct: number };

/** Emoção × gasto em reais: quanto os dias sensíveis custaram a mais que os tranquilos. */
export function moneyImpactOf(p: { sufficient: boolean; pairedDays: number; vulnerableDays: number; vulnerableAverage: number | null; comparisonAverage: number | null; upliftPct: number | null }): MoneyImpact {
  if (!p.sufficient || p.vulnerableAverage == null || p.comparisonAverage == null || p.upliftPct == null) {
    return { sufficient: false, pairedDays: p.pairedDays };
  }
  const extraPerDay = Math.round((p.vulnerableAverage - p.comparisonAverage) * 100) / 100;
  return {
    sufficient: true, pairedDays: p.pairedDays, sensitiveAvg: p.vulnerableAverage, calmAvg: p.comparisonAverage,
    extraPerDay, sensitiveDays: p.vulnerableDays, extraTotal: Math.round(extraPerDay * p.vulnerableDays * 100) / 100, upliftPct: p.upliftPct,
  };
}

/** Para onde levar o usuário quando uma dimensão piorou ou é a mais fraca. */
export const DIMENSION_ACTION: Record<BehaviorDimensionKey, { label: string; to: string }> = {
  awareness: { label: "Fazer um check-in agora", to: "#checkin" },
  planning: { label: "Definir uma meta de gasto", to: "/app/metas" },
  control: { label: "Ajustar uma meta", to: "/app/metas" },
  consistency: { label: "Fazer um check-in agora", to: "#checkin" },
  security: { label: "Ver reserva e investimentos", to: "/app/investimentos" },
  wealth: { label: "Ver reserva e investimentos", to: "/app/investimentos" },
  calm: { label: "Testar um experimento", to: "#experimentos" },
  debt: { label: "Ver minhas dívidas", to: "/app/dividas" },
};

/** Versão gravada pela reconstrução histórica parcial (migração de backfill). */
export const RECONSTRUCTED_METHODOLOGY_VERSION = "behavior_observed.v2_backfill";

export function isReconstructedSnapshot(s: Pick<ObservedSnapshot, "methodology_version">): boolean {
  return s.methodology_version === RECONSTRUCTED_METHODOLOGY_VERSION;
}

export type BehaviorHabitsReading = {
  thisWeek: string;
  /** Snapshots anteriores à semana atual (a semana atual é a leitura de agora). */
  history: ObservedSnapshot[];
  baseline: ObservedSnapshot | null;
  changes: DimensionChange[];
  verdict: BehaviorVerdict;
  series: Record<BehaviorDimensionKey, HabitSeriesPoint[]>;
  weeksOfHistory: number;
  /** O histórico exibido inclui semanas reconstruídas (parciais). */
  reconstructedWeeks: number;
  baselineReconstructed: boolean;
};

/**
 * Leitura completa da evolução — a MESMA usada pela página Emocional e pelo
 * Nino/WhatsApp. Recebe a leitura observada de agora e os snapshots gravados;
 * em modo degradado não compara com o passado.
 */
export function behaviorHabitsReading(args: {
  profile: ObservedBehaviorProfile;
  snapshots: ObservedSnapshot[];
  today: string;
  thisWeek: string;
  degraded?: boolean;
}): BehaviorHabitsReading {
  const history = args.snapshots.filter((row) => row.week_start < args.thisWeek);
  const baseline = args.degraded ? null : pickBaseline(history, args.today);
  const changes = compareDimensions(args.profile, baseline);
  const verdict = buildBehaviorVerdict(changes, baseline, args.profile.overallScore);
  const series = habitSeries(history, args.profile, args.thisWeek);
  const weeksOfHistory = new Set([...history.map((row) => row.week_start), args.thisWeek]).size;
  return {
    thisWeek: args.thisWeek, history, baseline, changes, verdict, series, weeksOfHistory,
    reconstructedWeeks: history.filter(isReconstructedSnapshot).length,
    baselineReconstructed: !!baseline && isReconstructedSnapshot(baseline),
  };
}
