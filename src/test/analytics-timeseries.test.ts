import { describe, it, expect } from "vitest";
import { computeDailySpend } from "../../supabase/functions/_shared/analytics/timeseries.ts";
import { buildTimeseriesArtifact } from "../../supabase/functions/_shared/artifacts/builder.ts";

const tx = (d: string, amt: number) => ({
  id: crypto.randomUUID(),
  account_id: "a1",
  category_id: null,
  type: "expense" as const,
  status: "settled",
  amount: amt,
  occurred_at: `${d}T12:00:00Z`,
  description: "x",
  transfer_group_id: null,
  payment_method: "account",
  movement_kind: "expense",
});

describe("timeseries daily", () => {
  it("gera labels contínuas e agrupa valores por dia", () => {
    const txs = [tx("2026-07-01", 100), tx("2026-07-01", 50), tx("2026-07-03", 30)] as any;
    const r = computeDailySpend({ txs, from: "2026-07-01", to: "2026-07-05" });
    expect(r.labels).toEqual(["2026-07-01","2026-07-02","2026-07-03","2026-07-04","2026-07-05"]);
    expect(r.daily).toEqual([150, 0, 30, 0, 0]);
    expect(r.total).toBe(180);
    expect(r.provenance.formula_version).toBe("timeseries.daily.v1");
  });

  it("média móvel de 7 dias é acumulada corretamente", () => {
    const txs = [tx("2026-07-01", 70), tx("2026-07-02", 0), tx("2026-07-03", 0)] as any;
    const r = computeDailySpend({ txs, from: "2026-07-01", to: "2026-07-03" });
    expect(r.rolling7[0]).toBeCloseTo(70);
    expect(r.rolling7[1]).toBeCloseTo(35);
    expect(r.rolling7[2]).toBeCloseTo(70 / 3, 2);
  });

  it("builder gera chart line com duas séries", () => {
    const txs = [tx("2026-07-01", 100)] as any;
    const r = computeDailySpend({ txs, from: "2026-07-01", to: "2026-07-02" });
    const a = buildTimeseriesArtifact(r);
    expect(a.chart.type).toBe("line");
    expect(a.chart.series.map(s => s.name)).toEqual(["Diário", "Média 7 dias"]);
    expect(a.chart.x_labels).toEqual(["01/07", "02/07"]);
    expect(a.provenance.formula_version).toBe("timeseries.daily.v1");
  });
});
