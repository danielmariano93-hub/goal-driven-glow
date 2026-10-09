import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  activeFeedback,
  behaviorHabitsReading,
  buildBehaviorVerdict,
  buildHabitDiscovery,
  compareDimensions,
  FEEDBACK_NOTE_MAX,
  FEEDBACK_REASONS,
  feedbackValidUntil,
  type BehaviorFeedback,
  type ObservedSnapshot,
} from "@/lib/engine/behaviorEvolution";
import { BEHAVIOR_DIMENSIONS, type ObservedBehaviorProfile } from "@/lib/engine/behaviorDimensions";
import { cleanFeedbackNote } from "@/lib/behavioral/observedFeedback";

type Key = (typeof BEHAVIOR_DIMENSIONS)[number]["key"];

function profileOf(scores: Partial<Record<Key, [number | null, "low" | "medium" | "high"]>>): ObservedBehaviorProfile {
  return {
    overallScore: 5, coverage: 8, asOf: null,
    dimensions: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => {
      const [score, confidence] = scores[d.key] ?? [null, "low"];
      return [d.key, { score, confidence, evidence: `Evidência de ${d.label}.`, source: "test", factors: [{ key: "f", label: "Componente", value: score, weight: 1 }] }];
    })),
  } as ObservedBehaviorProfile;
}

const fb = (dimension: Key, weekStart: string, over: Partial<BehaviorFeedback> = {}): BehaviorFeedback => ({
  dimension, week_start: weekStart, reason: "temporary_phase", note: null, observed_score: 3, ...over,
});

describe("contestação: validade de 30 dias a partir da semana da leitura", () => {
  it("vale dentro de 30 dias e deixa de valer depois", () => {
    const rows = [fb("debt", "2026-10-05"), fb("planning", "2026-09-07"), fb("calm", "2026-09-14")];
    const active = activeFeedback(rows, "2026-10-09");
    expect(Object.keys(active).sort()).toEqual(["calm", "debt"]); // planning (07/09) já passou de 30 dias
    expect(feedbackValidUntil("2026-10-05")).toBe("2026-11-04");
  });

  it("uma contestação por dimensão: vale a mais recente", () => {
    const active = activeFeedback([fb("debt", "2026-09-21", { reason: "other" }), fb("debt", "2026-10-05", { reason: "missing_data" })], "2026-10-09");
    expect(active.debt?.reason).toBe("missing_data");
  });

  it("oferece os quatro motivos e limita a nota livre a 280 caracteres, sem quebras de linha", () => {
    expect(FEEDBACK_REASONS.map((r) => r.key)).toEqual(["missing_data", "temporary_phase", "different_routine", "other"]);
    expect(FEEDBACK_NOTE_MAX).toBe(280);
    expect(cleanFeedbackNote("  linha 1\n\nlinha\t2  ")).toBe("linha 1 linha 2");
    expect(cleanFeedbackNote("x".repeat(500))?.length).toBe(280);
    expect(cleanFeedbackNote("   ")).toBeNull();
    expect(cleanFeedbackNote(null)).toBeNull();
  });
});

describe("dimensão contestada não vira descoberta, veredito nem conclusão", () => {
  const profile = profileOf({ planning: [8, "medium"], awareness: [6, "medium"], security: [3, "medium"] });

  it("a maior distância contestada sai da descoberta; a próxima assume", () => {
    const perception = { planning: 3, awareness: 3, security: 3 };
    const open = buildHabitDiscovery({ profile, perception, changes: compareDimensions(profile, null) });
    expect(open.dimension).toBe("planning");
    const contested = new Set<Key>(["planning"]);
    const next = buildHabitDiscovery({ profile, perception, changes: compareDimensions(profile, null, contested), contested });
    expect(next.dimension).toBe("awareness");
  });

  it("sem outra distância relevante, a dimensão contestada também não vira 'onde há espaço'", () => {
    const only = profileOf({ security: [3, "medium"] });
    const contested = new Set<Key>(["security"]);
    const d = buildHabitDiscovery({ profile: only, perception: { security: 3 }, changes: compareDimensions(only, null, contested), contested });
    expect(d.kind).toBe("getting_started");
  });

  it("a mudança é marcada como contestada e fica fora do veredito", () => {
    const base: ObservedSnapshot = {
      week_start: "2026-09-07", overall_score: 5, coverage: 4, confidence: "medium", methodology_version: "behavior_observed.v2",
      dimensions: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((d) => [d.key, { score: 2, confidence: "medium", factors: [{ key: "f", label: "Componente", value: 2, weight: 1 }] }])),
    };
    const now = profileOf({ planning: [8, "medium"], awareness: [8, "medium"], security: [8, "medium"], wealth: [8, "medium"] });
    const all = compareDimensions(now, base);
    expect(buildBehaviorVerdict(all, base, 8).improved).toBe(4);
    const contested = new Set<Key>(["planning", "awareness"]);
    const some = compareDimensions(now, base, contested);
    expect(some.find((c) => c.key === "planning")?.contested).toBe(true);
    expect(buildBehaviorVerdict(some, base, 8).improved).toBe(2);
    // pela leitura completa
    const reading = behaviorHabitsReading({ profile: now, snapshots: [base], today: "2026-10-09", thisWeek: "2026-10-05", contested });
    expect(reading.verdict.improved).toBe(2);
  });
});

describe("persistência e tela", () => {
  const migration = readFileSync("supabase/migrations/20261009210000_behavior_observed_feedback.sql", "utf8");
  const followup = readFileSync("supabase/migrations/20261009213000_behavior_feedback_validity_from_reading_week.sql", "utf8");
  const parts = readFileSync("src/components/behavioral/EvolutionParts.tsx", "utf8");
  const page = readFileSync("src/pages/Emocoes.tsx", "utf8");

  it("a tabela é só da própria pessoa (RLS), com motivo e nota limitados", () => {
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    for (const op of ["select", "insert", "update", "delete"]) expect(migration).toMatch(new RegExp(`behavior_observed_feedback_own_${op}`));
    expect(migration).toMatch(/user_id = auth\.uid\(\)/);
    expect(migration).toMatch(/reason IN \('missing_data', 'temporary_phase', 'different_routine', 'other'\)/);
    expect(migration).toMatch(/char_length\(note\) <= 280/);
    expect(migration).toMatch(/UNIQUE \(user_id, dimension\)/);
  });

  it("o contexto do Nino é só texto de modelo (a nota livre nunca entra) e expira com a contestação", () => {
    for (const sql of [migration, followup]) {
      const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.behavior_feedback_to_context"));
      expect(fn).not.toMatch(/NEW\.note|OLD\.note/);
      expect(fn).toMatch(/'correction'/);
    }
    expect(followup).toMatch(/\(NEW\.week_start \+ 30\)::timestamptz/);
    expect(migration).toMatch(/AFTER INSERT OR UPDATE OR DELETE ON public\.behavior_observed_feedback/);
  });

  it("a tela oferece a contestação na dimensão e na descoberta, e passa as contestadas ao motor", () => {
    expect(parts).toMatch(/Isso não representa minha realidade/);
    expect(parts).toMatch(/#dimensao-\$\{discovery\.dimension\}:contestar/);
    expect(parts).toMatch(/<ContestScore/);
    expect(page).toMatch(/buildHabitDiscovery\(\{[^}]*contested \}\)/);
    expect(page).toMatch(/behaviorHabitsReading\(\{[^}]*degraded, contested,?\s*\}\)/);
    expect(page).toMatch(/O Nino passa a tratar essa nota como incerta por 30 dias/);
  });

  it("renderiza: botão de contestar, formulário com os motivos e o estado contestado", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { ContestScore } = await import("@/components/behavioral/ContestScore");
    const noop = () => undefined;
    const closed = renderToStaticMarkup(createElement(ContestScore, { label: "Planejamento", onSave: noop, onRemove: noop }));
    expect(closed).toContain("Isso não representa minha realidade");
    expect(closed).not.toContain("<form");
    const open = renderToStaticMarkup(createElement(ContestScore, { label: "Planejamento", defaultOpen: true, onSave: noop, onRemove: noop }));
    for (const reason of FEEDBACK_REASONS) expect(open).toContain(reason.label);
    expect(open).toContain("A nota não muda");
    expect(open).toContain(`maxLength="${FEEDBACK_NOTE_MAX}"`);
    expect(open).toMatch(/<button type="submit" disabled=""/); // sem motivo escolhido, não envia
    const done = renderToStaticMarkup(createElement(ContestScore, { label: "Planejamento", feedback: fb("planning", "2026-10-05"), onSave: noop, onRemove: noop }));
    expect(done).toContain("Você contestou esta nota");
    expect(done).toContain("até 04/11/2026");
    expect(done).toContain("Desfazer");
  });
});
