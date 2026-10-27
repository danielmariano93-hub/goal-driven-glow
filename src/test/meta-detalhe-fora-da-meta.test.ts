// A lista "Lançamentos considerados" da meta não pode mostrar parcelas de compras
// anteriores como se consumissem a meta (`goal_consumption.v1`): elas vão para a
// seção "Fora da meta".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(process.cwd(), "src/pages/MetaCategoriaDetalhe.tsx"), "utf8");

describe("MetaCategoriaDetalhe — fora da meta", () => {
  it("separa parcelas carregadas dos lançamentos considerados", () => {
    expect(src).toContain("isCarriedInstallment");
    expect(src).toContain("const countedTxs");
    expect(src).toContain("const carriedTxs");
    expect(src).toContain('data-testid="goal-carried-list"');
  });

  it("a lista de considerados e o contador usam só os que consomem a meta", () => {
    expect(src).toContain("{countedTxs.length} no período");
    expect(src).toContain("countedTxs.map((t) =>");
    expect(src).not.toContain("periodTxs.map((t) =>");
  });
});
