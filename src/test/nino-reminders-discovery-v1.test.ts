import { describe, expect, it } from "vitest";
import {
  billDueReminders, cardClosingReminders, cardDueReminders, isPaceReliable, midMonthCheckin, reminderSituations,
} from "../../supabase/functions/_shared/proactive/reminders";
import { DISCOVERY_TIPS, discoverySituation, tipIdFromKey, type UsageProfile } from "../../supabase/functions/_shared/proactive/featureDiscovery";
import { allocateAttention, meetsSituationMateriality } from "../../supabase/functions/_shared/proactive/ranking";
import { repeatedKind } from "../../supabase/functions/_shared/proactive/repetition";
import type { FinancialSituation, MultiFinanceProactiveContext } from "../../supabase/functions/_shared/proactive/contracts";

// 10h em São Paulo = 13h UTC.
const at = (day: string, hourSp = 10) => new Date(`${day}T${String(hourSp + 3).padStart(2, "0")}:00:00Z`);

function ctx(over: { as_of?: string; commitments?: unknown[]; cash?: Record<string, unknown>; daily?: number; typical?: number } = {}): MultiFinanceProactiveContext {
  return {
    version: "proactive_multifinance.v1", user_id: "u", as_of: over.as_of ?? "2026-09-29", monthly_income: 5000, materiality_floor: 100,
    available_today: 3000, projected_month_end_available: 500, daily_pace: over.daily ?? 100, typical_daily_pace: over.typical ?? 80,
    cash_horizon: [], first_negative_day: null, snapshot_ref: { reconciliation_id: "r", formula_version: "f" },
    domains: {
      cash: over.cash ?? {}, cards: {}, goals: [], commitments: over.commitments ?? [], debts: [],
      debt_obligations: [], debt_obligations_available: true, patterns: [],
    },
    learning: {},
  };
}

const item = (name: string, date: string, source: string, amount: number, status = "pending") =>
  ({ name, type: "expense", amount, date, source, estimated: false, payment_status: status, paid_at: null, next_due_date: null });

describe("lembrete de contas do mês", () => {
  it("contas do mesmo dia viram uma mensagem só, com a lista e o total", () => {
    const out = billDueReminders(ctx({ commitments: [
      item("Internet", "2026-09-30", "recurring", 120),
      item("Academia", "2026-09-30", "recurring", 90),
      item("Aluguel", "2026-10-05", "recurring", 1500),
      item("Luz", "2026-09-29", "recurring", 200, "paid"),
      item("Parcela Pan", "2026-09-30", "debt_installment", 74),
    ] }));
    expect(out).toHaveLength(1);
    expect(out[0].communication_kind).toBe("bill_due_reminder");
    expect(out[0].title).toBe("2 contas vencem amanhã");
    expect(out[0].body).toContain("Internet (R$ 120,00)");
    expect(out[0].body).toContain("Total de R$ 210,00");
    expect(out[0].impact_amount).toBe(210);
  });

  it("véspera e dia do vencimento são lembretes diferentes", () => {
    const eve = billDueReminders(ctx({ as_of: "2026-09-29", commitments: [item("Internet", "2026-09-30", "recurring", 120)] }))[0];
    const today = billDueReminders(ctx({ as_of: "2026-09-30", commitments: [item("Internet", "2026-09-30", "recurring", 120)] }))[0];
    expect(eve.fingerprint).not.toBe(today.fingerprint);
    expect(today.title).toBe("Internet vence hoje");
  });

  it("conta de valor pequeno com prazo ainda passa no piso (vencimento importa)", () => {
    const [bill] = billDueReminders(ctx({ commitments: [item("Spotify", "2026-09-30", "recurring", 22)] }));
    expect(meetsSituationMateriality(bill, ctx())).toBe(true);
    const recent = [{ kind: "bill_due_reminder", channel: "whatsapp", delivered_at: "2026-09-28T12:00:00Z", impact_amount: 22 }];
    expect(repeatedKind(bill, "whatsapp", recent, new Date("2026-09-29T12:00:00Z"))).toBeNull();
  });
});

describe("fatura do cartão", () => {
  it("avisa 3 dias antes e no dia (crítico), nunca depois de paga", () => {
    const soon = cardDueReminders(ctx({ commitments: [item("Fatura Nubank", "2026-10-02", "card_statement", 1800)] }));
    expect(soon[0].severity).toBe("attention");
    expect(soon[0].body).toContain("vence em 3 dias");
    const today = cardDueReminders(ctx({ as_of: "2026-10-02", commitments: [item("Fatura Nubank", "2026-10-02", "card_statement", 1800)] }));
    expect(today[0].severity).toBe("critical");
    expect(cardDueReminders(ctx({ commitments: [item("Fatura Nubank", "2026-10-01", "card_statement", 1800, "paid")] }))).toHaveLength(0);
  });

  it("fechamento em 2 dias vira dica de momento, sem inventar valor", () => {
    const out = cardClosingReminders(ctx({ as_of: "2026-09-29" }), [
      { id: "c1", name: "Nubank", closing_day: 1 },
      { id: "c2", name: "Inter", closing_day: 15 },
      { id: "c3", name: "Sem dia", closing_day: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("Nubank");
    expect(out[0].body).toContain("01/10");
    expect(out[0].body).not.toMatch(/R\$/);
  });

  it("fechamento no dia 31 cai no último dia de meses curtos", () => {
    const out = cardClosingReminders(ctx({ as_of: "2026-09-28" }), [{ id: "c1", name: "XP", closing_day: 31 }]);
    expect(out[0].evidence).toMatchObject({ card: { closing_date: "2026-09-30" } });
  });
});

describe("balanço de meio do mês", () => {
  const mid = (over: Parameters<typeof ctx>[0] = {}) => ctx({
    as_of: "2026-09-15", daily: 110, typical: 80,
    cash: { current_month_expense: 1650, projected_month_expense: 3300, days_elapsed: 15 }, ...over,
  });

  it("acima do típico: mostra quanto foi, para onde vai e a diferença", () => {
    const out = midMonthCheckin(mid(), at("2026-09-15", 9));
    expect(out?.severity).toBe("attention");
    expect(out?.body).toContain("R$ 1.650,00");
    expect(out?.body).toContain("R$ 3.300,00");
    expect(out?.body).toContain("R$ 900,00 acima do seu típico (R$ 2.400,00)");
  });

  it("dentro do típico vira reforço positivo, que ainda passa no piso", () => {
    const out = midMonthCheckin(mid({ cash: { current_month_expense: 1200, projected_month_expense: 2400, days_elapsed: 15 } }), at("2026-09-15", 9));
    expect(out?.severity).toBe("info");
    expect(meetsSituationMateriality(out!, mid())).toBe(true);
  });

  it("não sai fora dos dias 14–16, fora da manhã, nem sem histórico de ritmo", () => {
    expect(midMonthCheckin(mid({ as_of: "2026-09-20" }), at("2026-09-20", 9))).toBeNull();
    expect(midMonthCheckin(mid(), at("2026-09-15", 15))).toBeNull();
    // Sem histórico o snapshot repete o ritmo do mês como "típico".
    expect(isPaceReliable(mid({ typical: 110 }))).toBe(false);
    expect(midMonthCheckin(mid({ typical: 110 }), at("2026-09-15", 9))).toBeNull();
  });
});

describe("lembretes: horário", () => {
  it("de madrugada nenhum lembrete nasce", () => {
    const c = ctx({ commitments: [item("Internet", "2026-09-30", "recurring", 120)] });
    expect(reminderSituations(c, at("2026-09-29", 3), [])).toHaveLength(0);
    expect(reminderSituations(c, at("2026-09-29", 10), [])).toHaveLength(1);
  });
});

describe("engajamento: descoberta de funcionalidades", () => {
  const fresh: UsageProfile = { recurring_rules: 0, goals: 0, active_cards: 1, invoice_imports: 0, splits: 0, inbound_messages: 2, questions_asked: 0 };
  const noHistory = { sent_tip_ids: [], last_sent_at: null };
  const tipFor = (usage: UsageProfile, history = noHistory, competing: FinancialSituation[] = [], now = at("2026-09-29", 15)) =>
    discoverySituation({ ctx: ctx(), usage, history, competing, now });

  it("começa pelas contas fixas, no tom de pergunta, com exemplo real", () => {
    const tip = tipFor(fresh)!;
    expect(tip.communication_kind).toBe("feature_discovery");
    expect(tip.severity).toBe("info");
    expect(tip.body).toContain("Você sabia que dá pra cadastrar aqui comigo as contas que você paga todo mês?");
    expect(tip.body).toContain("Netflix todo dia 10");
    expect(tip.body).toMatch(/\?$/);
    expect(meetsSituationMateriality(tip, ctx())).toBe(true);
  });

  it("nunca repete a mesma dica e pula funcionalidades já usadas", () => {
    const tip = tipFor({ ...fresh, recurring_rules: 3 }, { sent_tip_ids: ["card_invoice_pdf"], last_sent_at: "2026-09-01T12:00:00Z" })!;
    expect(tip.evidence.tip_id).toBe("goal_create");
  });

  it("no máximo uma por semana", () => {
    expect(tipFor(fresh, { sent_tip_ids: ["recurring_bills"], last_sent_at: "2026-09-25T12:00:00Z" })).toBeNull();
  });

  it("quem já usa tudo recebe só dicas 'sempre úteis' (novidades), nunca as básicas", () => {
    const power: UsageProfile = { recurring_rules: 4, goals: 2, active_cards: 1, invoice_imports: 3, splits: 1, inbound_messages: 300, questions_asked: 40 };
    const tip = tipFor(power);
    expect(["what_if", "compare_months", "account_balance", "habits_reading", "spending_goals_plan"]).toContain((tip?.evidence as any)?.tip_id);
  });

  it("alerta urgente tem a vez; fora do horário também não sai", () => {
    const urgent = { severity: "attention", days_until: 1 } as FinancialSituation;
    expect(tipFor(fresh, noHistory, [urgent])).toBeNull();
    expect(tipFor(fresh, noHistory, [], at("2026-09-29", 21))).toBeNull();
    expect(tipFor(fresh, noHistory, [], at("2026-09-29", 10))).toBeNull();
  });

  it("perde a vaga do WhatsApp para qualquer situação real", () => {
    const tip = tipFor(fresh)!;
    const real = billDueReminders(ctx({ commitments: [item("Internet", "2026-09-30", "recurring", 120)] }))[0];
    const { selected } = allocateAttention({ situations: [tip, real], ctx: ctx(), channels: ["whatsapp"], budget: { whatsapp: 1, app: 3 } as never });
    expect(selected.map((s) => s.communication_kind)).toEqual(["bill_due_reminder"]);
  });

  it("id da dica é recuperado da chave de deduplicação da entrega", () => {
    expect(tipIdFromKey("proactive_multifinance.v1:feature_discovery:nino_discovery.v1:split_expense")).toBe("split_expense");
    expect(tipIdFromKey("outra:coisa")).toBeNull();
  });

  it("só anuncia rotas que existem no app", () => {
    const routes = new Set(["/app/compromissos", "/app/cartoes", "/app/metas", "/app/nino", "/app/divisao-do-role", "/app/emocoes"]);
    for (const tip of DISCOVERY_TIPS) expect(routes.has(tip.route)).toBe(true);
  });
});

import { allocateAttention } from "../../supabase/functions/_shared/proactive/ranking";
import { DISCOVERY_TIPS } from "../../supabase/functions/_shared/proactive/featureDiscovery";

describe("aviso do dia da semana: WhatsApp não é bloqueado por entrega só no app", () => {
  it("dicas 'sempre úteis' existem para quem já usa tudo", () => {
    const heavyUser = { recurring_rules: 3, goals: 2, active_cards: 1, invoice_imports: 2, splits: 1, inbound_messages: 200, questions_asked: 50 };
    expect(DISCOVERY_TIPS.filter((t) => t.applies(heavyUser as never)).length).toBeGreaterThanOrEqual(5);
  });
  it("allocateAttention usa o conjunto do WhatsApp quando informado", () => {
    const situation: any = {
      fingerprint: "nino_weekday_nudge.v1:Transporte:2026-10-02", type: "weekday_nudge", communication_kind: "weekday_spending_risk",
      severity: "attention", title: "t", body: "b", primary_domain: "patterns", domains: ["patterns"], signals: [],
      impact_amount: 490, days_until: 0, confidence: 0.9, actionable: true, route: "/", priority_score: 50, score_reasons: [], evidence: {},
    };
    const ctx: any = { monthly_income: 7800, as_of: "2026-10-02", domains: {}, learning: {} };
    const fp = new Set([situation.fingerprint]);
    const out = allocateAttention({ situations: [situation], ctx, channels: ["app", "whatsapp"], alreadyDelivered: fp, alreadyDeliveredWhatsapp: new Set() });
    const wa = out.decisions.find((d) => d.channel === "whatsapp");
    const app = out.decisions.find((d) => d.channel === "app");
    expect(app?.reason).toBe("already_communicated_no_material_change");
    expect(wa?.decision).toBe("deliver");
  });
});
