import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/pages/Cartoes.tsx", "utf8");

describe("aba Cartões: só o que é certeza", () => {
  it("usa a faixa de faturas oficiais e não exibe estimativas de próxima fatura/parcelas futuras", () => {
    expect(src).toContain("CardInvoiceStrip");
    expect(src).not.toContain("Próxima fatura");
    expect(src).not.toContain("Estimativa reconstruída");
    expect(src).not.toContain("parcelas futuras");
  });
  it("o radar de compromissos recebe só faturas oficiais (sem parcelas estimadas)", () => {
    expect(src).toContain("installments={[]}");
  });
  it("mostra saldo credor, vencimento e melhor data de compra", () => {
    expect(src).toContain("Saldo credor");
    expect(src).toContain("Melhor data de compra");
    expect(src).toContain("Vencimento");
  });
});
