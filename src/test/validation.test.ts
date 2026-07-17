import { describe, it, expect } from "vitest";
import { loginSchema, signupSchema, passwordSchema } from "@/lib/validation/auth";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { transactionSchema, transferSchema, accountSchema, debtSchema } from "@/lib/validation/finance";

describe("auth validation", () => {
  it("rejects short passwords", () => {
    expect(passwordSchema.safeParse("abc12").success).toBe(false);
  });
  it("accepts strong passwords", () => {
    expect(passwordSchema.safeParse("abcdef12").success).toBe(true);
  });
  it("login requires email + password", () => {
    expect(loginSchema.safeParse({ email: "x@y.com", password: "abcdef12" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "not-email", password: "abcdef12" }).success).toBe(false);
  });
  it("signup requires name", () => {
    expect(signupSchema.safeParse({ displayName: "", email: "a@b.com", password: "abcdef12" }).success).toBe(false);
  });
});

describe("onboarding validation", () => {
  it("accepts full input", () => {
    const r = onboardingSchema.safeParse({ displayName: "Ana", approximateMonthlyIncome: 3000, incomeFrequency: "mensal", incomeDay: 5, timezone: "America/Sao_Paulo", currency: "BRL" });
    expect(r.success).toBe(true);
  });
  it("rejects invalid day", () => {
    const r = onboardingSchema.safeParse({ displayName: "Ana", incomeFrequency: "mensal", incomeDay: 45, timezone: "America/Sao_Paulo", currency: "BRL" });
    expect(r.success).toBe(false);
  });
});

describe("finance validation", () => {
  it("transaction requires positive amount", () => {
    expect(transactionSchema.safeParse({ account_id: "00000000-0000-0000-0000-000000000000", type: "expense", status: "confirmed", amount: 0, occurred_at: "2026-01-01" }).success).toBe(false);
    expect(transactionSchema.safeParse({ account_id: "00000000-0000-0000-0000-000000000000", type: "expense", status: "confirmed", amount: 10, occurred_at: "2026-01-01" }).success).toBe(true);
  });
  it("accepts a credit-card expense without an account", () => {
    expect(transactionSchema.safeParse({ payment_method: "credit_card", account_id: null, credit_card_id: "00000000-0000-0000-0000-000000000001", type: "expense", status: "confirmed", amount: 42.9, occurred_at: "2026-07-17" }).success).toBe(true);
  });
  it("requires the selected financial source", () => {
    expect(transactionSchema.safeParse({ payment_method: "credit_card", account_id: null, credit_card_id: null, type: "expense", status: "confirmed", amount: 42.9, occurred_at: "2026-07-17" }).success).toBe(false);
  });
  it("transfer rejects same accounts", () => {
    const same = "00000000-0000-0000-0000-000000000000";
    const r = transferSchema.safeParse({ from_account_id: same, to_account_id: same, amount: 10, occurred_at: "2026-01-01" });
    expect(r.success).toBe(false);
  });
  it("account requires name", () => {
    expect(accountSchema.safeParse({ name: "", type: "checking", opening_balance: 0, active: true }).success).toBe(false);
  });
  it("account accepts opening_balance = 0", () => {
    const r = accountSchema.safeParse({ name: "Carteira", type: "cash", opening_balance: 0, active: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.opening_balance).toBe(0);
  });
  it("account accepts negative opening_balance", () => {
    expect(accountSchema.safeParse({ name: "X", type: "checking", opening_balance: -50, active: true }).success).toBe(true);
  });
  it("account accepts positive opening_balance", () => {
    expect(accountSchema.safeParse({ name: "X", type: "checking", opening_balance: 1234.56, active: true }).success).toBe(true);
  });
  it("debt outstanding <= original enforced in UI, schema allows individually", () => {
    expect(debtSchema.safeParse({ name: "X", original_amount: 100, outstanding_balance: 50 }).success).toBe(true);
    expect(debtSchema.safeParse({ name: "X", original_amount: -5, outstanding_balance: 0 }).success).toBe(false);
  });
});
