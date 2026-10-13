import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  clampReminderHour, composeDueMessage, coveredByDueReminders, normalizeDaysBefore, obligationKey, planDueReminders,
  type AgendaItem,
} from "../../supabase/functions/_shared/proactive/dueReminders";

const item = (over: Partial<AgendaItem>): AgendaItem => ({
  name: "Celular", type: "expense", amount: 120, date: "2026-10-14", source: "debt_installment", dedupKey: "debt:cel:2026-10", payment_status: "pending", ...over,
});
const AS_OF = "2026-10-13";

describe("lembretes de vencimento — plano", () => {
  it("avisa amanhã e hoje por padrão, numa única mensagem", () => {
    const plan = planDueReminders({
      asOf: AS_OF, daysBefore: [1, 0], sentKeys: new Set(),
      items: [item({}), item({ name: "Fatura Nubank", amount: 1234.5, date: AS_OF, source: "card_statement", dedupKey: "card:nu" })],
    });
    expect(plan.stages.map((s) => s.days)).toEqual([0, 1]);
    expect(plan.message).toContain("Seus próximos vencimentos");
    expect(plan.message).toContain("Hoje (13/10)");
    expect(plan.message).toContain("Amanhã (14/10)");
    expect(plan.message).toContain("R$ 1.234,50");
    expect(plan.message).toContain("Total: R$ 1.354,50");
    expect(plan.message).toContain("Se já pagou");
  });

  it("uma conta só: título direto e sem total", () => {
    const plan = planDueReminders({ asOf: AS_OF, daysBefore: [1, 0], sentKeys: new Set(), items: [item({})] });
    expect(plan.message).toContain("*Vence amanhã*");
    expect(plan.message).toContain("• Celular — R$ 120,00");
    expect(plan.message).not.toContain("Total");
  });

  it("não avisa o que já foi pago, o que é receita, parcela estimada de cartão nem atraso", () => {
    const plan = planDueReminders({
      asOf: AS_OF, daysBefore: [1, 0], sentKeys: new Set(),
      items: [
        item({ payment_status: "paid" }),
        item({ type: "income", name: "Salário" }),
        item({ source: "card_installment", name: "Parcela estimada" }),
        item({ date: "2026-10-12", name: "Atrasada" }),
        item({ date: "2026-10-20", name: "Longe" }),
      ],
    });
    expect(plan.message).toBeNull();
  });

  it("cada obrigação avisa uma vez por etapa: o log impede repetir", () => {
    const base = item({});
    const sent = new Set([`${obligationKey(base)}|1`]);
    expect(planDueReminders({ asOf: AS_OF, daysBefore: [1, 0], sentKeys: sent, items: [base] }).message).toBeNull();
    // no dia do vencimento é outra etapa: avisa de novo (uma vez)
    const dayOf = planDueReminders({ asOf: "2026-10-14", daysBefore: [1, 0], sentKeys: sent, items: [base] });
    expect(dayOf.message).toContain("*Vence hoje*");
  });

  it("respeita as antecedências escolhidas e limita a lista", () => {
    const many = Array.from({ length: 9 }, (_, i) => item({ name: `Conta ${i}`, dedupKey: `k${i}`, amount: 10 + i }));
    const plan = planDueReminders({ asOf: AS_OF, daysBefore: [1], sentKeys: new Set(), items: many });
    expect(plan.message).toContain("e mais 3");
    expect(planDueReminders({ asOf: AS_OF, daysBefore: [3], sentKeys: new Set(), items: many }).message).toBeNull();
  });

  it("valor estimado aparece como 'cerca de'", () => {
    expect(composeDueMessage([{ days: 1, keys: ["x"], items: [item({ estimated: true })] }])).toContain("cerca de R$ 120,00");
  });
});

describe("lembretes de vencimento — configuração", () => {
  it("normaliza antecedências inválidas para o padrão", () => {
    expect(normalizeDaysBefore([9, -1, "x"])).toEqual([1, 0]);
    expect(normalizeDaysBefore([0, 3, 1, 3])).toEqual([3, 1, 0]);
  });
  it("horário fica dentro da janela diurna", () => {
    expect(clampReminderHour(5, "21:00", "08:00")).toBe(8);
    expect(clampReminderHour(23, "21:00", "08:00")).toBe(20);
    expect(clampReminderHour(9, "21:00", "08:00")).toBe(9);
  });
  it("o motor proativo não repete no WhatsApp o que o canal dedicado cobre", () => {
    expect(coveredByDueReminders({ communication_kind: "debt_due_soon", days_until: 1 })).toBe(true);
    expect(coveredByDueReminders({ communication_kind: "bill_due_reminder" })).toBe(true);
    expect(coveredByDueReminders({ communication_kind: "debt_overdue", days_until: -2 })).toBe(false);
    expect(coveredByDueReminders({ communication_kind: "cash_flow_imbalance" })).toBe(false);
  });
});

describe("lembretes de vencimento — contrato", () => {
  const fn = readFileSync("supabase/functions/due-reminders-tick/index.ts", "utf8");
  const sql = readFileSync("supabase/migrations/20261013120000_due_reminders.sql", "utf8");
  it("só age para quem ligou, com autenticação de cron/admin", () => {
    expect(fn).toContain('.eq("due_reminders_enabled", true)');
    expect(fn).toContain("safeEqual(cron, CRON_SECRET)");
    expect(fn).toContain("platform_admins");
  });
  it("dry_run não envia nem registra", () => {
    expect(fn.indexOf("if (dryRun)")).toBeLessThan(fn.indexOf('from("outbound_messages")'));
  });
  it("outbound idempotente e log com unicidade por etapa", () => {
    expect(fn).toContain("idempotency_key: `due_reminder:");
    expect(sql).toContain("unique (user_id, obligation_key, days_before)");
    expect(sql).toContain("due_reminders_enabled boolean not null default false");
  });
  it("sem console.log de dados financeiros", () => {
    expect(fn).not.toMatch(/console\.log/);
  });
});
