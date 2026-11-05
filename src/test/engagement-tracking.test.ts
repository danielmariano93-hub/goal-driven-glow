import { describe, expect, it } from "vitest";
import { ACTION_WINDOW_MS, ENGAGEMENT_WINDOW_MS, pickActionTarget, pickInteractionTarget, recordAction, recordInteraction } from "../../supabase/functions/_shared/proactive/engagement";

const NOW = new Date("2026-11-05T15:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3600_000;

describe("engajamento no WhatsApp", () => {
  it("resposta credita a entrega mais recente dentro de 2h e ainda sem resposta", () => {
    const rows = [
      { id: "velha", delivered_at: ago(3 * H) },
      { id: "recente", delivered_at: ago(30 * 60_000) },
      { id: "respondida", delivered_at: ago(10 * 60_000), interacted_at: ago(5 * 60_000) },
    ];
    expect(pickInteractionTarget(rows, NOW)).toBe("recente");
  });
  it("fora da janela de 2h, ninguém é creditado (conversa comum não vira engajamento)", () => {
    expect(pickInteractionTarget([{ id: "a", delivered_at: ago(ENGAGEMENT_WINDOW_MS + 60_000) }], NOW)).toBeNull();
    expect(pickInteractionTarget([], NOW)).toBeNull();
  });
  it("a ação só vale para convite de plano, até 24h, ainda sem ação", () => {
    const rows = [
      { id: "meta", kind: "spending_goal_pressure", delivered_at: ago(H) },
      { id: "convite", kind: "weekday_spending_risk", delivered_at: ago(5 * H) },
      { id: "feito", kind: "weekend_spending_risk", delivered_at: ago(H), acted_at: ago(H / 2) },
    ];
    expect(pickActionTarget(rows, NOW)).toBe("convite");
    expect(pickActionTarget([{ id: "x", kind: "weekday_spending_risk", delivered_at: ago(ACTION_WINDOW_MS + 60_000) }], NOW)).toBeNull();
  });
  it("grava no banco e uma falha de banco nunca propaga", async () => {
    const updates: any[] = [];
    const chain: any = { eq: () => chain, gte: () => chain, order: () => chain, limit: () => Promise.resolve({ data: [{ id: "e1", kind: "weekday_spending_risk", delivered_at: ago(H) }], error: null }) };
    const sb: any = { from: () => ({ select: () => chain, update: (v: any) => { updates.push(v); return { eq: () => ({ is: () => Promise.resolve({ error: null }) }) }; } }) };
    await recordInteraction(sb, "u", NOW);
    await recordAction(sb, "u", "weekend_accept", NOW);
    expect(updates[0]).toEqual({ interacted_at: NOW.toISOString() });
    expect(updates[1]).toMatchObject({ acted_at: NOW.toISOString(), action_taken: "weekend_accept" });
    const broken: any = { from: () => { throw new Error("db fora"); } };
    await expect(recordInteraction(broken, "u", NOW)).resolves.toBeUndefined();
    await expect(recordAction(broken, "u", "x", NOW)).resolves.toBeUndefined();
  });
});
