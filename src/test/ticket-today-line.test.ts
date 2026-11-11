import { describe, expect, it } from "vitest";
import { todayLine } from "@/lib/ticket/todayLine";

const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const base = { cycle: { next: "2026-11-27", days_left: 16 }, ideal_per_day: 40.58, spent_today: 0, today_remaining: 40.58, today_over: 0, today_over_pct: 0, ideal_from_tomorrow: 37.98 };
const st = (o: Record<string, unknown>) => ({ ...base, ...o }) as never;

describe("frase de hoje no Ticket", () => {
  it("sem gasto: quanto cabe hoje", () => {
    expect(todayLine(st({}), brl, dm)).toBe("Hoje cabem R$ 40,58 para fechar o ciclo no crédito de 27/11.");
  });
  it("gastou menos que o ideal: quanto ainda cabe", () => {
    expect(todayLine(st({ spent_today: 26, today_remaining: 14.58 }), brl, dm)).toBe("Hoje você já gastou R$ 26,00: ainda cabem R$ 14,58 dos R$ 40,58 do dia.");
  });
  it("gastou exatamente o ideal", () => {
    expect(todayLine(st({ spent_today: 40.58, today_remaining: 0 }), brl, dm)).toBe("Hoje você já gastou R$ 40,58: esse foi todo o ideal do dia.");
  });
  it("estourou: diz o quanto passou, em %, e quanto dá por dia daqui para frente (caso do print)", () => {
    const t = todayLine(st({ spent_today: 79.56, today_remaining: 0, today_over: 38.98, today_over_pct: 96 }), brl, dm)!;
    expect(t).toBe("Hoje você já gastou R$ 79,56: R$ 38,98 (96%) acima dos R$ 40,58 do dia. Para fechar o ciclo no crédito de 27/11, dá para gastar R$ 37,98 por dia a partir de amanhã.");
    expect(t).not.toContain("ainda cabem");
  });
  it("estourou no último dia do ciclo: não inventa média futura", () => {
    const t = todayLine(st({ spent_today: 60, today_remaining: 0, today_over: 19.42, today_over_pct: 48, ideal_from_tomorrow: null }), brl, dm)!;
    expect(t).toContain("acima dos");
    expect(t).toContain("O próximo crédito é em 27/11.");
  });
  it("sem ideal calculado: não mostra nada", () => {
    expect(todayLine(st({ ideal_per_day: null, today_remaining: null }), brl, dm)).toBeNull();
  });
});
