// Mensagem automática sobre um lançamento precisa dizer DO QUE fala: o quê, categoria, valor e quando.
import { describe, expect, it } from "vitest";
import {
  buildTimingSituations,
  describeEventForMessage,
} from "../../supabase/functions/_shared/proactive/behavioralTimingRuntime";
import type { TimingContext } from "../../supabase/functions/_shared/proactive/behavioralTiming";

const NOW = "2026-10-15T15:00:00.000Z";
const ctx = (over: Partial<TimingContext> = {}): TimingContext => ({
  now: NOW, monthly_income: 8_800, materiality_floor: 100, truth_gate_safe: true,
  projected_month_end_available: 2_736.12, available_today: 3_000, sustainable_capacity: 600,
  has_active_goal: true, debt_pressure_dominant: false, commitment_pending: false, ...over,
});

const event = (type: string, payload: Record<string, unknown>, amount: number) => ({
  id: "ev1", user_id: "u1", event_type: type, economic_event_id: "tx1", economic_event_table: "transactions",
  occurred_at: "2026-10-15T12:00:00.000Z", materiality: amount, payload, processed_at: null, created_at: NOW,
}) as any;

const nb = (t: string) => t.replace(/\u00a0/g, " ");
const run = (ev: any) => buildTimingSituations({ events: [ev], timingCtx: ctx(), windows: {}, nextBest: null }).situations[0];

describe("describeEventForMessage", () => {
  it("monta o quê, o detalhe (valor · categoria) e o quando", () => {
    const d = describeEventForMessage({ description: "Celular", category_name: "Dívidas e empréstimos", occurred_at: "2026-10-14" }, 500, "2026-10-15");
    expect(d.what).toBe("“Celular”");
    expect(nb(d.detail)).toBe("R$ 500,00 · Dívidas e empréstimos");
    expect(d.when).toBe("ontem");
    expect(describeEventForMessage({ description: "X", occurred_at: "2026-10-15" }, 1, "2026-10-15").when).toBe("hoje");
    expect(describeEventForMessage({ description: "X", occurred_at: "2026-10-10" }, 1, "2026-10-15").when).toBe("em 10/10");
  });

  it("sem descrição usa a categoria; sem nada, admite que não tem descrição (nunca fica solto)", () => {
    expect(describeEventForMessage({ category_name: "Mercado" }, 10, "2026-10-15").what).toBe("um lançamento em Mercado");
    expect(describeEventForMessage({}, 10, "2026-10-15").what).toBe("um lançamento sem descrição");
  });
});

describe("mensagem automática de gasto novo (caso real: 'Celular' R$ 500)", () => {
  const sit = run(event("LARGE_SPEND", { description: "Celular", category_name: "Dívidas e empréstimos", occurred_at: "2026-10-15" }, 500));

  it("identifica o gasto, a categoria, o valor e o dia", () => {
    expect(sit).toBeTruthy();
    expect(sit.title).toContain("Celular");
    expect(sit.body).toContain("Celular");
    expect(sit.body).toContain("Dívidas e empréstimos");
    expect(nb(sit.body)).toContain("R$ 500,00");
    expect(sit.body).toMatch(/hoje|ontem|em \d{2}\/\d{2}/);
  });

  it("não volta ao texto solto de antes", () => {
    expect(sit.body).not.toMatch(/em um gasto relevante/i);
  });
});

describe("mensagem de repetição de comportamento nomeia o que foi repetido", () => {
  // o gatilho exige 3 ocorrências do mesmo tipo
  const three = (type: string, payload: Record<string, unknown>, amount: number) =>
    buildTimingSituations({
      events: [1, 2, 3].map((i) => ({ ...event(type, payload, amount), id: `ev${i}`, economic_event_id: `tx${i}` })),
      timingCtx: ctx(), windows: {}, nextBest: null,
    }).situations[0];

  it("aporte em meta e pagamento de dívida dizem qual meta/dívida", () => {
    const g = three("GOAL_CONTRIBUTION", { goal_id: "g1", goal_name: "Viagem Lisboa" }, 900);
    const d = three("DEBT_PAYMENT", { debt_id: "d1", debt_name: "Celular" }, 500);
    expect(g.body).toContain("Viagem Lisboa");
    expect(g.title).toContain("Viagem Lisboa");
    expect(d.body).toContain("Celular");
    expect(d.body).not.toContain("esse movimento");
  });
});
