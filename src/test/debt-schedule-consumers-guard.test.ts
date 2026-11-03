import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Regressão "Réveillon sumiu": todo consumidor da agenda de dívidas precisa ler os campos da agenda
// ancorada (1ª parcela/início/pagas/próxima parcela), senão cai no `due_day` antigo.
const NEEDED = ["installments_total", "installments_paid", "start_date", "first_due_date", "next_installment_due"];
const FILES = [
  "supabase/functions/home-snapshot/index.ts",
  "supabase/functions/insights-generate/index.ts",
  "supabase/functions/financial-reports-generate/catalogHighlights.ts",
  "supabase/functions/pulse-compute/index.ts",
];

describe("consumidores da agenda de dívidas leem a data da 1ª parcela", () => {
  for (const file of FILES) {
    it(file, () => {
      const src = readFileSync(file, "utf8");
      const m = src.match(/from\("debts"\)\.select\("([^"]+)"\)/);
      expect(m, "select de debts não encontrado").toBeTruthy();
      for (const col of NEEDED) expect(m![1]).toContain(col);
    });
  }
  it("o fingerprint do snapshot muda quando só a data da 1ª parcela muda", () => {
    const src = readFileSync("src/lib/engine/metrics.ts", "utf8");
    expect(src).toMatch(/d:\$\{row\.id\}[^`]*first_due_date/);
  });
});
