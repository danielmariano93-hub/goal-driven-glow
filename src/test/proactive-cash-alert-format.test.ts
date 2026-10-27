import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(`${process.cwd()}/supabase/functions/_shared/proactive/situations.ts`, "utf8");

describe("alerta de caixa negativo", () => {
  it("não vaza data ISO nem minúscula o R$ do rótulo", () => {
    expect(src).not.toMatch(/\$\{cashNegative\.date\}(?!`)/);
    expect(src).not.toContain("cluster.label.toLowerCase()");
    expect(src).toContain("dateBR(cashNegative.date)");
    expect(src).toContain("lowerFirst(cluster.label)");
  });
});
