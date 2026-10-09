import { describe, expect, it } from "vitest";
import {
  buildWeekendForecasts,
  detectCardGap,
  weekendCoveredCategories,
  weekendForecastSituation,
} from "../../supabase/functions/_shared/proactive/weekendForecast";
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
    expect(sit.body).toMatch(/Nos últimos 12 fins de semana você gastou com Lazer em \d+, em geral entre R\$\s?[\d.,]+ e R\$\s?[\d.,]+/);
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
