import { describe, expect, it } from "vitest";
import { ninoDiagnosisContextSchema } from "@/lib/nino/diagnosis";

const situation = {
  id: "00000000-0000-4000-8000-000000000001",
  situation_type: "category_shift",
  situation_key: "category_shift:lazer:2026-08",
  status: "active",
  temporal_scope: "now",
  severity: "attention",
  confidence: 0.86,
  relevance_score: 78,
  headline: "Lazer foi a principal causa do aumento",
  cause_summary: "Lazer explicou 74% da diferença.",
  consequence_summary: "Os comerciantes são evidências, não o insight.",
  forecast_summary: null,
  evaluation: {},
  valid_from: "2026-08-05T00:00:00Z",
};

describe("nino_diagnosis_contract.v1", () => {
  it("aceita o diagnóstico canônico compartilhado pelas superfícies", () => {
    const parsed = ninoDiagnosisContextSchema.parse({
      ok: true,
      contract: "nino_diagnosis_contract.v1",
      snapshot_id: "00000000-0000-4000-8000-000000000002",
      as_of: "2026-08-05",
      overall_state: "attention",
      primary_situation: situation,
      primary_action: null,
      supporting_situations: [],
      patterns: [],
      anticipations: [],
      operational_tasks: [],
      forecast: {},
      data_quality: {},
      confidence: 0.86,
      rationale: {},
      snapshot_payload: {},
    });
    expect(parsed.primary_situation?.situation_type).toBe("category_shift");
  });

  it("rejeita confiança e score fora dos limites do contrato", () => {
    expect(() => ninoDiagnosisContextSchema.parse({
      ok: true, contract: "nino_diagnosis_contract.v1", snapshot_id: null, as_of: "2026-08-05",
      overall_state: "attention", primary_situation: { ...situation, confidence: 1.4 }, primary_action: null,
      supporting_situations: [], patterns: [], anticipations: [], operational_tasks: [],
      forecast: {}, data_quality: {}, confidence: 1.4, rationale: {}, snapshot_payload: {},
    })).toThrow();
  });

  it("rejeita payload que tenta voltar ao contrato detector -> card", () => {
    expect(() => ninoDiagnosisContextSchema.parse({ ok: true, contract: "nino_intelligence.v1" })).toThrow();
  });
});
