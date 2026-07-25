import { describe, expect, it } from "vitest";
import { interpretSemanticQuery } from "../../supabase/functions/_shared/intelligence/semanticQuery";
import { computeWeekdayPattern } from "../../supabase/functions/_shared/analytics/weekdayPattern";
import { validateAnalyticalClaims } from "../../supabase/functions/_shared/intelligence/claimValidator";
import { decideCommunication } from "../../supabase/functions/_shared/intelligence/communicationPolicy";
import { selectModelRoute } from "../../supabase/functions/_shared/intelligence/modelGateway";
import { renderArtifactPng } from "../../supabase/functions/_shared/artifacts/png";

function tx(id: string, date: string, amount: number) {
  return {
    id, account_id: "a", category_id: null, type: "expense" as const,
    status: "confirmed" as const, amount, occurred_at: date,
    description: "teste", transfer_group_id: null, movement_kind: "transaction",
  };
}

describe("Nino Intelligence Core", () => {
  it("separa comportamento típico de concentração causada por outlier", () => {
    const rows = [
      tx("w1", "2026-06-03", 4000), tx("w2", "2026-06-10", 40),
      tx("w3", "2026-06-17", 45), tx("w4", "2026-06-24", 50),
      tx("f1", "2026-06-05", 180), tx("f2", "2026-06-12", 200),
      tx("f3", "2026-06-19", 190), tx("f4", "2026-06-26", 210),
    ];
    const result = computeWeekdayPattern({ transactions: rows, to: "2026-06-30", weeks: 8 });
    expect(result.winner?.label).toBe("Sexta-feira");
    expect(result.total_concentration_winner?.label).toBe("Quarta-feira");
    expect(result.outliers.some(o => o.amount === 4000)).toBe(true);
  });

  it("interpreta geralmente/na média como padrão robusto", () => {
    const q = interpretSemanticQuery("Na média, sem considerar picos, em qual dia da semana eu geralmente gasto mais?");
    expect(q?.intent).toBe("weekday_pattern");
    expect(q?.interpretation).toBe("typical_behavior");
    expect(q?.metric_key).toBe("weekday_typical_spend");
  });

  it("não aceita hotspot total como resposta de comportamento típico", () => {
    const validation = validateAnalyticalClaims(
      "Sua quarta-feira é o dia em que você geralmente mais gasta, com 54% do total.",
      "Qual dia eu geralmente gasto mais?",
      [{ tool_name: "get_spending_highlights", ok: true, result: { weekday_hotspot: { label: "Quarta", pct: 54 } } }],
    );
    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain("total_concentration_used_for_typical_behavior");
  });

  it("respeita opt-out e limite semanal de comunicações", () => {
    const candidate = {
      id: "s1", user_id: "u1", kind: "spending_spike", severity: "attention" as const,
      title: "Atenção", body: "Teste", channel_ready: "both" as const, dedup_key: "x",
    };
    expect(decideCommunication({
      candidate, target: "whatsapp", preferences: { whatsapp_proactive: false }, history: [],
    }).reason).toBe("whatsapp_opt_out");
    const history = [0, 1, 2].map(i => ({ created_at: new Date(Date.now() - i * 86400000).toISOString(), kind: `k${i}`, channel: "app", status: "delivered" }));
    expect(decideCommunication({
      candidate, target: "app", preferences: { max_proactive_per_week: 3 }, history,
    }).reason).toBe("weekly_frequency_cap");
  });

  it("mantém o modelo configurado como padrão quando não há override", () => {
    const route = selectModelRoute("financial_analysis", "google/gemini-2.5-flash", 8);
    expect(route.primary).toBe("google/gemini-2.5-flash");
    expect(route.fallback).toBe("google/gemini-2.5-flash");
  });

  it("renderiza PNG sem canvas nativo", async () => {
    const png = await renderArtifactPng({ kind: "timeseries", data: { series: [{ name: "1", value: 10 }, { name: "2", value: 20 }] } });
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
