// Fechamento do Nino Change Agent — testes de integração dos elos que ligavam
// verdade -> ação -> compromisso -> intervenção -> entrega -> resposta ->
// resultado -> reforço/reframe/pause -> aprendizado -> estratégia futura.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyCommunicationInstruction,
  composeChangeMessage,
  instructionFromEvidence,
  violatesCommunicationInstruction,
} from "../../supabase/functions/_shared/agent/changeMessage.ts";
import {
  buildChangeLearningProfilePure,
  resolveChangeStrategy,
  isoPlusDaysFrom,
  reconcileChangeDismissals,
} from "../../supabase/functions/_shared/agent/changeLoop.ts";
import { resolveBehavioralIntervention } from "../../supabase/functions/_shared/agent/behavioralPrinciples.ts";

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

/** Cliente de banco falso, suficiente para provar o fluxo real das funções. */
function fakeSb(tables: Record<string, any[]>) {
  const writes: Array<{ table: string; op: string; payload: any }> = [];
  const api = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: any) => { rows = rows.filter((r) => r[col] === val); return chain; },
      in: (col: string, vals: any[]) => { rows = rows.filter((r) => vals.includes(r[col])); return chain; },
      not: () => { rows = rows.filter((r) => r.dismissed_at != null); return chain; },
      gte: () => chain,
      gt: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (fn: any) => Promise.resolve({ data: rows, error: null }).then(fn),
      update: (payload: any) => { writes.push({ table, op: "update", payload }); return chain; },
      insert: (payload: any) => { writes.push({ table, op: "insert", payload }); return Promise.resolve({ data: null, error: null }); },
      upsert: (payload: any) => { writes.push({ table, op: "upsert", payload }); return chain; },
    };
    return chain;
  };
  return { sb: { from: api } as any, writes };
}

describe("fechamento do change agent — comunicação real", () => {
  it("A: a moldura comportamental chega ao texto entregue", () => {
    const intervention = resolveBehavioralIntervention({ stage: "fund_goal", outcome: "stalled" });
    const body = composeChangeMessage({ baseMessage: "Ainda não houve aporte.", instruction: intervention as any });
    expect(body).toContain("Ainda não houve aporte.");
    expect(body.length).toBeGreaterThan("Ainda não houve aporte.".length);
  });

  it("B: reframe fala de passo menor em vez de repetir o pedido", () => {
    const intervention = resolveBehavioralIntervention({ stage: "fund_goal", strategy: "reframe" });
    const body = composeChangeMessage({ baseMessage: "Base do motor.", instruction: intervention as any });
    expect(body).toMatch(/passo menor/i);
  });

  it("C: pause não propõe compromisso novo", () => {
    const intervention = resolveBehavioralIntervention({ stage: "fund_goal", strategy: "pause" });
    expect(intervention.prohibited_patterns.join(" ")).toMatch(/novo compromisso/i);
  });

  it("D: valor inventado pela linguagem é rejeitado", () => {
    const guard = violatesCommunicationInstruction({
      candidateText: "Guarde R$ 900,00 este mês.",
      baseText: "Guarde R$ 300,00 este mês.",
      instruction: null,
    });
    expect(guard.violates).toBe(true);
    expect(guard.reason).toMatch(/invented_amount/);
  });

  it("E: percentual inventado é rejeitado", () => {
    expect(violatesCommunicationInstruction({
      candidateText: "Reserve 30% da renda.",
      baseText: "Reserve R$ 300,00.",
      instruction: null,
    }).violates).toBe(true);
  });

  it("F: moralização é rejeitada e cai para o determinístico", () => {
    const intervention = resolveBehavioralIntervention({ stage: "fund_goal", outcome: "stalled" });
    const applied = applyCommunicationInstruction({
      renderedBody: "Você falhou de novo e a culpa é sua.",
      deterministicBody: "Ainda não houve aporte de R$ 300,00.",
      instruction: intervention as any,
    });
    expect(applied.fallback_reason).toBe("moralizing_language");
    expect(applied.body).toContain("R$ 300,00");
  });

  it("G: texto fiel é preservado e recebe o fechamento da estratégia", () => {
    const intervention = resolveBehavioralIntervention({ stage: "fund_goal", outcome: "completed" });
    const applied = applyCommunicationInstruction({
      renderedBody: "Você aportou R$ 300,00 como combinamos.",
      deterministicBody: "Você aportou R$ 300,00 como combinamos.",
      instruction: intervention as any,
    });
    expect(applied.fallback_reason).toBeNull();
    expect(applied.body).toContain("Você aportou R$ 300,00");
  });

  it("H: a evidência da situação carrega a instrução de comunicação", () => {
    const intervention = resolveBehavioralIntervention({ stage: "build_wealth" });
    expect(instructionFromEvidence({ communication_instruction: intervention })?.principle)
      .toBe(intervention.principle);
    expect(instructionFromEvidence({})).toBeNull();
  });
});

describe("fechamento do change agent — ciclo e aprendizado", () => {
  it("I: cadência nasce da entrega, não do instante da reconciliação", () => {
    expect(isoPlusDaysFrom("2026-09-01T12:00:00.000Z", 7)).toBe("2026-09-08T12:00:00.000Z");
  });

  it("J: dispensa do app entra no aprendizado uma única vez", async () => {
    const { sb, writes } = fakeSb({
      pending_proactive_suggestions: [
        { id: "s1", user_id: "u1", dismissed_at: "2026-09-02T10:00:00Z", evidence: { change_commitment_id: "c1" } },
      ],
      communication_feedback: [],
      nino_learning_events: [],
      nino_change_commitments: [{ id: "c1", user_id: "u1", status: "active", stage: "fund_goal", dismissals: 1, intervention_attempts: 1 }],
      nino_change_checkins: [],
    });
    const first = await reconcileChangeDismissals(sb, "u1");
    expect(first.registered).toBe(1);
    expect(writes.some((w) => w.table === "nino_change_commitments" && w.payload.dismissals === 2)).toBe(true);

    const { sb: sb2 } = fakeSb({
      pending_proactive_suggestions: [
        { id: "s1", user_id: "u1", dismissed_at: "2026-09-02T10:00:00Z", evidence: { change_commitment_id: "c1" } },
      ],
      communication_feedback: [],
      nino_learning_events: [{ id: "e1", user_id: "u1", dedup_key: "dismissal:s1" }],
      nino_change_commitments: [{ id: "c1", user_id: "u1", status: "active", stage: "fund_goal", dismissals: 2 }],
      nino_change_checkins: [],
    });
    const second = await reconcileChangeDismissals(sb2, "u1");
    expect(second.registered).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("K: dispensa registrada reduz o princípio e a estratégia usados", () => {
    const profile = buildChangeLearningProfilePure({
      events: [
        { event_type: "change_dismissal", signal: "dismissed", metadata: { principle: "pay_yourself_first", strategy: "remind" } },
        { event_type: "change_dismissal", signal: "dismissed", metadata: { principle: "pay_yourself_first", strategy: "remind" } },
      ],
      commitments: [],
      checkins: [],
    });
    expect(profile.principle_success.pay_yourself_first).toEqual({ total: 2, success: 0 });
    expect(profile.strategy_success.remind).toEqual({ total: 2, success: 0 });
    expect(profile.dismissed_principles).toContain("pay_yourself_first");
  });

  it("L: estratégia medida e nunca eficaz perde a vez para reframe", () => {
    const profile = buildChangeLearningProfilePure({
      events: [],
      commitments: [],
      checkins: [
        { commitment_id: "c1", outcome: "stalled", strategy: "remind", principle: "pay_yourself_first" },
        { commitment_id: "c1", outcome: "stalled", strategy: "remind", principle: "pay_yourself_first" },
        { commitment_id: "c1", outcome: "stalled", strategy: "remind", principle: "pay_yourself_first" },
      ],
    });
    const decided = resolveChangeStrategy({ outcome: "stalled", stage: "fund_goal", learning_profile: profile });
    expect(decided.strategy).toBe("reframe");
    expect(decided.reason).toMatch(/remind_never_worked|stalled/);
  });

  it("M: princípio que nunca funcionou perde a vez na intervenção", () => {
    const intervention = resolveBehavioralIntervention({
      stage: "fund_goal",
      outcome: "stalled",
      learningProfile: { principle_success: { pay_yourself_first: { total: 4, success: 0 } } },
    });
    expect(intervention.principle).not.toBe("pay_yourself_first");
  });

  it("N: desistência tem um único nome no ciclo — cancelled", () => {
    const profile = buildChangeLearningProfilePure({
      events: [],
      commitments: [{ id: "c1", stage: "fund_goal", status: "cancelled" }],
      checkins: [],
    });
    expect(profile.commitments_abandoned).toBe(1);
  });

  it("contratos de código: recomendação proativa é persistida e check-in é estruturado", () => {
    const pipeline = read("supabase/functions/_shared/proactive/pipeline.ts");
    expect(pipeline).toContain('persistNextActionRecommendation(sb, userId, nextBest, "proactive")');
    expect(pipeline).toContain("reconcileChangeDismissals");

    const loop = read("supabase/functions/_shared/agent/changeLoop.ts");
    expect(loop).toContain("delivered_at: deliveredAt");
    expect(loop).toContain("isoPlusDaysFrom(deliveredAt, cadence)");

    const dispatcher = read("supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts");
    expect(dispatcher).toContain("applyCommunicationInstruction");
  });
});
