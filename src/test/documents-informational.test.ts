import { describe, it, expect } from "vitest";
import { sanitize, normalizeMovementKind } from "../../supabase/functions/_shared/documents/types";

describe("informational preservation & drop", () => {
  it("normalizeMovementKind preserves 'informational'", () => {
    expect(normalizeMovementKind("informational", "expense")).toBe("informational");
    expect(normalizeMovementKind("saldo", "expense")).toBe("informational");
    expect(normalizeMovementKind("subtotal", "income")).toBe("informational");
  });

  it("sanitize drops informational rows and counts them", () => {
    const result = sanitize({
      k: "statement",
      i: [
        ["expense", "2026-07-16", 10, "Uber", "account", null, null, "transaction"],
        ["expense", "2026-07-16", 999, "Saldo total consolidado", "account", null, null, "informational"],
        ["income", "2026-07-16", 500, "Resumo mensal", "account", null, null, "summary"],
      ],
    }, "2026-07-17");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].description).toBe("Uber");
    expect(result.informational_dropped).toBe(2);
  });

  it("sanitize drops saldo/limite lines via keyword filter too", () => {
    const result = sanitize({
      k: "statement",
      i: [
        ["expense", "2026-07-16", 100, "Saldo do dia", "account"],
        ["expense", "2026-07-16", 20, "Café", "account"],
      ],
    }, "2026-07-17");
    expect(result.items.map((i) => i.description)).toEqual(["Café"]);
  });
});
