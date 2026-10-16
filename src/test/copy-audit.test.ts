import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

// Varre os textos de tela (src + Edge Functions) atrás de erros de português (plural por sufixo, sem acento etc.).
describe("auditoria de textos do produto", () => {
  it("não há erro de português nos textos que a pessoa lê", () => {
    const r = spawnSync("node", ["scripts/audit-copy.mjs", "--fail"], { encoding: "utf8" });
    expect(r.status, r.stdout).toBe(0);
  });
});
