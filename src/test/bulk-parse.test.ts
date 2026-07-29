import { describe, it, expect } from "vitest";
import { parseBulkItems, parseBrAmountLoose, sumItems } from "../../supabase/functions/_shared/agent/bulkParse";

describe("bulkParse", () => {
  it("parses BRL amounts in both notations", () => {
    expect(parseBrAmountLoose("R$ 1.234,56")).toBeCloseTo(1234.56, 2);
    expect(parseBrAmountLoose("5,40")).toBeCloseTo(5.4, 2);
    expect(parseBrAmountLoose("5.40")).toBeCloseTo(5.4, 2);
    expect(parseBrAmountLoose(12.9)).toBeCloseTo(12.9, 2);
    expect(parseBrAmountLoose("abc")).toBeNull();
  });

  it("extracts items from a JSON payload", () => {
    const text = `Segue a fatura:\n{"lancamentos":[{"descricao":"Uber","valor":"23,90"},{"descricao":"Padaria","valor":"12,00"},{"descricao":"Netflix","valor":39.9}]}`;
    const r = parseBulkItems(text);
    expect(r.source).toBe("json");
    expect(r.items).toHaveLength(3);
    expect(sumItems(r.items)).toBeCloseTo(75.8, 2);
  });

  it("extracts items from plain lines", () => {
    const text = ["Fatura Itaú julho", "Uber - R$ 23,90", "Padaria R$ 12,00", "Netflix R$ 39,90", "Total R$ 75,80"].join("\n");
    const r = parseBulkItems(text);
    expect(r.source).toBe("lines");
    expect(r.items.map(i => i.description)).toEqual(["Uber", "Padaria", "Netflix"]);
  });

  it("ignores short lists (single expense stays on the normal flow)", () => {
    expect(parseBulkItems("gastei 42,90 no almoço").items).toHaveLength(0);
  });
});
