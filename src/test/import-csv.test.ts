import { describe, it, expect } from "vitest";
import { parseCsv, parseBrNumber, parseBrDate } from "@/lib/import/csv";

describe("parseBrNumber/Date", () => {
  it("parseia valor BR com R$ e milhar", () => {
    expect(parseBrNumber("R$ 1.234,56")).toBeCloseTo(1234.56);
    expect(parseBrNumber("-89,90")).toBeCloseTo(-89.9);
  });
  it("parseia dd/mm/yyyy", () => {
    expect(parseBrDate("01/02/2026")).toBe("2026-02-01");
    expect(parseBrDate("2026-02-01")).toBe("2026-02-01");
    expect(parseBrDate("")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("interpreta CSV BR com ponto-vírgula", () => {
    const text = `data;valor;descricao\n01/02/2026;R$ 1.234,56;Aluguel\n05/02/2026;-89,90;Mercado`;
    const r = parseCsv(text, { date: "data", amount: "valor", description: "descricao" });
    expect(r.separator).toBe(";");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].amount).toBeCloseTo(1234.56);
    expect(r.rows[0].occurred_at).toBe("2026-02-01");
    expect(r.rows[1].description).toBe("Mercado");
  });

  it("marca linhas inválidas", () => {
    const text = `data;valor;descricao\ninvalido;abc;X`;
    const r = parseCsv(text, { date: "data", amount: "valor", description: "descricao" });
    expect(r.rows[0].errors.length).toBeGreaterThan(0);
  });
});
