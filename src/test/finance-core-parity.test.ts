import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FINANCE_CORE_MODULES, edgePath, readAppSource, toEdgeSource } from "../../scripts/sync-finance-core.mjs";

describe("finance-core: paridade app × edge functions", () => {
  for (const mod of FINANCE_CORE_MODULES) {
    it(`mantém ${mod}.ts idêntico ao espelho das edge functions`, () => {
      const expected = toEdgeSource(readAppSource(mod));
      const actual = readFileSync(edgePath(mod), "utf8");
      expect(actual).toBe(expected);
    });
  }

  it("exporta o índice do core", () => {
    const index = readFileSync("supabase/functions/_shared/finance-core/index.ts", "utf8");
    for (const mod of FINANCE_CORE_MODULES) expect(index).toContain(`./${mod}.ts`);
  });
});
