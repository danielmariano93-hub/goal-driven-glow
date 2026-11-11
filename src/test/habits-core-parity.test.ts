import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HABITS_CORE_MODULES, edgeIndexPath, edgeIndexSource, edgePath, readAppSource, toEdgeSource } from "../../scripts/sync-habits-core.mjs";

describe("habits-core: paridade app × edge functions", () => {
  for (const mod of HABITS_CORE_MODULES) {
    it(`mantém ${mod}.ts idêntico ao espelho das edge functions`, () => {
      expect(readFileSync(edgePath(mod), "utf8")).toBe(toEdgeSource(readAppSource(mod)));
    });
  }
  it("exporta o índice do core", () => {
    expect(readFileSync(edgeIndexPath(), "utf8")).toBe(edgeIndexSource());
  });
  it("o espelho não usa especificadores sem extensão (Deno)", () => {
    for (const mod of HABITS_CORE_MODULES) {
      const src = readFileSync(edgePath(mod), "utf8");
      expect(src).not.toMatch(/from "\.\/[a-zA-Z]+"/);
    }
  });
});
