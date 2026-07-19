import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("categorias globais", () => {
  it("inclui categorias do usuário e globais", () => {
    const source = fs.readFileSync("supabase/functions/assistant-ingest-document/index.ts", "utf8");
    expect(source).toContain("user_id.is.null");
    expect(source).toContain("user_id.eq.${userId}");
  });
});
