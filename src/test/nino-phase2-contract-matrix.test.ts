import { describe, expect, it } from "vitest";
import { resolveNarrowDeterministicTurn } from "../../supabase/functions/_shared/agent/core/NarrowDeterministicGate.ts";
import { resolveTimeAspectPt } from "../../supabase/functions/_shared/analytics/periodResolver.ts";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter.ts";
import { normalizeToV3 } from "../../supabase/functions/_shared/agent/core/FinancialIRv3.ts";
import { applyTurnAspect } from "../../supabase/functions/_shared/agent/core/SemanticAspectOverlay.ts";
import { requestedSubsumesExecuted } from "../../supabase/functions/_shared/agent/core/SemanticPreservation.ts";
import {
  MONTHLY_SERIES_FORMULA_VERSION,
  monthlySeriesExecutedIR,
  type MonthlySpendingSeriesResult,
} from "../../supabase/functions/_shared/agent/core/handlers/MonthlySeriesHandler.ts";

const NOW = new Date("2026-09-26T19:00:00-03:00");
const PERIOD = { from: "2026-09-01", to: "2026-09-26", label: "este mês" };

function canonicalSignature(text: string) {
  const turn = resolveNarrowDeterministicTurn(text);
  expect(turn, text).not.toBeNull();
  const q = turn!.financial_read!.queries[0];
  const time = resolveTimeAspectPt(text, NOW);
  return {
    category: turn!.focus.category,
    merchant: turn!.focus.merchant,
    metric: q.metric,
    operation: q.operation,
    group_by: [...(q.group_by ?? [])],
    filters: [...(q.filters ?? [])]
      .map((f) => `${f.field}=${String(f.value)}`)
      .sort(),
    aspect: time.aspect,
    grain: time.grain,
    from: time.from,
    to: time.to,
    n: time.n,
    exclude_partial: time.exclude_partial,
  };
}

describe("Nino Phase 2 — contract matrix and semantic invariants", () => {
  it("maps category+merchant paraphrases and word order to one canonical intent", () => {
    const variants = [
      "Quanto gastei com Lazer no Thales mês a mês nos últimos 7 meses?",
      "Quanto gastei no Thales com Lazer mês a mês nos últimos 7 meses?",
      "Quanto gastei no Thales em Lazer mês por mês nos últimos sete meses?",
      "Quanto gastei em Lazer no Thales em cada mês nos últimos 7 meses?",
      "Nino, quanto eu gastei com Lazer no Thales por mês nos últimos sete meses?",
    ];

    const signatures = variants.map(canonicalSignature);
    for (const signature of signatures) {
      expect(signature).toEqual({
        category: "Lazer",
        merchant: "Thales",
        metric: "expense_amount",
        operation: "trend",
        group_by: ["month"],
        filters: ["category=Lazer", "merchant=Thales"],
        aspect: "trend",
        grain: "month",
        from: "2026-03-01",
        to: "2026-09-26",
        n: 7,
        exclude_partial: false,
      });
    }
  });

  it.each([
    ["5", "2026-05-01"],
    ["cinco", "2026-05-01"],
    ["7", "2026-03-01"],
    ["sete", "2026-03-01"],
    ["10", "2025-12-01"],
    ["dez", "2025-12-01"],
  ])("changing only N changes only the calendar window: %s months", (token, expectedFrom) => {
    const text = `Quanto gastei com Lazer mês a mês nos últimos ${token} meses?`;
    const signature = canonicalSignature(text);
    expect(signature.category).toBe("Lazer");
    expect(signature.merchant).toBeNull();
    expect(signature.metric).toBe("expense_amount");
    expect(signature.operation).toBe("trend");
    expect(signature.group_by).toEqual(["month"]);
    expect(signature.from).toBe(expectedFrom);
    expect(signature.to).toBe("2026-09-26");
  });

  it("keeps habitual paraphrases equivalent and separate from factual month-by-month", () => {
    const variants = [
      "Quanto gasto por mês com Lazer?",
      "Quanto eu gasto aproximadamente por mês com Lazer?",
      "Quanto costumo gastar por mês com Lazer?",
      "Quanto estou gastando por mês com Lazer?",
    ];

    for (const text of variants) {
      const signature = canonicalSignature(text);
      expect(signature).toMatchObject({
        category: "Lazer",
        merchant: null,
        metric: "expense_amount",
        operation: "value",
        group_by: [],
        filters: ["category=Lazer"],
        aspect: "habitual",
        grain: "month",
        from: "2026-03-01",
        to: "2026-08-31",
        n: 6,
        exclude_partial: true,
      });
    }
  });

  it("preserves requested IR through execution and rejects filter/window/grain mutations", () => {
    const text = "Quanto gastei com Lazer no Thales mês a mês nos últimos 7 meses?";
    const turn = resolveNarrowDeterministicTurn(text)!;
    const compiled = compileFinancialReadFromTurn({ turn, period: PERIOD })!;
    const requested = applyTurnAspect(
      normalizeToV3(compiled.ir!, { today: "2026-09-26" }),
      text,
      NOW,
    ).ir.queries[0];

    const result: MonthlySpendingSeriesResult = {
      version: "nino_monthly_series.v1",
      formula_version: MONTHLY_SERIES_FORMULA_VERSION,
      months: [],
      total: 0,
      transaction_count: 0,
      window: { from: "2026-03-01", to: "2026-09-26", n: 7 },
      scope: { category: "Lazer", merchant: "Thales" },
      partial_first_month: false,
      partial_last_month: true,
    };
    const executed = monthlySeriesExecutedIR(requested, result);
    expect(requestedSubsumesExecuted(requested, executed).compatible).toBe(true);

    const noMerchant = {
      ...executed,
      filters: executed.filters.filter((f) => f.field !== "merchant"),
    };
    expect(requestedSubsumesExecuted(requested, noMerchant)).toMatchObject({
      compatible: false,
      mismatches: expect.arrayContaining([expect.objectContaining({ reason: "filter_lost" })]),
    });

    const wrongWindow = {
      ...executed,
      time: { ...executed.time, from: "2026-03-26" },
    };
    expect(requestedSubsumesExecuted(requested, wrongWindow)).toMatchObject({
      compatible: false,
      mismatches: expect.arrayContaining([expect.objectContaining({ reason: "window_changed" })]),
    });

    const wrongGrain = { ...executed, grain: "day" as const };
    expect(requestedSubsumesExecuted(requested, wrongGrain)).toMatchObject({
      compatible: false,
      mismatches: expect.arrayContaining([expect.objectContaining({ reason: "grain_changed" })]),
    });
  });
});
