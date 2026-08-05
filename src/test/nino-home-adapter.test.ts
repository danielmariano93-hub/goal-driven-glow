import { describe, expect, it } from "vitest";
import { toHomeDiagnosisView, type NinoDiagnosisContext } from "@/lib/nino/diagnosis";

function context(): NinoDiagnosisContext {
  const primary = {
    id: "11111111-1111-4111-8111-111111111111",
    situation_type: "spending_pace_change",
    situation_key: "pace",
    status: "active" as const,
    temporal_scope: "now" as const,
    severity: "attention" as const,
    confidence: 0.9,
    relevance_score: 90,
    headline: "Seu ritmo subiu",
    narrative_role: "primary" as const,
    evaluation: { plain_language_reason: "Compras recentes explicam a alta." },
    valid_from: "2026-08-05T00:00:00Z",
  };
  return {
    ok: true,
    contract: "nino_diagnosis_contract.v1.1",
    snapshot_id: "22222222-2222-4222-8222-222222222222",
    as_of: "2026-08-05T12:00:00Z",
    overall_state: "attention",
    primary_situation: primary,
    primary_action: {
      id: "33333333-3333-4333-8333-333333333333",
      situation_id: primary.id,
      action_type: "review",
      title: "Revisar gastos",
      route: "/app/relatorios",
      priority: 1,
      status: "proposed",
    },
    supporting_situations: [{ ...primary, id: "44444444-4444-4444-8444-444444444444", narrative_role: "counterpoint", headline: "Sua reserva segue estável" }],
    patterns: [], anticipations: [], operational_tasks: [], timeline: [], closings: [],
    narrative: {}, forecast: {}, data_quality: {}, confidence: 0.9, rationale: {}, snapshot_payload: {},
  };
}

describe("adaptador do diagnóstico para a Home", () => {
  it("preserva snapshot, situação, contraponto e ação vinculada", () => {
    const view = toHomeDiagnosisView(context());
    expect(view.snapshotId).toBe("22222222-2222-4222-8222-222222222222");
    expect(view.primary?.headline).toBe("Seu ritmo subiu");
    expect(view.counterpoint?.headline).toBe("Sua reserva segue estável");
    expect(view.evidenceSummary).toBe("Compras recentes explicam a alta.");
    expect(view.hasTrustedAction).toBe(true);
  });

  it("rejeita ação de outra situação", () => {
    const input = context();
    if (input.primary_action) input.primary_action.situation_id = "55555555-5555-4555-8555-555555555555";
    expect(toHomeDiagnosisView(input).hasTrustedAction).toBe(false);
  });
});