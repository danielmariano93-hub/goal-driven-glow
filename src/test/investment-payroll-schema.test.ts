import { describe, expect, it } from "vitest";
import { investmentSchema } from "@/lib/validation/finance";

const base = { name: "Previdência Privada", category: "Outros", invested_amount: 334.88, current_value: 334.88, reference_date: "2026-10-27" };

describe("investimento com aporte em folha", () => {
  it("aceita aporte, dia, conta e contrapartida", () => {
    const r = investmentSchema.safeParse({ ...base, payroll_contribution_amount: 334.88, payroll_day: 27, payroll_account_id: "6c1cf814-2a25-4b3d-980d-c6454ccd35e0", employer_match_ratio: 1, employer_vested_pct: 100 });
    expect(r.success).toBe(true);
  });
  it("rejeita dia inválido e direito acima de 100%", () => {
    expect(investmentSchema.safeParse({ ...base, payroll_day: 32 }).success).toBe(false);
    expect(investmentSchema.safeParse({ ...base, employer_vested_pct: 120 }).success).toBe(false);
  });
  it("continua válido sem o bloco de folha", () => {
    expect(investmentSchema.safeParse(base).success).toBe(true);
  });
});
