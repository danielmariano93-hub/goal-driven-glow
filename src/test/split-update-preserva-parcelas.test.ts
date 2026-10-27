import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261028150000_split_update_preserva_parcelas.sql", "utf8");

describe("split_update_v3 não apaga o parcelamento", () => {
  it("sem mapa de parcelas, preserva as existentes quando já somam a parte de cada pessoa", () => {
    expect(sql).toMatch(/IF v_consistent THEN\s+RETURN;/);
    expect(sql).toMatch(/<> coalesce\(p\.amount_due, 0\)/);
  });
  it("com mapa, continua aplicando as parcelas", () => {
    expect(sql).toMatch(/mapped := p_installments/);
    expect(sql).toMatch(/split_apply_installments\(p_id, mapped\)/);
  });
});
