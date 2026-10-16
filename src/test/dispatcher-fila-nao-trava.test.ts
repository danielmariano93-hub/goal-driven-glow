import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts", "utf8");

/**
 * Regressão (16/10): itens barrados por materialidade/aprendizado ficavam "pending" para sempre e, como a fila é lida
 * dos mais antigos para os novos (janela fixa), os itens novos nunca eram avaliados — ninguém recebia nada.
 */
describe("despachante proativo: item barrado sai da fila", () => {
  const dropBlock = src.slice(src.indexOf("if (drop) {"), src.indexOf("seenTopics.add(topic)"));

  it("registra a barragem E encerra o item (dismissed), só se ainda estiver pending", () => {
    expect(dropBlock).toContain('status: "suppressed", reason: drop');
    expect(dropBlock).toContain('.from("pending_proactive_suggestions")');
    expect(dropBlock).toContain('status: "dismissed"');
    expect(dropBlock).toContain('.eq("status", "pending")');
  });

  it("não encerra em simulação (dryRun)", () => {
    expect(dropBlock).toMatch(/if \(!dryRunEarly\) \{[\s\S]*dismissed/);
  });

  it("a janela de leitura tem folga (≥ 60) para não depender só dos mais antigos", () => {
    expect(src).toMatch(/poolSize = Math\.max\(limit \* 6, 60\)/);
  });
});
