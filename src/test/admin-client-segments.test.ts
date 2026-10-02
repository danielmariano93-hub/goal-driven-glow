import { describe, expect, it } from "vitest";
import { clientNarrative, clientNextAction, segmentCounts, segmentsOf, type ClientRow } from "../lib/admin/clientSegments";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const client = (over: Partial<ClientRow>): ClientRow => ({
  pseudo_id: "x", registered_at: daysAgo(30), onboarding_completed_at: daysAgo(29), first_event_at: daysAgo(29), last_event_at: daysAgo(1),
  total_events: 40, significant_actions: 10, has_financial_data: true, lifecycle_status: "active", ...over,
});

describe("segmentação de clientes", () => {
  it("ativo recente e frequente é engajado e não precisa de ação", () => {
    const c = client({});
    expect(segmentsOf(c, NOW)).toEqual(["engaged"]);
    expect(clientNextAction(c, NOW)).toBeNull();
  });
  it("ativo que sumiu há mais de 7 dias está em risco", () => {
    const c = client({ last_event_at: daysAgo(9) });
    expect(segmentsOf(c, NOW)).toContain("at_risk");
    expect(clientNarrative(c, NOW)).toBe("Última atividade há 9 dias.");
    expect(clientNextAction(c, NOW)).toMatch(/lembrete/);
  });
  it("dormente e sem dados financeiros", () => {
    const c = client({ lifecycle_status: "dormant", has_financial_data: false, last_event_at: daysAgo(40) });
    expect(segmentsOf(c, NOW)).toEqual(expect.arrayContaining(["dormant", "no_data"]));
  });
  it("cadastrou e nunca usou", () => {
    const c = client({ lifecycle_status: "new", registered_at: daysAgo(5), onboarding_completed_at: null, first_event_at: null, last_event_at: null, significant_actions: 0, has_financial_data: false });
    expect(segmentsOf(c, NOW)).toEqual(expect.arrayContaining(["stuck_start", "no_data"]));
    expect(clientNarrative(c, NOW)).toBe("Cadastrou há 5 dias e nunca usou.");
  });
  it("conta em exclusão não entra em segmento", () => {
    expect(segmentsOf(client({ lifecycle_status: "deleted" }), NOW)).toEqual([]);
  });
  it("contagem por segmento", () => {
    const counts = segmentCounts([client({}), client({ last_event_at: daysAgo(10) })], NOW);
    expect(counts.engaged).toBe(1);
    expect(counts.at_risk).toBe(1);
  });
});

import { growthInsights, retentionTone } from "../lib/admin/growthInsights";
describe("leitura de crescimento", () => {
  it("maioria dormente e sem dados vira alerta com próxima ação", () => {
    const items = growthInsights({ total_clients: 4, new_clients: 1, active_clients: 0, activated_clients: 0, dormant_clients: 4, with_financial_data: 3 });
    expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(["dormant", "activation"]));
    expect(items.find((i) => i.key === "dormant")?.tone).toBe("danger");
  });
  it("sem clientes não inventa nada; retenção tem cor por faixa", () => {
    expect(growthInsights({ total_clients: 0, new_clients: 0, active_clients: 0, activated_clients: 0, dormant_clients: 0, with_financial_data: 0 })).toEqual([]);
    expect(retentionTone(0.8)).toContain("success");
    expect(retentionTone(0.1)).toContain("destructive");
    expect(retentionTone(null)).toContain("muted");
  });
});
