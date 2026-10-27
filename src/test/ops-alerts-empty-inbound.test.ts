import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("vigia: mensagens recebidas", () => {
  it("ignora eventos vazios (sem texto e sem mídia) ao contar mensagens não processadas", () => {
    const sql = readFileSync(`${process.cwd()}/supabase/migrations/20261028110000_ops_alerts_ignore_empty_inbound.sql`, "utf8");
    expect(sql).toContain("coalesce(btrim(body), '''') <> ''''");
    expect(sql).toContain("coalesce(has_media, false)");
  });
});
