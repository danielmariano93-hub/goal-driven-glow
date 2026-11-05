import { describe, expect, it } from "vitest";
import {
  buildDayPlanRecaps, composeDayPlanOffer, composeDayPlanRecap, dayPlanRecapSituation, goalStateOf, occurrencesLeftInMonth,
  gradeDayPlan as serverGrade, suggestPlanTarget, withDayPlanOffer,
} from "../../supabase/functions/_shared/proactive/dayPlanOffer";
import { handleWeekendReply, hasActivePlan } from "../../supabase/functions/_shared/proactive/weekendCommitments";
import type { WeekdayProjection } from "../../supabase/functions/_shared/proactive/weekdayNudge";
import { suggestTarget } from "@/lib/behavioral/dayPlanCreate";
import { gradeDayPlan } from "@/lib/behavioral/dayPlan";

// 04/11/2026 é quarta-feira.
const WED = "2026-11-04";
type ProjectionOpts = { anchorKind?: "goal" | "average"; anchor?: number; mtd?: number; projected?: number };
const projection = (o: ProjectionOpts = {}): WeekdayProjection => ({
  pattern: { weekday: 3, category: "Lazer", typical_on_weekday: 100, typical_other_days: 20, ratio: 5, occurrences: 8, weeks: 12, weekday_count_in_month: 4, when_it_happens: 150 },
  month_to_date: o.mtd ?? 300,
  projected_month: o.projected ?? 900,
  projected_without_today: 800,
  anchor: { kind: o.anchorKind ?? "goal", amount: o.anchor ?? 700, label: o.anchorKind === "average" ? "média dos últimos 3 meses" : "meta" },
  overage: 200,
  remaining_days: 27,
} as WeekdayProjection);

const ctx: any = { as_of: WED, snapshot_ref: { reconciliation_id: "r1" } };
const MORNING = new Date("2026-11-04T13:00:00Z"); // 10h em São Paulo

describe("sugestão do teto no servidor == a da folha do app (paridade)", () => {
  it("mesmas respostas numa grade de padrões e do que a meta permite", () => {
    for (const typical of [0, 30, 100, 272, 500]) {
      for (const goalRoom of [null, 0, 40, 160, 200, 272, 900]) {
        const a = suggestPlanTarget({ typical, goalRoom });
        const b = suggestTarget({ typical, goalRoom });
        expect({ kind: a.kind, target: a.target }).toEqual({ kind: b.kind, target: b.target });
      }
    }
  });
  it("nota graduada igual à do cartão do app", () => {
    for (const [target, expected, realized] of [[160, 271.62, 169.58], [100, 100, 80], [100, 100, 130], [50, null, 60]] as const) {
      expect(serverGrade({ target, expected, realized }).band).toBe(gradeDayPlan({ target, expected, realized }).band);
    }
    expect(gradeDayPlan({ target: 160, expected: 271.62, realized: 169.58 }).band).toBe("partial");
  });
});

describe("convite do dia crítico por estado da meta", () => {
  it("ocorrências do dia que restam no mês", () => {
    expect(occurrencesLeftInMonth(WED, 3)).toBe(4); // 04, 11, 18, 25
  });
  it("vai estourar: ancora no que a meta permite e propõe degrau se o corte é grande", () => {
    const p = projection({ projected: 900, anchor: 700, mtd: 300 });
    expect(goalStateOf(p)).toBe("pace");
    const o = composeDayPlanOffer(p, WED)!;
    expect(o.state).toBe("pace");
    expect(o.offer.target).toBeGreaterThan(0);
    expect(o.offer.target).toBeLessThanOrEqual(100);
    expect(o.whatsapp.body).toMatch(/Topa ficar em R\$ \d+ hoje\?/);
    expect(o.whatsapp.body).toMatch(/\*topo\*/);
    expect(o.body).not.toMatch(/\*/);
  });
  it("já estourou: sem 'o que cabe'; passo pequeno de 25% e texto diz que a meta foi ultrapassada", () => {
    const p = projection({ mtd: 760, anchor: 700, projected: 1000 });
    expect(goalStateOf(p)).toBe("exceeded");
    const o = composeDayPlanOffer(p, WED)!;
    expect(o.offer.target).toBe(75);
    expect(o.whatsapp.body).toMatch(/já foi ultrapassada/);
  });
  it("sem meta: redução de 10% e diz que não há meta", () => {
    const p = projection({ anchorKind: "average", anchor: 600, projected: 900 });
    expect(goalStateOf(p)).toBe("no_goal");
    const o = composeDayPlanOffer(p, WED)!;
    expect(o.offer.target).toBe(90);
    expect(o.whatsapp.body).toMatch(/não tem meta em Lazer/);
  });
  it("sem padrão (típico zero) não inventa plano", () => {
    const p = projection();
    p.pattern = { ...p.pattern, typical_on_weekday: 0 };
    expect(composeDayPlanOffer(p, WED)).toBeNull();
  });
});

describe("encaixe no aviso de dia útil", () => {
  const nudge: any = { fingerprint: "n", type: "weekday_nudge", communication_kind: "weekday_spending_risk", title: "t", body: "b", evidence: { pattern: {} } };
  it("quarta recebe convite, oferta e texto de WhatsApp; a oferta guarda a data de hoje", () => {
    const out = withDayPlanOffer(nudge, projection(), WED);
    expect((out.evidence as any).offer.friday).toBe(WED);
    expect((out.evidence as any).whatsapp.body).toMatch(/topo/);
    expect(out.communication_kind).toBe("weekday_spending_risk");
  });
  it("sexta e fim de semana ficam com o fluxo do fim de semana (aviso intacto)", () => {
    for (const weekday of [5, 6, 0]) {
      const p = projection();
      p.pattern = { ...p.pattern, weekday };
      expect(withDayPlanOffer(nudge, p, WED)).toBe(nudge);
    }
  });
});

describe("fechamento do dia seguinte", () => {
  const tx = (day: string, amount: number, category = "Lazer") => ({ occurred_at: `${day}T15:00:00Z`, amount, category });
  const plans = [{ category: "Lazer", date: WED, target: 90, expected: 100 }];
  it("mede o gasto real da categoria na data do plano", () => {
    const [r] = buildDayPlanRecaps(plans, [tx(WED, 60), tx(WED, 20), tx(WED, 500, "Mercado"), tx("2026-11-05", 400)]);
    expect(r.realized).toBe(80);
    expect(r.kept).toBe(true);
    expect(r.grade.band).toBe("met");
  });
  it("texto por nota: cumprido / abaixo do padrão / acima, e só o 'acima' pergunta o que pesou", () => {
    const met = composeDayPlanRecap(buildDayPlanRecaps(plans, [tx(WED, 80)])[0]);
    expect(met.title).toMatch(/Plano cumprido/);
    const partial = composeDayPlanRecap(buildDayPlanRecaps([{ ...plans[0], target: 60, expected: 200 }], [tx(WED, 100)])[0]);
    expect(partial.whatsapp.body).toMatch(/abaixo\* do seu padrão/);
    expect(partial.whatsapp.body).not.toMatch(/o que pesou/);
    const missed = composeDayPlanRecap(buildDayPlanRecaps(plans, [tx(WED, 130)])[0]);
    expect(missed.whatsapp.body).toMatch(/o que pesou/);
  });
  it("situação: só na janela da manhã; grava o resultado (kept) para o pipeline persistir", () => {
    const recaps = buildDayPlanRecaps(plans, [tx(WED, 130)]);
    expect(dayPlanRecapSituation(recaps, ctx, new Date("2026-11-04T23:00:00Z"))).toBeNull();
    const s = dayPlanRecapSituation(recaps, ctx, MORNING)!;
    expect(s.type).toBe("day_plan_recap");
    expect((s.evidence as any).commitment_outcomes).toEqual([{ category: "Lazer", friday: WED, realized: 130, kept: false }]);
    expect(dayPlanRecapSituation([], ctx, MORNING)).toBeNull();
  });
});

describe("'topo' para plano de um dia", () => {
  function db(rows: any[]) {
    const chain: any = { eq: () => chain, gte: () => chain, in: () => chain, order: () => chain, limit: () => chain, then: (r: any) => r({ data: rows, error: null }) };
    return { from: () => ({ select: () => chain, update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }) } as any;
  }
  const row = (friday: string) => ({ id: "1", friday, category: "Lazer", status: "offered", target_amount: 90, projected_if_met: null, detail: "" });
  it("quarta: 'Hoje', fecha 'Amanhã' (não 'Na segunda' nem 'fim de semana')", async () => {
    const r = await handleWeekendReply(db([row(WED)]), { userId: "u", text: "topo", now: MORNING });
    expect(r!.reply).toMatch(/Hoje, \*Lazer\* até \*R\$ 90\*/);
    expect(r!.reply).toMatch(/Amanhã eu te conto/);
    expect(r!.reply).not.toMatch(/fim de semana|Na segunda/);
  });
  it("sexta continua como era", async () => {
    const r = await handleWeekendReply(db([row("2026-11-06")]), { userId: "u", text: "topo", now: new Date("2026-11-06T13:00:00Z") });
    expect(r!.reply).toMatch(/Neste fim de semana, \*Lazer\*/);
    expect(r!.reply).toMatch(/Na segunda eu te conto/);
  });
});

describe("um plano ativo por vez (regra também no servidor)", () => {
  it("proposto ou combinado dentro da janela bloqueia; antigo, recusado ou já medido não", () => {
    expect(hasActivePlan([{ friday: "2026-11-04", category: "Lazer", status: "accepted" }], "2026-11-05")).toBe(true);
    expect(hasActivePlan([{ friday: "2026-11-05", category: "Lazer", status: "offered" }], "2026-11-05")).toBe(true);
    expect(hasActivePlan([{ friday: "2026-11-06", category: "Lazer", status: "accepted" }], "2026-11-09")).toBe(false); // sexta já passou do domingo
    expect(hasActivePlan([{ friday: "2026-11-04", category: "Lazer", status: "kept" }], "2026-11-05")).toBe(false);
    expect(hasActivePlan([{ friday: "2026-11-04", category: "Lazer", status: "declined" }], "2026-11-05")).toBe(false);
    expect(hasActivePlan([], "2026-11-05")).toBe(false);
  });
});
