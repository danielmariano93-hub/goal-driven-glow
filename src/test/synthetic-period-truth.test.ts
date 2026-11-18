import { describe, expect, it } from "vitest";
// @ts-ignore módulo .mjs
import { PERSONAS, buildSpec, buildTruth } from "../../supabase/functions/_shared/synthetic/personas.mjs";
// @ts-ignore
import { SCENARIOS } from "../../supabase/functions/_shared/synthetic/scenarios.mjs";

describe("gabarito de período dos usuários sintéticos", () => {
  const ref = new Date(Date.UTC(2026, 10, 18)); // 18/11/2026
  const persona = PERSONAS.find((p: any) => p.id === "clt_estavel") ?? PERSONAS[0];
  const spec = buildSpec(persona, ref);
  const t = buildTruth(spec, ref);
  const sum = (from: string, to: string) => Math.round(spec.transactions.filter((x: any) => x.type === "expense" && x.date >= from && x.date <= to).reduce((a: number, x: any) => a + x.amount, 0) * 100) / 100;
  it("mês até hoje e mesmos dias do mês anterior batem com a soma direta", () => {
    expect(t["mtd:exp"]).toBe(sum("2026-11-01", "2026-11-18"));
    expect(t["same:exp"]).toBe(sum("2026-10-01", "2026-10-18"));
    expect(t["days:mtd"]).toBe(18);
  });
  it("7 dias contra os 7 anteriores não se sobrepõem", () => {
    expect(t["l7:exp"]).toBe(sum("2026-11-12", "2026-11-18"));
    expect(t["p7:exp"]).toBe(sum("2026-11-05", "2026-11-11"));
  });
  it("1 a 15 do mês anterior", () => {
    expect(t["d15:exp:M1"]).toBe(sum("2026-10-01", "2026-10-15"));
  });
  it("cenários P01–P07 existem e têm ids únicos", () => {
    const ids = SCENARIOS.map((s: any) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i <= 7; i++) expect(ids).toContain(`P0${i}`);
  });
});
