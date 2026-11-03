// "o que gastei no dia 1º de novembro?" respondia o período inteiro: o resolvedor só entendia dd/mm.
import { describe, expect, it } from "vitest";
import { resolveExplicitPeriodPt } from "../../supabase/functions/_shared/analytics/explicitPeriodResolver";

const NOW = new Date("2026-11-03T15:00:00Z");
const day = (text: string) => resolveExplicitPeriodPt(text, NOW);

describe("dia + nome do mês", () => {
  it("1º de novembro e variações viram UM dia", () => {
    for (const t of ["1º de novembro", "dia 1º de novembro", "no dia 1 de novembro", "1 de novembro", "dia 01 de novembro", "1° de Novembro"]) {
      expect(day(t), t).toMatchObject({ from: "2026-11-01", to: "2026-11-01", kind: "day" });
    }
  });
  it("mês passado do calendário cai no ano anterior só quando o mês ainda não chegou", () => {
    expect(day("dia 15 de outubro")).toMatchObject({ from: "2026-10-15", to: "2026-10-15" });
    expect(day("dia 20 de dezembro")).toMatchObject({ from: "2025-12-20", to: "2025-12-20" });
    expect(day("dia 20 de dezembro de 2026")).toMatchObject({ from: "2026-12-20", to: "2026-12-20" });
  });
  it("intervalo no mesmo mês nomeado", () => {
    expect(day("do dia 1 a 5 de novembro")).toMatchObject({ from: "2026-11-01", to: "2026-11-05", kind: "range" });
    expect(day("10 ao dia 12 de outubro")).toMatchObject({ from: "2026-10-10", to: "2026-10-12" });
  });
  it("data inexistente ou texto solto não vira período", () => {
    expect(day("31 de fevereiro")).toBeNull();
    expect(day("novembro")).toBeNull();
    expect(day("gastei 1 de novembro no mercado")).toBeNull();
  });
});
