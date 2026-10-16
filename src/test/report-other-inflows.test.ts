import { describe, it, expect } from "vitest";
import { summarizeOtherInflows } from "@/lib/engine/reportDashboard";

describe("o que entrou e não é renda", () => {
  it("agrupa resgates, empréstimo, reembolsos e rendimentos (caso real de outubro)", () => {
    const rows = [
      { movement_kind: "investment_redemption", amount: "6000.00" }, { movement_kind: "investment_redemption", amount: "1000.00" },
      { movement_kind: "external_transfer_in", amount: "1000.00", category: "Crédito de empréstimo" },
      { movement_kind: "refund", amount: "291.34" }, { movement_kind: "refund", amount: "116.12" },
      { movement_kind: "investment_yield", amount: "0.01" },
      { movement_kind: "transaction", amount: "208.67" }, // renda comum: fica fora daqui
    ];
    const out = summarizeOtherInflows(rows);
    expect(out.map((r) => [r.label, r.amount, r.count])).toEqual([
      ["Resgates de investimentos", 7000, 2],
      ["Crédito de empréstimo", 1000, 1],
      ["Reembolsos e estornos", 407.46, 2],
      ["Rendimentos de investimentos", 0.01, 1],
    ]);
  });
});
