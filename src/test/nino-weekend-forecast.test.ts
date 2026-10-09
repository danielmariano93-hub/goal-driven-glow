import { describe, expect, it } from "vitest";
import {
  buildWeekendForecasts,
  detectCardGap,
  weekendCoveredCategories,
  weekendForecastSituation,
} from "../../supabase/functions/_shared/proactive/weekendForecast";
import { buildWeekendRecap, buildWeekendRecaps, weekendRecapSituation } from "../../supabase/functions/_shared/proactive/weekendRecap";
import { narrativeEligibility } from "../../supabase/functions/_shared/agent/narrative/TonePolicy";
import { repeatedKind } from "../../supabase/functions/_shared/proactive/repetition";
import { loadNudgeGoals } from "../../supabase/functions/_shared/proactive/profileLoaders";
import { goalsFromReadings } from "../../supabase/functions/_shared/proactive/weekendForecast";
import { buildWeekdayProjection } from "../../supabase/functions/_shared/proactive/weekdayNudge";

type Tx = { occurred_at: string; amount: number; category: string; payment_method?: string };

const TODAY = "2026-10-09"; // sexta
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const dow = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay();
const ctx = { as_of: TODAY, snapshot_ref: { reconciliation_id: "r", formula_version: "f" } };

/** Lazer: 8 de cada 12 fins de semana com gasto (sex 80, sáb 150, dom 300); dia útil quase nada. */
function lazerHistory(opts: { octMultiplier?: number; spike?: boolean } = {}): Tx[] {
  const rows: Tx[] = [];
  let weekendIndex = 0;
  for (let t = Date.UTC(2026, 6, 1); t < Date.UTC(2026, 9, 9); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const w = dow(d);
    const inOct = d.startsWith("2026-10");
    const k = inOct ? opts.octMultiplier ?? 1 : 1;
    if (w === 5) weekendIndex += 1;
    const active = weekendIndex % 3 !== 0;
    if (active && w === 5) rows.push({ occurred_at: d, amount: 80 * k, category: "Lazer" });
    if (active && w === 6) rows.push({ occurred_at: d, amount: 150 * k, category: "Lazer" });
    if (active && w === 0) rows.push({ occurred_at: d, amount: 300 * k, category: "Lazer" });
    if (w === 2) rows.push({ occurred_at: d, amount: 10, category: "Lazer" });
  }
  if (opts.spike) rows.push({ occurred_at: iso(2026, 9, 5), amount: 9000, category: "Lazer" });
  return rows;
}

describe("previsão do fim de semana", () => {
  it("só existe na sexta", () => {
    expect(buildWeekendForecasts(lazerHistory(), "2026-10-10")).toEqual([]);
  });

  it("mês em linha e sem meta: silêncio", () => {
    expect(buildWeekendForecasts(lazerHistory({ octMultiplier: 0.5 }), TODAY)).toEqual([]);
  });

  it("mês acima da média dos anteriores: avisa com faixa, projeção e quanto cabe", () => {
    const [f] = buildWeekendForecasts(lazerHistory({ octMultiplier: 4 }), TODAY);
    expect(f.state).toBe("pressure");
    expect(f.category).toBe("Lazer");
    expect(f.anchor.kind).toBe("average");
    expect(f.active_weekends).toBeGreaterThanOrEqual(5);
    expect(f.low).toBeLessThanOrEqual(f.typical);
    expect(f.typical).toBeLessThanOrEqual(f.high);
    expect(f.projected_low).toBeLessThanOrEqual(f.projected_month);
    expect(f.projected_month).toBeLessThanOrEqual(f.projected_high);
    expect(f.projected_month).toBeGreaterThan(f.anchor.amount);
    expect(f.weekend_share).toBeGreaterThan(0.55);
    // 4 fins de semana restantes em outubro contando este (9–11, 16–18, 23–25, 30–31)
    expect(f.weekend_units_left).toBeCloseTo(3 + 2 / 3, 1);
  });

  it("com meta, mostra a folga mesmo com o mês em linha", () => {
    const [f] = buildWeekendForecasts(lazerHistory(), TODAY, { Lazer: { name: "Lazer", limit: 3000 } });
    expect(f.state).toBe("room");
    expect(f.anchor).toEqual({ kind: "goal", amount: 3000 });
    expect(f.slack).toBeCloseTo(3000 - f.month_to_date, 1);
    expect(f.fair_per_weekend).toBeGreaterThan(0);
  });

  it("categoria de data fixa e pico pontual não geram previsão", () => {
    const subs = lazerHistory({ octMultiplier: 4 }).map((t) => ({ ...t, category: "Assinaturas" }));
    expect(buildWeekendForecasts(subs, TODAY)).toEqual([]);
    expect(buildWeekendForecasts(lazerHistory({ spike: true }), TODAY)).toEqual([]);
  });

  it("falta de compras de cartão no mês não bloqueia: avisa com a ressalva", () => {
    const card: Tx[] = [];
    for (const m of [7, 8, 9]) for (let d = 1; d <= 6; d += 1) card.push({ occurred_at: iso(2026, m, d), amount: 50, category: "Mercado", payment_method: "credit_card" });
    const rows = [...lazerHistory({ octMultiplier: 4 }), ...card];
    expect(detectCardGap(rows, TODAY)).toBe(true);
    const [f] = buildWeekendForecasts(rows, TODAY);
    expect(f.data_gap).toBe("card_missing");
    const sit = weekendForecastSituation(f, ctx, new Date("2026-10-09T11:00:00Z"))!;
    expect(sit.body).toMatch(/Obs\.: não encontrei compras de cartão/);
  });

  it("mensagem: kind, identidade do fim de semana, faixa e só de manhã", () => {
    const [f] = buildWeekendForecasts(lazerHistory({ octMultiplier: 4 }), TODAY);
    const sit = weekendForecastSituation(f, ctx, new Date("2026-10-09T11:00:00Z"))!;
    expect(sit.communication_kind).toBe("weekend_spending_risk");
    expect(sit.fingerprint).toBe("nino_weekend_forecast.v1:Lazer:2026-10-09");
    expect(sit.title).toMatch(/Fim de semana: Lazer pode estourar o mês/);
    expect(sit.body).toMatch(/Nos últimos 12 fins de semana você gastou com Lazer em \d+, em geral (uns|entre) R\$\s?[\d.,]+/);
    expect(sit.body).toMatch(/fecha perto de R\$/);
    expect((sit.evidence as any).forecast.category).toBe("Lazer");
    expect(weekendForecastSituation(f, ctx, new Date("2026-10-09T23:00:00Z"))).toBeNull();
  });

  it("o aviso por dia da semana não repete a categoria coberta pelo fim de semana", () => {
    const rows = lazerHistory({ octMultiplier: 4 });
    const covered = weekendCoveredCategories(buildWeekendForecasts(rows, "2026-10-09"));
    expect(covered.has("Lazer")).toBe(true);
    expect(buildWeekdayProjection(rows, "2026-10-10", {}, covered)?.pattern.category).not.toBe("Lazer");
  });
});

describe("fechamento de segunda", () => {
  const MONDAY = "2026-10-12";
  const rctx = { as_of: MONDAY, snapshot_ref: { reconciliation_id: "r", formula_version: "f" } };
  const [forecast] = buildWeekendForecasts(lazerHistory({ octMultiplier: 4 }), TODAY);
  const delivered = [{ forecast }];
  const weekend = (amount: number): Tx[] => [{ occurred_at: "2026-10-10", amount, category: "Lazer" }];

  it("só fecha na segunda e só se a previsão foi entregue", () => {
    expect(buildWeekendRecap(delivered, weekend(100), "2026-10-13")).toBeNull();
    expect(buildWeekendRecap([], weekend(100), MONDAY)).toBeNull();
    expect(buildWeekendRecap([{ forecast: { ...forecast, friday: "2026-10-02" } }], weekend(100), MONDAY)).toBeNull();
  });

  it("compara o realizado com a faixa que foi prevista", () => {
    const below = buildWeekendRecap(delivered, weekend(Math.max(1, forecast.low - 50)), MONDAY)!;
    expect(below.verdict).toBe("below");
    const within = buildWeekendRecap(delivered, weekend(forecast.typical), MONDAY)!;
    expect(within.verdict).toBe("within");
    const above = buildWeekendRecap(delivered, weekend(forecast.high + 400), MONDAY)!;
    expect(above.verdict).toBe("above");
    expect(above.vs_typical).toBeLessThan(0);
  });

  it("soma sexta a domingo, mostra o mês e dá o quanto cabe por fim de semana", () => {
    const rows: Tx[] = [
      { occurred_at: "2026-10-09", amount: 80, category: "Lazer" },
      { occurred_at: "2026-10-10", amount: 150, category: "Lazer" },
      { occurred_at: "2026-10-11", amount: 300, category: "Lazer" },
      { occurred_at: "2026-10-08", amount: 999, category: "Mercado" },
    ];
    const recap = buildWeekendRecap(delivered, rows, MONDAY)!;
    expect(recap.realized).toBe(530);
    expect(recap.month_to_date).toBeGreaterThanOrEqual(530);
    expect(recap.weekends_left).toBe(3); // 16, 23 e 30/10
    const sit = weekendRecapSituation(recap, rctx, new Date("2026-10-12T11:00:00Z"))!;
    expect(sit.fingerprint).toBe("nino_weekend_recap.v1:Lazer:2026-10-09");
    expect(sit.communication_kind).toBe("weekend_spending_risk");
    expect(sit.body).toMatch(/Você gastou R\$\s?530,00 com Lazer/);
    expect(sit.body).toMatch(/Lazer no mês:/);
    expect(weekendRecapSituation(recap, rctx, new Date("2026-10-12T23:00:00Z"))).toBeNull();
  });

  it("os números são o conteúdo: sem reescrita de linguagem e sem janela de repetição entre sexta e segunda", () => {
    expect(narrativeEligibility("weekend_spending_risk")).toEqual({ eligible: false, reason: "operational_kind" });
    expect(narrativeEligibility("weekday_spending_risk")).toEqual({ eligible: false, reason: "operational_kind" });
    const sit = weekendRecapSituation(buildWeekendRecap(delivered, weekend(200), MONDAY), rctx, new Date("2026-10-12T11:00:00Z"))!;
    const friday = [{ kind: "weekend_spending_risk", channel: "whatsapp", delivered_at: "2026-10-09T11:00:00Z", impact_amount: 900 }];
    expect(repeatedKind(sit, "whatsapp", friday, new Date("2026-10-12T11:00:00Z"))).toBeNull();
  });
});

describe("metas reais do usuário", () => {
  // Metas criadas como this_month / next_month (não "monthly_recurring"): a data do período decide, não o tipo.
  const goalRows = [
    { category_id: "c1", computed_limit: "714.77", status: "active", start_date: "2026-09-01", end_date: "2026-09-30" },
    { category_id: "c1", computed_limit: "943.87", status: "active", start_date: "2026-10-01", end_date: "2026-10-31" },
    { category_id: "c2", computed_limit: "1059.88", status: "active", start_date: "2026-10-01", end_date: "2026-10-31" },
    { category_id: "c3", computed_limit: "500", status: "active", start_date: "2026-11-01", end_date: "2026-11-30" },
  ];
  const cats = [{ id: "c1", name: "Alimentação" }, { id: "c2", name: "Lazer" }, { id: "c3", name: "Mercado" }];
  const sb: any = {
    from: (table: string) => {
      const rows = table === "categories" ? cats : goalRows;
      const q: any = { select: () => q, eq: () => q, or: () => q, lte: () => Promise.resolve({ data: rows.filter((r: any) => !r.start_date || r.start_date <= TODAY) }), then: (res: any) => res({ data: rows }) };
      return q;
    },
  };

  it("lê a meta que cobre hoje, qualquer que seja o tipo de período", async () => {
    const goals = await loadNudgeGoals(sb, "u", TODAY);
    expect(goals).toEqual({
      Alimentação: { name: "Alimentação", limit: 943.87 },
      Lazer: { name: "Lazer", limit: 1059.88 },
    });
  });

  it("mais de uma categoria vira uma mensagem só, com a principal em detalhe", () => {
    const rows = [...lazerHistory({ octMultiplier: 4 }), ...lazerHistory({ octMultiplier: 4 }).map((t) => ({ ...t, category: "Transporte" }))];
    const fs = buildWeekendForecasts(rows, TODAY, { Lazer: { name: "Lazer", limit: 1000 }, Transporte: { name: "Transporte", limit: 900 } });
    expect(fs.map((f) => f.category).sort()).toEqual(["Lazer", "Transporte"]);
    const sit = weekendForecastSituation(fs, ctx, new Date("2026-10-09T11:00:00Z"))!;
    expect(sit.title).toBe("Fim de semana: onde o mês pode estourar");
    expect(sit.body).toMatch(/Também neste fim de semana:\n/);
    expect((sit.evidence as any).forecasts).toHaveLength(2);
    // o fechamento de segunda cobre as duas
    const monday = "2026-10-12";
    const recaps = buildWeekendRecaps((sit.evidence as any).forecasts.map((forecast: any) => ({ forecast })), [
      { occurred_at: "2026-10-10", amount: 200, category: "Lazer" },
      { occurred_at: "2026-10-10", amount: 90, category: "Transporte" },
    ], monday);
    expect(recaps).toHaveLength(2);
    const recap = weekendRecapSituation(recaps, { ...ctx, as_of: monday }, new Date("2026-10-12T11:00:00Z"))!;
    expect(recap.title).toBe("Como foi o fim de semana");
    expect(recap.body).toMatch(/Outras categorias:\n/);
  });
});

describe("gasto do mês pela leitura canônica da meta", () => {
  const readings = [
    { category_name: "Lazer", status: "at_risk", limit: 1059.88, actual: 341.83, period: { start: "2026-10-01", end: "2026-10-31" } },
    { category_name: "Alimentação", status: "on_track", limit: 714.77, actual: 600, period: { start: "2026-09-01", end: "2026-09-30" } },
    { category_name: "Mercado", status: "paused", limit: 500, actual: 10, period: { start: "2026-10-01", end: "2026-10-31" } },
  ];

  it("só entram metas abertas que cobrem hoje", () => {
    expect(goalsFromReadings(readings, TODAY)).toEqual({ Lazer: { name: "Lazer", limit: 1059.88, actual: 341.83 } });
  });

  it("a previsão usa o gasto da meta (estornos já aplicados), não a soma bruta", () => {
    const goals = goalsFromReadings(readings, TODAY);
    const [f] = buildWeekendForecasts(lazerHistory({ octMultiplier: 4 }), TODAY, goals);
    expect(f.month_to_date).toBe(341.83);
    expect(f.anchor).toEqual({ kind: "goal", amount: 1059.88 });
  });
});
