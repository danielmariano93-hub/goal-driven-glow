import { describe, it, expect } from "vitest";

// Duplicate the shared logic here for browser-friendly test, since edge/_shared
// uses Deno imports. Behavior must match _shared/documents/types.ts.
function normalizeAmountBR(raw: string | number): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw * 100) / 100;
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/[R$\s]/g, "");
  const commaLast = s.lastIndexOf(",");
  const dotLast = s.lastIndexOf(".");
  let n: number;
  if (commaLast > dotLast) {
    n = Number(s.replace(/\./g, "").replace(",", "."));
  } else {
    n = Number(s.replace(/,/g, ""));
  }
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function normalizeDateBR(raw: string, fallback: string): string {
  if (!raw) return fallback;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (br) {
    let y = br[3];
    if (y.length === 2) y = (Number(y) >= 70 ? "19" : "20") + y;
    return `${y}-${br[2]}-${br[1]}`;
  }
  return fallback;
}

const NON_TX = ["saldo disponível", "saldo total", "saldo do dia", "limite disponível", "limite da conta", "pagamento fatura", "subtotal"];
const isNonTx = (d: string) => NON_TX.some((k) => d.toLowerCase().includes(k));

describe("BRL amount normalization", () => {
  it("parses 1.234,56 as 1234.56", () => {
    expect(normalizeAmountBR("1.234,56")).toBe(1234.56);
  });
  it("parses R$ 89,90", () => {
    expect(normalizeAmountBR("R$ 89,90")).toBe(89.9);
  });
  it("parses 12.50 as 12.50", () => {
    expect(normalizeAmountBR("12.50")).toBe(12.5);
  });
  it("rejects zero and negatives", () => {
    expect(normalizeAmountBR("0")).toBeNull();
    expect(normalizeAmountBR("-5")).toBeNull();
  });
  it("keeps numeric input", () => {
    expect(normalizeAmountBR(45.67)).toBe(45.67);
  });
});

describe("BR date normalization", () => {
  it("parses 15/03/2024", () => {
    expect(normalizeDateBR("15/03/2024", "2020-01-01")).toBe("2024-03-15");
  });
  it("keeps ISO", () => {
    expect(normalizeDateBR("2024-03-15", "2020-01-01")).toBe("2024-03-15");
  });
  it("expands 2-digit year", () => {
    expect(normalizeDateBR("15/03/24", "2020-01-01")).toBe("2024-03-15");
  });
  it("uses fallback when unparseable", () => {
    expect(normalizeDateBR("ontem", "2020-01-01")).toBe("2020-01-01");
  });
});

describe("Non-transaction filter", () => {
  it("skips saldo disponível", () => {
    expect(isNonTx("Saldo disponível hoje")).toBe(true);
  });
  it("skips pagamento fatura", () => {
    expect(isNonTx("Pagamento fatura Nubank")).toBe(true);
  });
  it("skips daily balance and overdraft limit", () => {
    expect(isNonTx("SALDO DO DIA")).toBe(true);
    expect(isNonTx("Limite da Conta utilizado")).toBe(true);
  });
  it("keeps normal purchase", () => {
    expect(isNonTx("iFood delivery")).toBe(false);
  });
});
