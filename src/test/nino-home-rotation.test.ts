import { describe, expect, it } from "vitest";
import { buildNinoReadingQueue } from "@/lib/nino/rotation";
import { diagnosisRouteForSituation } from "@/lib/nino/actions";
import type { FinancialSituation, NinoDiagnosisContext } from "@/lib/nino/diagnosis";

function situation(over: Partial<FinancialSituation> & { id: string }): FinancialSituation {
  return {
    situation_type: "spending_pace_change",
    situation_key: over.id,
    status: "active",
    temporal_scope: "now",
    severity: "attention",
    confidence: 0.8,
    relevance_score: 50,
    headline: `Leitura ${over.id}`,
    narrative_role: "support",
    evaluation: {},
    valid_from: new Date().toISOString(),
    ...over,
  } as FinancialSituation;
}

function context(over: Partial<NinoDiagnosisContext>): NinoDiagnosisContext {
  return {
    ok: true,
    contract: "nino_diagnosis_contract.v1.1",
    snapshot_id: null,
    as_of: new Date().toISOString(),
    overall_state: "attention",
    primary_situation: null,
    primary_action: null,
    supporting_situations: [],
    patterns: [],
    anticipations: [],
    operational_tasks: [],
    timeline: [],
    closings: [],
    narrative: {},
    forecast: {},
    data_quality: {},
    confidence: 0.8,
    rationale: {},
    snapshot_payload: {},
    ...over,
  } as NinoDiagnosisContext;
}

describe("rotação de leituras do Nino", () => {
  it("mantém a principal na frente e adiciona apoio, antecipação e padrão", () => {
    const queue = buildNinoReadingQueue(context({
      primary_situation: situation({ id: "p" }),
      supporting_situations: [situation({ id: "s", narrative_role: "counterpoint" })],
      anticipations: [situation({ id: "a", situation_type: "anticipation", temporal_scope: "future" })],
      patterns: [situation({ id: "pt", situation_type: "behavioral_pattern", status: "confirmed" })],
    }));
    expect(queue.map((r) => r.situation.id)).toEqual(["p", "s", "a", "pt"]);
  });

  it("ignora leituras expiradas, resolvidas ou suprimidas", () => {
    const queue = buildNinoReadingQueue(context({
      primary_situation: situation({ id: "p" }),
      supporting_situations: [
        situation({ id: "resolvida", status: "resolved" }),
        situation({ id: "vencida", valid_until: new Date(Date.now() - 1000).toISOString() }),
        situation({ id: "suprimida", status: "suppressed" }),
      ],
    }));
    expect(queue.map((r) => r.situation.id)).toEqual(["p"]);
  });

  it("não repete leitura respondida no mesmo dia", () => {
    const queue = buildNinoReadingQueue(
      context({
        primary_situation: situation({ id: "p" }),
        supporting_situations: [situation({ id: "s" })],
      }),
      { suppressedIds: ["p"] },
    );
    expect(queue.map((r) => r.situation.id)).toEqual(["s"]);
  });

  it("leitura crítica não é escondida pelo feedback anterior", () => {
    const queue = buildNinoReadingQueue(
      context({ primary_situation: situation({ id: "crit", severity: "critical" }) }),
      { suppressedIds: ["crit"] },
    );
    expect(queue.map((r) => r.situation.id)).toEqual(["crit"]);
  });

  it("deduplica por identidade canônica e evita mensagens equivalentes em sequência", () => {
    const queue = buildNinoReadingQueue(context({
      primary_situation: situation({ id: "p", situation_key: "mesma", one_line_summary: "Gasto acelerou" }),
      supporting_situations: [
        situation({ id: "dup", situation_key: "mesma" }),
        situation({ id: "eq", situation_key: "outra", one_line_summary: "Gasto acelerou" }),
      ],
    }));
    expect(queue.map((r) => r.situation.id)).toEqual(["p"]);
  });

  it("ação derivada da meta aponta para o deep link de recalibração", () => {
    const goal = situation({ id: "g", situation_type: "goal_feasibility", evaluation: { goal_id: "abc" } });
    expect(diagnosisRouteForSituation(goal)).toBe("/app/metas?goal=abc&action=recalibrate");
  });
});
