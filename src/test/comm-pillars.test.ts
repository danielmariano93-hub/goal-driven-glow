import { describe, expect, it } from "vitest";
import { allocateAttention } from "../../supabase/functions/_shared/proactive/ranking";
import {
  PILLARS, WHATSAPP_DAILY_CAP, bypassesCap, emptyUsage, orderByPillars, pillarOf, usageFromDeliveries,
} from "../../supabase/functions/_shared/proactive/pillars";
import { makeCanDispatch } from "../../supabase/functions/_shared/proactive/dispatchGate";
import type { CatalogEntry } from "../../supabase/functions/_shared/intelligence/catalogGate";
import { DEFAULT_COMMUNICATION_POLICY } from "../../supabase/functions/_shared/intelligence/communicationPolicy";
import type { FinancialSituation } from "../../supabase/functions/_shared/proactive/contracts";

const ctx: any = { monthly_income: 7800, as_of: "2026-10-30", domains: {}, learning: {} };

const make = (kind: string, over: Partial<FinancialSituation> = {}): FinancialSituation => ({
  fingerprint: `fp:${kind}:${over.title ?? "x"}`, type: kind, communication_kind: kind, severity: "attention",
  title: "x", body: "b", primary_domain: "cash", domains: ["cash"], signals: [], impact_amount: 600, days_until: 5,
  confidence: 0.9, actionable: true, route: "/", priority_score: 0, score_reasons: [], evidence: {}, ...over,
} as FinancialSituation);

const debt = (over: Partial<FinancialSituation> = {}) => make("debt_due_soon", { title: "debt", impact_amount: 1800, ...over });
const sextou = (over: Partial<FinancialSituation> = {}) => make("weekend_spending_risk", { title: "sextou", impact_amount: 405, days_until: 0, ...over });
const goal = (over: Partial<FinancialSituation> = {}) => make("spending_goal_pressure", { title: "meta", impact_amount: 400, days_until: 0, ...over });

const wa = (situations: FinancialSituation[], extra: Record<string, unknown> = {}) =>
  allocateAttention({ situations, ctx, channels: ["whatsapp"], ...extra } as never);
const picked = (out: ReturnType<typeof wa>) => out.selected.map((s) => s.communication_kind);

describe("pilares: taxonomia", () => {
  it("tipos conhecidos caem no pilar certo; desconhecido vai para Organização (nunca Proteger)", () => {
    expect(pillarOf("debt_overdue")).toBe("proteger");
    expect(pillarOf("weekday_spending_risk")).toBe("antecipar");
    expect(pillarOf("weekend_spending_risk")).toBe("antecipar");
    expect(pillarOf("goal_at_risk")).toBe("metas");
    expect(pillarOf("feature_discovery")).toBe("organizacao");
    expect(pillarOf("tipo_que_ninguem_cadastrou")).toBe("organizacao");
    expect(PILLARS).toHaveLength(4);
  });
  it("só o Proteger fura teto e cota (atraso, crítico, vencimento em até 3 dias)", () => {
    expect(bypassesCap(debt({ days_until: 2 }))).toBe(true);
    expect(bypassesCap(debt({ days_until: 5 }))).toBe(false);
    expect(bypassesCap(debt({ days_until: 5, severity: "critical" }))).toBe(true);
    expect(bypassesCap(make("debt_overdue", { days_until: null }))).toBe(true);
    expect(bypassesCap(sextou({ days_until: 0 }))).toBe(false);
  });
  it("severidade 'crítica' inflada fora do Proteger não fura a fila (caso real: meta com impacto de R$ 26)", () => {
    expect(bypassesCap(goal({ severity: "critical", impact_amount: 26 }))).toBe(false);
    expect(bypassesCap(make("goal_feasibility", { severity: "critical", impact_amount: 26, days_until: 0 }))).toBe(false);
    expect(bypassesCap(sextou({ severity: "critical" }))).toBe(false);
  });
});

describe("pilares: uso (WhatsApp) por dia local e semana", () => {
  const now = new Date("2026-10-30T15:00:00Z"); // 12:00 em São Paulo
  it("conta só WhatsApp, o dia de São Paulo e a janela de 7 dias, por pilar", () => {
    const usage = usageFromDeliveries([
      { kind: "debt_due_soon", channel: "whatsapp", delivered_at: "2026-10-30T11:00:00Z", impact_amount: 1 },
      { kind: "weekend_spending_risk", channel: "whatsapp", delivered_at: "2026-10-30T12:00:00Z", impact_amount: 1 },
      { kind: "spending_goal_pressure", channel: "app", delivered_at: "2026-10-30T12:00:00Z", impact_amount: 1 },
      // 30/10 02:30Z é 29/10 23:30 em São Paulo: "ontem" no horário local (entra na semana, não no dia).
      { kind: "goal_at_risk", channel: "whatsapp", delivered_at: "2026-10-30T02:30:00Z", impact_amount: 1 },
      { kind: "goal_at_risk", channel: "whatsapp", delivered_at: "2026-10-20T12:00:00Z", impact_amount: 1 },
    ], now);
    expect(usage.whatsappToday).toBe(2);
    expect(usage.today.proteger).toBe(1);
    expect(usage.today.antecipar).toBe(1);
    expect(usage.week.metas).toBe(1); // ontem à noite entra na semana, mas não no dia
    expect(usage.today.metas).toBe(0);
  });
});

describe("pilares: o aviso preventivo deixa de perder sempre para o prazo", () => {
  it("cenário de 30/10: sem pilares o vencimento leva a vaga; com pilares o 'Sextou' leva a da manhã", () => {
    const sit = [debt(), sextou()];
    const before = wa(sit);
    expect(picked(before)).toEqual(["debt_due_soon"]);
    const after = wa(sit, { pillars: { usage: emptyUsage() } });
    expect(picked(after)).toEqual(["weekend_spending_risk"]);
    const lost = after.decisions.find((d) => d.fingerprint.includes("debt"));
    expect(lost?.reason).toBe("attention_budget_exhausted");
  });

  it("vaga reservada já usada hoje: o prazo volta a ganhar", () => {
    const usage = emptyUsage();
    usage.today.antecipar = 1;
    usage.whatsappToday = 1;
    expect(picked(wa([debt(), sextou()], { pillars: { usage } }))).toEqual(["debt_due_soon"]);
  });

  it("vaga liberável: sem item de Antecipar elegível, ninguém fica esperando por ela", () => {
    expect(picked(wa([debt(), goal()], { pillars: { usage: emptyUsage() } }))).toEqual(["spending_goal_pressure"]);
    expect(picked(wa([debt()], { pillars: { usage: emptyUsage() } }))).toEqual(["debt_due_soon"]);
  });

  it("crítico e vencimento em até 3 dias furam a fila mesmo com a vaga de Antecipar pendente", () => {
    const out = wa([debt({ days_until: 1 }), sextou()], { pillars: { usage: emptyUsage() } });
    expect(picked(out)).toEqual(["debt_due_soon"]);
    const overdue = wa([make("debt_overdue", { title: "atraso", days_until: null, impact_amount: 900 }), sextou()], { pillars: { usage: emptyUsage() } });
    expect(picked(overdue)).toEqual(["debt_overdue"]);
  });

  it("ordenação é estável dentro de cada faixa (mantém a ordem por pontuação)", () => {
    const a = goal({ title: "a" });
    const b = goal({ title: "b" });
    expect(orderByPillars([a, b], emptyUsage()).map((s) => s.title)).toEqual(["a", "b"]);
  });
});

describe("pilares: teto diário e cotas", () => {
  it("passando de 5 mensagens no dia, só o que fura o teto é enviado", () => {
    const usage = emptyUsage();
    usage.whatsappToday = WHATSAPP_DAILY_CAP;
    const blocked = wa([sextou()], { pillars: { usage } });
    expect(picked(blocked)).toEqual([]);
    expect(blocked.decisions[0]!.reason).toBe("daily_cap_reached");
    expect(picked(wa([debt({ days_until: 1 })], { pillars: { usage } }))).toEqual(["debt_due_soon"]);
  });

  it("cota do pilar: Antecipar fala uma vez por dia; Organização no máximo 2 por semana", () => {
    const usage = emptyUsage();
    usage.today.antecipar = 1;
    usage.whatsappToday = 1;
    const out = wa([sextou()], { pillars: { usage } });
    expect(out.decisions[0]!.reason).toBe("pillar_quota_reached:antecipar");
    const org = emptyUsage();
    org.week.organizacao = 2;
    const out2 = wa([make("mid_month_checkin", { title: "mm", severity: "info", impact_amount: 0, days_until: null })], { pillars: { usage: org } });
    expect(out2.decisions[0]!.reason).toBe("pillar_quota_reached:organizacao");
  });

  it("a cota só vale no WhatsApp; no app o pilar não retém", () => {
    const usage = emptyUsage();
    usage.today.antecipar = 1;
    const out = allocateAttention({ situations: [sextou()], ctx, channels: ["app"], pillars: { usage } } as never);
    expect(out.selected).toHaveLength(1);
  });

  it("a decisão registra o pilar só quando os pilares estão ligados", () => {
    expect(wa([sextou()]).decisions[0]).not.toHaveProperty("pillar");
    expect(wa([sextou()], { pillars: { usage: emptyUsage() } }).decisions[0]).toMatchObject({ pillar: "antecipar" });
  });
});

describe("fim da vaga fantasma: o que o despachante adiaria não segura a vaga", () => {
  it("item que só sairia à noite é retido SEM gastar a vaga; o próximo entra", () => {
    const canDispatch = (s: FinancialSituation) => (s.communication_kind === "debt_due_soon" ? "quiet_hours" : null);
    const out = wa([debt(), goal()], { canDispatch });
    expect(picked(out)).toEqual(["spending_goal_pressure"]);
    expect(out.decisions.find((d) => d.fingerprint.includes("debt"))?.reason).toBe("dispatcher_would_defer:quiet_hours");
  });

  it("sem canDispatch o comportamento é o anterior (a vaga é do primeiro)", () => {
    expect(picked(wa([debt(), goal()]))).toEqual(["debt_due_soon"]);
  });

  it("makeCanDispatch usa a regra real do despachante: silêncio das 21h às 8h adia; de manhã passa", () => {
    const inputs = {
      preferences: { whatsapp_proactive: true, quiet_start: "21:00", quiet_end: "08:00", quiet_behavior: "defer" as const, max_proactive_per_day: 5, max_proactive_per_week: 14 },
      policy: DEFAULT_COMMUNICATION_POLICY,
    };
    const s = { ...sextou(), priority_score: 70 };
    const night = makeCanDispatch({ ...inputs, recent: [], now: new Date("2026-10-31T01:00:00Z") }); // 22:00 SP
    const morning = makeCanDispatch({ ...inputs, recent: [], now: new Date("2026-10-30T12:00:00Z") }); // 09:00 SP
    expect(night(s, "whatsapp")).toBe("quiet_hours");
    expect(morning(s, "whatsapp")).toBeNull();
  });

  it("respeita o cooldown de 24h do mesmo tipo e o opt-out do WhatsApp", () => {
    const base = { preferences: { whatsapp_proactive: true, quiet_start: "21:00", quiet_end: "08:00", max_proactive_per_day: 5, max_proactive_per_week: 14 }, policy: DEFAULT_COMMUNICATION_POLICY };
    const recent = [{ kind: "weekend_spending_risk", channel: "whatsapp", delivered_at: "2026-10-30T10:00:00Z", impact_amount: 1 }];
    const gate = makeCanDispatch({ ...base, recent, now: new Date("2026-10-30T15:00:00Z") });
    expect(gate(sextou(), "whatsapp")).toBe("kind_cooldown_24h");
    const off = makeCanDispatch({ ...base, preferences: { ...base.preferences, whatsapp_proactive: false }, recent: [], now: new Date("2026-10-30T15:00:00Z") });
    expect(off(sextou(), "whatsapp")).toBe("whatsapp_opt_out");
  });
});

describe("fim da vaga fantasma: catálogo (caso real de 05/11, debt_progress só-app)", () => {
  const entry = (kind: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
    kind, active: true, allowed_channels: ["app", "whatsapp"], requires_manual_approval: false,
    min_severity_for_whatsapp: "attention", sensitivity: "normal", ...over,
  });
  const catalog = new Map<string, CatalogEntry>([
    ["debt_progress", entry("debt_progress", { allowed_channels: ["app"], min_severity_for_whatsapp: "critical" })],
    ["weekend_spending_risk", entry("weekend_spending_risk")],
  ]);
  const base = { preferences: { whatsapp_proactive: true, quiet_start: "21:00", quiet_end: "08:00", max_proactive_per_day: 5, max_proactive_per_week: 14 }, policy: DEFAULT_COMMUNICATION_POLICY, catalog };
  const progress = make("debt_progress", { title: "progress", severity: "info", impact_amount: 15794, days_until: null });

  it("tipo só-app não pode segurar a vaga do WhatsApp; no app continua valendo", () => {
    const gate = makeCanDispatch({ ...base, recent: [], now: new Date("2026-11-05T13:00:00Z") });
    expect(gate(progress, "whatsapp")).toBe("channel_disabled_in_catalog");
    expect(gate(progress, "app")).toBeNull();
  });

  it("com o portão no alocador, o 'Sextou' deixa de perder a vaga para o que o WhatsApp nunca enviaria", () => {
    const gate = makeCanDispatch({ ...base, recent: [], now: new Date("2026-11-05T13:00:00Z") });
    const situations = [progress, sextou()];
    expect(picked(wa(situations))).toEqual(["debt_progress"]); // antes: a vaga fantasma
    const out = wa(situations, { canDispatch: gate });
    expect(picked(out)).toEqual(["weekend_spending_risk"]);
    expect(out.decisions.find((d) => d.fingerprint.includes("progress"))?.reason).toBe("dispatcher_would_defer:channel_disabled_in_catalog");
  });
});

describe("fim da vaga fantasma: cadência de 2h do WhatsApp", () => {
  const base = { preferences: { whatsapp_proactive: true, quiet_start: "21:00", quiet_end: "08:00", max_proactive_per_day: 5, max_proactive_per_week: 14 }, policy: DEFAULT_COMMUNICATION_POLICY };
  const now = new Date("2026-11-05T15:00:00Z");
  it("duas horas entre mensagens proativas; crítico passa; o app não é afetado", () => {
    const recent = [{ kind: "goal_at_risk", channel: "whatsapp", delivered_at: "2026-11-05T14:00:00Z", impact_amount: 1 }];
    const gate = makeCanDispatch({ ...base, recent, now });
    expect(gate(sextou(), "whatsapp")).toBe("whatsapp_global_cooldown");
    expect(gate(sextou(), "app")).toBeNull();
    expect(gate(debt({ severity: "critical", days_until: 1 }), "whatsapp")).toBeNull();
    const later = makeCanDispatch({ ...base, recent, now: new Date("2026-11-05T16:30:00Z") });
    expect(later(sextou(), "whatsapp")).toBeNull();
  });
});
