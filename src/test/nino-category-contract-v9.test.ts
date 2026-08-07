import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tools = readFileSync("supabase/functions/_shared/agent/tools.ts", "utf8");

describe("category contract v9", () => {
  it("nunca consulta o enum inexistente both", () => {
    expect(tools).not.toContain('"both"');
    expect(tools).not.toContain("'both'");
  });

  it("filtra categoria pelo type real do schema", () => {
    expect(tools).toContain('.eq("type", type)');
  });

  it("valida o type também quando recebe UUID", () => {
    expect(tools).toContain('.select("id,user_id,type")');
    expect(tools).toContain('String((data as any).type) !== type');
  });
});
