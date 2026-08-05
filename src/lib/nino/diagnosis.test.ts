import { describe, expect, it } from "vitest";
import { diagnosisActionLabel, diagnosisRoute, diagnosisRouteForSituation } from "@/lib/nino/actions";
import { financialSituationSchema, NinoDiagnosisContractError, ninoDiagnosisContextSchema } from "@/lib/nino/diagnosis";
import { NinoRpcError } from "@/lib/nino/intelligence";

const situation = financialSituationSchema.parse({
  id: "550e8400-e29b-41d4-a716-446655440000", situation_type: "anticipation", situation_key: "future:bill:1",
  status: "active", temporal_scope: "future", severity: "attention", confidence: .9, relevance_score: 80,
  impact_amount: 950, headline: "Fatura vence em breve", evaluation: {}, valid_from: "2026-08-05",
});

describe("nino_diagnosis_contract.v1.1", () => {
  it("aceita narrativa, timeline e fechamentos", () => {
    const parsed = ninoDiagnosisContextSchema.parse({ ok: true, contract: "nino_diagnosis_contract.v1.1", snapshot_id: null,
      as_of: "2026-08-05T00:00:00Z", overall_state: "attention", primary_situation: situation, primary_action: null,
      supporting_situations: [], patterns: [], anticipations: [situation], operational_tasks: [], timeline: [], closings: [],
      narrative: { conclusion: situation.headline }, forecast: {}, data_quality: {}, confidence: .9, rationale: {}, snapshot_payload: {} });
    expect(parsed.contract).toBe("nino_diagnosis_contract.v1.1");
    expect(parsed.anticipations).toHaveLength(1);
  });

  it("seleciona CTA determinístico e bloqueia rota externa", () => {
    expect(diagnosisActionLabel(situation, null)).toBe("Planejar agora");
    expect(diagnosisRoute({ route: "https://example.com" } as never)).toBe("/app/nino");
  });

  it("leva tarefas operacionais sem ação anexada ao filtro correto", () => {
    const quality = { ...situation, situation_type: "data_quality_issue", evaluation: { uncategorized_count: 8 } };
    expect(diagnosisRouteForSituation(quality, null)).toBe("/app/lancamentos?filtro=sem-categoria");
  });

  it("leva revisão de duplicidades somente aos lançamentos envolvidos", () => {
    const duplicates = { ...situation, situation_type: "duplicate_review", evaluation: { pairs: [{ transactions: ["a", "b"] }] } };
    expect(diagnosisRouteForSituation(duplicates, null)).toContain("ids=a%2Cb");
  });

  it("classifica falhas de contrato para a mensagem correta da interface", () => {
    const error = new NinoDiagnosisContractError("Contrato inválido");
    expect(error).toBeInstanceOf(NinoRpcError);
    expect(error.kind).toBe("contract");
  });
});