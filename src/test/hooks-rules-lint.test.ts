import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("regras de hooks em todo o app", () => {
  it("nenhum componente chama hook depois de retorno antecipado ou condicional", () => {
    const run = spawnSync("npx", ["eslint", "src", "-f", "json"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const results = JSON.parse(run.stdout || "[]") as Array<{ filePath: string; messages: Array<{ ruleId: string | null; line: number }> }>;
    expect(results.length).toBeGreaterThan(100);
    const offenders = results.flatMap((r) =>
      r.messages.filter((m) => m.ruleId === "react-hooks/rules-of-hooks").map((m) => `${r.filePath.split("goal-driven-glow/")[1]}:${m.line}`));
    expect(offenders).toEqual([]);
  }, 240_000);
});
