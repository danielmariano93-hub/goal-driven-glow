import { describe, it, expect } from "vitest";
import { validateExtractedRow } from "../../supabase/functions/_shared/documents/types";

const base = () => ({
  type: "expense",
  amount: 10,
  occurred_at: "2026-07-15",
  description: "Uber",
  movement_kind: "transaction",
  payment_method: "account",
  installments_total: null,
  installment_number: null,
});

describe("validateExtractedRow — whitelists & quarantine", () => {
  it("accepts a canonical row", () => {
    const r = validateExtractedRow(base());
    expect(r.ok).toBe(true);
  });
  it("rejects amount = 0", () => {
    const r = validateExtractedRow({ ...base(), amount: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_amount");
  });
  it("rejects negative amount", () => {
    const r = validateExtractedRow({ ...base(), amount: -5 });
    expect(r.ok).toBe(false);
  });
  it("rejects NaN and Infinity", () => {
    expect(validateExtractedRow({ ...base(), amount: NaN }).ok).toBe(false);
    expect(validateExtractedRow({ ...base(), amount: Infinity }).ok).toBe(false);
  });
  it("rejects unknown type", () => {
    const r = validateExtractedRow({ ...base(), type: "transfer" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("type");
  });
  it("rejects unknown movement_kind (e.g. informational)", () => {
    const r = validateExtractedRow({ ...base(), movement_kind: "informational" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("movement_kind");
  });
  it("rejects unknown payment_method", () => {
    const r = validateExtractedRow({ ...base(), payment_method: "boleto" });
    expect(r.ok).toBe(false);
  });
  it("allows null payment_method", () => {
    const r = validateExtractedRow({ ...base(), payment_method: null });
    expect(r.ok).toBe(true);
  });
  it("rejects malformed date (month 13)", () => {
    const r = validateExtractedRow({ ...base(), occurred_at: "2026-13-01" });
    expect(r.ok).toBe(false);
  });
  it("rejects empty description", () => {
    const r = validateExtractedRow({ ...base(), description: "  " });
    expect(r.ok).toBe(false);
  });
  it("rejects installment_number out of range", () => {
    const r = validateExtractedRow({ ...base(), installment_number: 60 });
    expect(r.ok).toBe(false);
  });
});
