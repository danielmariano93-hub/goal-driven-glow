import { describe, expect, it } from "vitest";
import {
  buildBehaviorVerdict, compareDimensions, habitSeries, moneyImpactOf, pickBaseline, snapshotFromProfile, weekStartOf,
  type ObservedSnapshot,
} from "@/lib/behavioral/behaviorEvolution";
import { BEHAVIOR_DIMENSIONS } from "@/lib/behavioral/client";
import type { ObservedBehaviorProfile, ObservedDimension } from "@/lib/behavioral/mapCycle";

const dim = (score: number | null, factors?: ObservedDimension["factors"], confidence: ObservedDimension["confidence"] = "high"): ObservedDimension =>
  ({ score, confidence, evidence: "x", source: "t", factors });

function profile(scores: Partial<Record<string, number | null>>, factors: Record<string, ObservedDimension["factors"]> = {}): ObservedBehaviorProfile {
  return {
    overallScore: 6, coverage: 8, asOf: "2026-10-01",
    dimensions: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => [d.key, dim(scores[d.key] ?? 5, factors[d.key])])) as ObservedBehaviorProfile["dimensions"],
  };
}
const snap = (
  week: string,
  scores: Record<string, number>,
  factors: Record<string, ObservedDimension["factors"]> = {},
  overall: number | null = 5,
  confidence: "low" | "medium" | "high" = "high",
  methodology_version = "behavior_observed.v2",
): ObservedSnapshot => ({
  week_start: week, overall_score: overall, coverage: 8, confidence, methodology_version,
  dimensions: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => [d.key, { score: scores[d.key] ?? 5, confidence, factors: factors[d.key] }])),
});

describe("weekStartOf", () => {
  it("devolve a segunda-feira da semana", () => {
    expect(weekStartOf(new Date("2026-10-01T15:00:00Z"))).toBe("2026-09-28");
    expect(weekStartOf(new Date("2026-09-28T03:00:00Z"))).toBe("2026-09-28");
  });
});

describe("pickBaseline", () => {
  const list = [snap("2026-08-31", {}), snap("2026-09-14", {}), snap("2026-09-28", {})];
  it("prefere o snapshot de ~30 dias", () => {
    expect(pickBaseline(list, "2026-10-01")?.week_start).toBe("2026-08-31");
  });
  it("com histórico curto usa o mais antigo com 7+ dias", () => {
    expect(pickBaseline([snap("2026-09-21", {}), snap("2026-09-28", {})], "2026-10-01")?.week_start).toBe("2026-09-21");
  });
  it("sem snapshot antigo não há base", () => {
    expect(pickBaseline([snap("2026-09-28", {})], "2026-10-01")).toBeNull();
    expect(pickBaseline([], "2026-10-01")).toBeNull();
  });
});

describe("compareDimensions", () => {
  const f = (v: number) => [{ key: "closed", label: "Ciclos de meta fechados", value: v, weight: 0.55 }, { key: "rhythm", label: "Ritmo", value: 5, weight: 0.15 }];
  it("explica a queda pelo componente que mais mexeu", () => {
    const changes = compareDimensions(profile({ control: 3 }, { control: f(2) }), snap("2026-08-31", { control: 6 }, { control: f(7) }));
    const control = changes.find((c) => c.key === "control")!;
    expect(control.direction).toBe("worse");
    expect(control.delta).toBe(-3);
    expect(control.drivers[0].key).toBe("closed");
    expect(control.why).toMatch(/Piorou porque ciclos de meta fechados caiu \(7,0 → 2,0\)/);
  });
  it("não cita componente que andou contra a nota", () => {
    const changes = compareDimensions(profile({ calm: 6.5 }, { calm: [{ key: "a", label: "Direto", value: 6, weight: 0.5 }] }), snap("2026-08-31", { calm: 5 }, { calm: [{ key: "a", label: "Direto", value: 7, weight: 0.5 }] }));
    const calm = changes.find((c) => c.key === "calm")!;
    expect(calm.direction).toBe("better");
    expect(calm.why).toMatch(/sem um componente isolado/);
  });
  it("variação pequena é estável", () => {
    const changes = compareDimensions(profile({ calm: 5.3 }), snap("2026-08-31", { calm: 5 }));
    expect(changes.find((c) => c.key === "calm")!.direction).toBe("same");
  });
  it("sem base marca como primeira leitura e mostra o que mais pesa", () => {
    const changes = compareDimensions(profile({ control: 4 }, { control: f(8) }), null);
    const control = changes.find((c) => c.key === "control")!;
    expect(control.direction).toBe("new");
    expect(control.why).toMatch(/Primeira leitura/);
    expect(control.drivers[0].key).toBe("closed");
  });
  it("usa a menor confiança entre presente e passado", () => {
    const base = snap("2026-08-31", { control: 2 }, {}, null, "low", "behavior_observed.v2_backfill");
    const changes = compareDimensions(profile({ control: 9 }), base);
    const control = changes.find((c) => c.key === "control")!;
    expect(control.direction).toBe("better");
    expect(control.confidence).toBe("low");
  });
});

describe("buildBehaviorVerdict", () => {
  it("sem base é insuficiente e não inventa evolução", () => {
    const changes = compareDimensions(profile({}), null);
    const v = buildBehaviorVerdict(changes, null, 6);
    expect(v.kind).toBe("insufficient");
    expect(v.baselineDate).toBeNull();
  });
  it("melhor quando mais dimensões subiram do que caíram", () => {
    const base = snap("2026-08-31", { control: 3, planning: 3, awareness: 3, debt: 6 }, {}, 4);
    const changes = compareDimensions(profile({ control: 6, planning: 6, awareness: 6, debt: 5 }), base);
    const v = buildBehaviorVerdict(changes, base, 6);
    expect(v.kind).toBe("better");
    expect(v.improved).toBe(3);
    expect(v.overallDelta).toBe(2);
    expect(v.summary).toMatch(/3 dimensões melhoraram/);
  });
  it("pior quando mais dimensões caíram", () => {
    const base = snap("2026-08-31", { control: 8, planning: 8, security: 8 });
    const v = buildBehaviorVerdict(compareDimensions(profile({ control: 5, planning: 5, security: 5 }), base), base, 5);
    expect(v.kind).toBe("worse");
  });
  it("confiança baixa atual não conta como mudança", () => {
    const p = profile({ control: 9, planning: 9, awareness: 9 });
    for (const d of BEHAVIOR_DIMENSIONS) p.dimensions[d.key].confidence = "low";
    const base = snap("2026-08-31", { control: 1, planning: 1, awareness: 1 });
    expect(buildBehaviorVerdict(compareDimensions(p, base), base, 6).kind).toBe("insufficient");
  });
  it("base reconstruída de baixa confiança também não sustenta veredito", () => {
    const base = snap(
      "2026-08-31",
      { control: 1, planning: 1, awareness: 1, debt: 1 },
      {},
      null,
      "low",
      "behavior_observed.v2_backfill",
    );
    const v = buildBehaviorVerdict(compareDimensions(profile({ control: 9, planning: 9, awareness: 9, debt: 9 }), base), base, 8);
    expect(v.kind).toBe("insufficient");
    expect(v.improved).toBe(0);
    expect(v.overallDelta).toBeNull();
  });
});

describe("habitSeries e snapshotFromProfile", () => {
  it("acrescenta a leitura de agora na semana atual", () => {
    const series = habitSeries([snap("2026-09-21", { calm: 4 })], profile({ calm: 6 }), "2026-09-28");
    expect(series.calm).toEqual([{ week: "2026-09-21", score: 4 }, { week: "2026-09-28", score: 6 }]);
  });
  it("snapshot guarda notas, fatores e versão da metodologia", () => {
    const p = profile({ calm: 6 }, { calm: [{ key: "direct", label: "d", value: 6, weight: 1 }] }) as ObservedBehaviorProfile & { methodologyVersion?: string };
    p.methodologyVersion = "behavior_observed.v2";
    const s = snapshotFromProfile(p);
    expect(s.dimensions.calm?.score).toBe(6);
    expect(s.dimensions.calm?.factors?.[0].key).toBe("direct");
    expect(s.methodology_version).toBe("behavior_observed.v2");
  });
});

describe("moneyImpactOf", () => {
  it("amostra curta não afirma nada", () => {
    expect(moneyImpactOf({ sufficient: false, pairedDays: 3, vulnerableDays: 1, vulnerableAverage: null, comparisonAverage: null, upliftPct: null }).sufficient).toBe(false);
  });
  it("converte a diferença em reais", () => {
    const m = moneyImpactOf({ sufficient: true, pairedDays: 12, vulnerableDays: 4, vulnerableAverage: 300, comparisonAverage: 200, upliftPct: 50 });
    expect(m).toMatchObject({ sufficient: true, extraPerDay: 100, extraTotal: 400 });
  });
});
