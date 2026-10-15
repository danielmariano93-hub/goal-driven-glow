import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("evento comportamental de gasto/entrada só para fato recente", () => {
  const sql = readFileSync("supabase/migrations/20261015150000_behavioral_event_recent_only.sql", "utf8");
  it("o gatilho ignora lançamentos com mais de 3 dias (histórico, vínculo de dívida antiga, edição de registro velho)", () => {
    expect(sql).toMatch(/NEW\.occurred_at\s*<\s*\(\(now\(\) AT TIME ZONE 'America\/Sao_Paulo'\)::date - 3\)\s*THEN RETURN NEW/);
  });
  it("continua marcando LARGE_SPEND e MONEY_IN para o que é recente", () => {
    expect(sql).toContain("v_event := 'LARGE_SPEND'");
    expect(sql).toContain("v_event := 'MONEY_IN'");
  });
});
