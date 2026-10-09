// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
import { BEHAVIOR_DIMENSIONS, type BehaviorDimensionKey, type ObservedBehaviorProfile, type ObservedDimension, type ObservedFactor } from "./behaviorDimensions.ts";

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
  /** A base de comparação usa outros componentes: não vira "melhorou/piorou". */
  notComparable: boolean;
  /** O que a nota mede (e o que ela não mede), em linguagem simples. */
  scope: string;
  /** Componentes da nota sem dado ("o que ainda falta saber"). */
  missing: string[];
  /** A pessoa contestou esta nota ("isso não representa minha realidade") e a contestação ainda vale. */
  contested: boolean;
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

/**
 * O que cada nota mede — e o que NÃO mede. Evita ler engajamento como entendimento
 * ou gasto baixo como autocontrole: o Nino vê registros e uso, não intenções.
 */
export const DIMENSION_SCOPE: Record<BehaviorDimensionKey, string> = {
  awareness: "Mede o quanto você acompanha suas finanças (uso do app, consulta aos movimentos, check-ins, lançamentos categorizados). Não mede o quanto você entende o seu dinheiro.",
  planning: "Mede estruturas de antecipação: metas de gasto, compromissos recorrentes e uso das telas de planejamento. Não avalia se o plano é bom.",
  control: "Mede o resultado contra limites que você mesmo escolheu (ciclos de meta fechados e metas atuais). Gastar pouco, sozinho, não prova autocontrole.",
  consistency: "Mede a estabilidade do ritmo de gasto e a regularidade de check-ins e acesso. Um gasto alto não é sinal de falta de hábito.",
  security: "Mede a margem para imprevistos: reserva, folga depois dos compromissos, dívida frente aos ativos e saldo projetado.",
  wealth: "Mede a recorrência de aportes e a poupança do mês. Uma boa fotografia isolada pesa pouco.",
  calm: "Vem dos check-ins em que você mesmo informa sua tranquilidade. O Nino não deduz sentimento a partir de transações.",
  debt: "Mede a tendência do saldo devedor e o peso da dívida sobre os seus ativos. Dívida controlada não é penalizada só por existir.",
};

const NOT_COMPARABLE_WHY = "A leitura anterior usava outros componentes, então a comparação começa na próxima leitura completa — isso não é melhora nem piora.";

/**
 * Duas leituras só se comparam quando medem a MESMA coisa: os mesmos componentes com
 * dado. Reconstrução parcial ou mudança de método não pode virar "melhorou/piorou".
 * Sem lista de componentes na base (snapshot legado), mantém o comportamento antigo.
 */
export function isComparableDimension(current: ObservedDimension | undefined, previous: SnapshotDimension | undefined): boolean {
  if (!current || !previous) return true;
  const curKeys = (current.factors ?? []).filter((f) => f.value != null).map((f) => f.key).sort();
  const prevKeys = (previous.factors ?? []).filter((f) => f.value != null).map((f) => f.key).sort();
  if (!curKeys.length || !prevKeys.length) return true;
  return curKeys.length === prevKeys.length && curKeys.every((key, i) => key === prevKeys[i]);
}

/** Variação por dimensão: nota atual contra a base, com os componentes que explicam. */
export function compareDimensions(
  profile: ObservedBehaviorProfile,
  baseline: ObservedSnapshot | null,
  contested: ReadonlySet<BehaviorDimensionKey> = new Set(),
): DimensionChange[] {
  return BEHAVIOR_DIMENSIONS.map((dim) => {
    const cur = profile.dimensions[dim.key];
    const prevDim = baseline?.dimensions[dim.key];
    const score = cur?.score ?? null;
    const comparable = isComparableDimension(cur, prevDim);
    const previous = comparable ? prevDim?.score ?? null : null;
    const delta = score != null && previous != null ? round1(score - previous) : null;
    const factors = cur ? factorChanges(cur, comparable ? prevDim : undefined) : [];
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
      notComparable: !comparable,
      scope: DIMENSION_SCOPE[dim.key],
      missing: (cur?.factors ?? []).filter((f) => f.value == null).map((f) => f.label),
      contested: contested.has(dim.key),
    };
    return { ...base, why: !comparable && score != null ? NOT_COMPARABLE_WHY : whyText(base) };
  });
}

/**
 * Veredito: se melhorou, piorou ou ficou parecido. Considera as dimensões com
 * dois pontos comparáveis; baixa confiança em qualquer um dos pontos não conta.
 */
export function buildBehaviorVerdict(changes: DimensionChange[], baseline: ObservedSnapshot | null, overall: number | null): BehaviorVerdict {
  // Nota contestada pela pessoa não sustenta "melhorou/piorou".
  const comparable = changes.filter((c) => c.delta != null && c.confidence !== "low" && !c.contested);
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
  /** Dimensões com contestação vigente (ficam fora do veredito). */
  contested?: ReadonlySet<BehaviorDimensionKey>;
}): BehaviorHabitsReading {
  const history = args.snapshots.filter((row) => row.week_start < args.thisWeek);
  const baseline = args.degraded ? null : pickBaseline(history, args.today);
  const changes = compareDimensions(args.profile, baseline, args.contested);
  const verdict = buildBehaviorVerdict(changes, baseline, args.profile.overallScore);
  const series = habitSeries(history, args.profile, args.thisWeek);
  const weeksOfHistory = new Set([...history.map((row) => row.week_start), args.thisWeek]).size;
  return {
    thisWeek: args.thisWeek, history, baseline, changes, verdict, series, weeksOfHistory,
    reconstructedWeeks: history.filter(isReconstructedSnapshot).length,
    baselineReconstructed: !!baseline && isReconstructedSnapshot(baseline),
  };
}

// ---------------------------------------------------------------------------
// Descoberta: a primeira coisa que a página diz. Não é um veredito geral e sim
// UMA observação específica (percepção x registros, uma mudança boa ou o ponto
// com mais espaço), sempre com a evidência por trás e sem julgar a pessoa.
// ---------------------------------------------------------------------------

export const DISCOVERY_MIN_GAP = 2;

export type HabitDiscoveryKind = "perception_gap" | "improvement" | "attention" | "room_to_grow" | "getting_started";

export type HabitDiscovery = {
  kind: HabitDiscoveryKind;
  title: string;
  body: string;
  dimension: BehaviorDimensionKey | null;
  /** Só no `perception_gap`: as duas leituras lado a lado. */
  self: number | null;
  observed: number | null;
  action: { label: string; to: string } | null;
};

const CONF_OK: Record<Confidence, boolean> = { low: false, medium: true, high: true };

/** Pergunta que abre a conversa, específica da dimensão (nunca "você está errado"). */
const GAP_QUESTION: Record<BehaviorDimensionKey, { selfLower: string; selfHigher: string }> = {
  awareness: { selfLower: "Talvez você acompanhe mais do que imagina. O que faria essa nota subir para você?", selfHigher: "Acompanhar de perto e entender o porquê dos gastos são coisas diferentes. Falta ver o motivo por trás deles?" },
  planning: { selfLower: "Será que o desafio está em planejar ou em conseguir seguir o que foi planejado?", selfHigher: "Há planos que ainda não aparecem nos registros (metas, compromissos)? Cadastrá-los ajuda o Nino a enxergar." },
  control: { selfLower: "Talvez você esteja sendo mais exigente com você do que os resultados pedem.", selfHigher: "Pode haver gastos por impulso que não aparecem nas metas. Quer olhar os últimos?" },
  consistency: { selfLower: "Talvez a constância esteja mais no ritmo do gasto do que na sensação de rotina.", selfHigher: "Semanas mais corridas costumam quebrar a rotina. Quer ver onde ela falha?" },
  security: { selfLower: "Talvez a sensação de insegurança venha de algo que os números não captam. O que pesa mais para você?", selfHigher: "A margem para imprevistos que os registros mostram é menor do que a que você sente. Vale olhar a reserva." },
  wealth: { selfLower: "Talvez os aportes estejam acontecendo, mas sem a sensação de avanço. Quer olhar o que já foi guardado?", selfHigher: "Os aportes recorrentes ainda não aparecem nos registros. Eles estão sendo lançados?" },
  calm: { selfLower: "Seus check-ins mostram mais tranquilidade do que a nota que você se deu. O que pesa mais na sua cabeça?", selfHigher: "Seus check-ins recentes mostram menos tranquilidade do que você sente. Como foram os últimos dias?" },
  debt: { selfLower: "Talvez você esteja pagando e progredindo, mas o tamanho da dívida ainda pese. O que ajudaria hoje?", selfHigher: "O peso da dívida frente aos seus ativos é maior do que você sente. Vale olhar o plano de quitação." },
};

export function buildHabitDiscovery(args: {
  profile: ObservedBehaviorProfile;
  /** Notas que a pessoa deu no mapa (0–10) por dimensão; null se ainda não preencheu. */
  perception: Partial<Record<BehaviorDimensionKey, number>> | null;
  changes: DimensionChange[];
  /** Dimensões contestadas pela pessoa: o Nino não as usa como descoberta. */
  contested?: ReadonlySet<BehaviorDimensionKey>;
}): HabitDiscovery {
  const { profile, perception, changes } = args;
  const contested = args.contested ?? new Set<BehaviorDimensionKey>();
  const labelOf = (key: BehaviorDimensionKey) => BEHAVIOR_DIMENSIONS.find((d) => d.key === key)?.label ?? key;

  // 1) Percepção x registros: a maior distância com evidência suficiente.
  if (perception) {
    const gaps = BEHAVIOR_DIMENSIONS.map((dim) => {
      const obs = profile.dimensions[dim.key];
      const self = perception[dim.key];
      if (obs?.score == null || self == null || !CONF_OK[obs.confidence] || contested.has(dim.key)) return null;
      return { key: dim.key, self: Number(self), observed: obs.score, gap: obs.score - Number(self) };
    }).filter((row): row is NonNullable<typeof row> => row != null && Math.abs(row.gap) >= DISCOVERY_MIN_GAP)
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    const top = gaps[0];
    if (top) {
      const label = labelOf(top.key);
      const lower = top.gap > 0; // você se vê abaixo do que os registros mostram
      return {
        kind: "perception_gap",
        title: lower ? `Em ${label}, você se vê abaixo do que seus registros mostram` : `Em ${label}, seus registros mostram menos do que você sente`,
        body: `Você se deu ${fmt(top.self)} e os sinais do Nino indicam ${fmt(top.observed)}. São duas leituras diferentes, não uma certa e outra errada. ${lower ? GAP_QUESTION[top.key].selfLower : GAP_QUESTION[top.key].selfHigher}`,
        dimension: top.key, self: top.self, observed: top.observed,
        action: { label: "Ver como o Nino chegou nessa nota", to: `#dimensao-${top.key}` },
      };
    }
  }

  // 2) Uma mudança boa e comparável.
  const better = changes
    .filter((c) => c.direction === "better" && !c.notComparable && !contested.has(c.key) && c.delta != null && CONF_OK[c.confidence])
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];
  if (better) {
    return {
      kind: "improvement",
      title: `Uma mudança boa em ${better.label}`,
      body: `${better.why} Vale reconhecer o que está funcionando e manter.`,
      dimension: better.key, self: null, observed: better.score,
      action: { label: "Ver os componentes", to: `#dimensao-${better.key}` },
    };
  }

  // 3) Uma piora comparável, dita sem alarme.
  const worse = changes
    .filter((c) => c.direction === "worse" && !c.notComparable && !contested.has(c.key) && c.delta != null && CONF_OK[c.confidence])
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0];
  if (worse) {
    const action = DIMENSION_ACTION[worse.key];
    return {
      kind: "attention",
      title: `${worse.label} pede atenção`,
      body: `${worse.why} Pequenos ajustes costumam bastar quando a mudança é percebida cedo.`,
      dimension: worse.key, self: null, observed: worse.score,
      action,
    };
  }

  // 4) O ponto com mais espaço (nota mais baixa com evidência suficiente).
  const weakest = BEHAVIOR_DIMENSIONS
    .map((dim) => ({ key: dim.key, obs: profile.dimensions[dim.key] }))
    .filter((row) => row.obs?.score != null && CONF_OK[row.obs.confidence] && (row.obs.score as number) < 5 && !contested.has(row.key))
    .sort((a, b) => (a.obs.score as number) - (b.obs.score as number))[0];
  if (weakest) {
    return {
      kind: "room_to_grow",
      title: `Onde há mais espaço para evoluir: ${labelOf(weakest.key)}`,
      body: `${weakest.obs.evidence} Uma ação pequena nessa dimensão tende a mexer mais na sua leitura do que várias ao mesmo tempo.`,
      dimension: weakest.key, self: null, observed: weakest.obs.score,
      action: DIMENSION_ACTION[weakest.key],
    };
  }

  return {
    kind: "getting_started",
    title: "O Nino ainda está te conhecendo",
    body: "Com mais alguns check-ins e semanas de registro, ele passa a mostrar o que seus hábitos revelam. Por enquanto, as notas abaixo servem de sinal, não de veredito.",
    dimension: null, self: null, observed: null,
    action: { label: "Fazer um check-in agora", to: "#checkin" },
  };
}

// ---------------------------------------------------------------------------
// "Isso não representa minha realidade": a pessoa contesta a nota observada de
// uma dimensão. A nota NÃO muda (senão vira gaming); o contestamento vale 30 dias
// a partir da semana da leitura contestada, tira a dimensão das descobertas e do
// veredito e é registrado como incerteza declarada (contexto do Nino).
// ---------------------------------------------------------------------------

export const FEEDBACK_VALID_DAYS = 30;
export const FEEDBACK_NOTE_MAX = 280;

export type FeedbackReason = "missing_data" | "temporary_phase" | "different_routine" | "other";

export const FEEDBACK_REASONS: Array<{ key: FeedbackReason; label: string }> = [
  { key: "missing_data", label: "Faltam lançamentos ou dados que o Nino não vê" },
  { key: "temporary_phase", label: "É uma fase atípica, temporária" },
  { key: "different_routine", label: "Minha rotina é diferente do que a nota assume" },
  { key: "other", label: "Outro motivo" },
];

export type BehaviorFeedback = {
  dimension: BehaviorDimensionKey;
  week_start: string;
  reason: FeedbackReason;
  note: string | null;
  observed_score: number | null;
};

/** Contestações que ainda valem em `today` (30 dias a partir da semana da leitura). */
export function activeFeedback(rows: BehaviorFeedback[], today: string): Partial<Record<BehaviorDimensionKey, BehaviorFeedback>> {
  const t = new Date(`${today}T12:00:00Z`).getTime();
  const out: Partial<Record<BehaviorDimensionKey, BehaviorFeedback>> = {};
  for (const row of rows) {
    const start = new Date(`${row.week_start}T12:00:00Z`).getTime();
    if (!Number.isFinite(start) || (t - start) / DAY_MS > FEEDBACK_VALID_DAYS) continue;
    const current = out[row.dimension];
    if (!current || row.week_start > current.week_start) out[row.dimension] = row;
  }
  return out;
}

/** Fim da validade (YYYY-MM-DD) de uma contestação. */
export function feedbackValidUntil(weekStart: string): string {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + FEEDBACK_VALID_DAYS);
  return d.toISOString().slice(0, 10);
}
