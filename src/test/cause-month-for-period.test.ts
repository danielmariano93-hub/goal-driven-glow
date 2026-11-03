import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { causeMonthForPeriod, causeReadWindow } from "@/lib/engine/causeEntries";

// Caso real: filtrar outubro e filtrar novembro davam "Outubro fechou R$ 5.405 / R$ 376 abaixo do normal":
// o cálculo usava a janela de lançamentos do período da tela, então a base (e o número) mudava com o filtro.
describe("mês explicado pelo card de causas", () => {
  const today = "2026-11-03";
  it("mês fechado escolhido → esse mês", () => {
    expect(causeMonthForPeriod({ start: "2026-10-01", end: "2026-10-31" }, today)).toBe("2026-10");
    expect(causeMonthForPeriod({ start: "2026-08-01", end: "2026-08-31" }, today)).toBe("2026-08");
  });
  it("mês atual, 7/30 dias e personalizado → último mês fechado", () => {
    expect(causeMonthForPeriod({ start: "2026-11-01", end: "2026-11-03" }, today)).toBe("2026-10");
    expect(causeMonthForPeriod({ start: "2026-10-05", end: "2026-11-03" }, today)).toBe("2026-10");
    expect(causeMonthForPeriod({ start: "2026-10-01", end: "2026-10-15" }, today)).toBe("2026-10");
  });
  it("outubro e novembro apontam o mesmo mês, logo o mesmo número", () => {
    const a = causeMonthForPeriod({ start: "2026-10-01", end: "2026-10-31" }, today);
    const b = causeMonthForPeriod({ start: "2026-11-01", end: "2026-11-03" }, today);
    expect(a).toBe(b);
  });
  it("virada de ano", () => {
    expect(causeMonthForPeriod({ start: "2027-01-01", end: "2027-01-10" }, "2027-01-10")).toBe("2026-12");
  });
  it("a janela de leitura depende só do mês explicado", () => {
    expect(causeReadWindow("2026-10")).toEqual({ from: "2026-03-01", before: "2026-11-01" });
  });
  it("o snapshot lê a janela fixa, não a janela do período", () => {
    const edge = readFileSync("supabase/functions/home-snapshot/index.ts", "utf8");
    expect(edge).toContain("causeMonthForPeriod({ start, end }, today)");
    expect(edge).toContain("fetchTransactionsBetween(sb, userId, win.from, win.before)");
  });
});
