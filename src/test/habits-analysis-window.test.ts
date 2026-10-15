import { describe, expect, it } from "vitest";
import { analysisNote, weekendWindow } from "@/lib/behavioral/analysisWindow";

describe("janela da análise de fim de semana", () => {
  it("quinta 15/10/2026: dados até domingo 11/10; a sugestão vale para 16–18/10", () => {
    const w = weekendWindow("2026-10-15");
    expect(w).toMatchObject({ lastFriday: "2026-10-09", lastSunday: "2026-10-11", focusFriday: "2026-10-16", focusSunday: "2026-10-18", focusInProgress: false });
    expect(analysisNote("2026-10-15")).toBe("Leitura de 15/10, com dados até 14/10. Considera os fins de semana já fechados, até 11/10. A sugestão vale para o próximo fim de semana (16 a 18/10).");
  });
  it("sábado: o fim de semana em andamento é o foco", () => {
    const w = weekendWindow("2026-10-17");
    expect(w).toMatchObject({ focusFriday: "2026-10-16", focusSunday: "2026-10-18", focusInProgress: true, lastSunday: "2026-10-11" });
    expect(analysisNote("2026-10-17")).toContain("este fim de semana (16 a 18/10)");
  });
  it("domingo e segunda", () => {
    expect(weekendWindow("2026-10-18")).toMatchObject({ lastSunday: "2026-10-11", focusFriday: "2026-10-16", focusInProgress: true });
    expect(weekendWindow("2026-10-19")).toMatchObject({ lastSunday: "2026-10-18", lastFriday: "2026-10-16", focusFriday: "2026-10-23", focusInProgress: false });
  });
});

import { readFileSync } from "node:fs";
describe("fiação", () => {
  it("evolução na roda: legenda 'Antes', valores por dimensão e rolagem até a roda", () => {
    const w = readFileSync("src/components/habits/HabitsWheel.tsx", "utf8");
    expect(w).toContain("before-legend");
    expect(w).toContain("Antes ${fmt(");
    expect(w).toContain("scrollIntoView");
  });
  it("card do padrão mostra de quando é a leitura", () => {
    const page = readFileSync("src/pages/HabitsV2.tsx", "utf8");
    expect(page).toContain("data-testid=\"analysis-note\"");
    expect(page).toContain("analysisNote(patternsQuery.data.as_of)");
  });
  it("migration: ciclo terminado conta como fechado nos snapshots comportamentais", () => {
    const sql = readFileSync("supabase/migrations/20261015130000_behavior_finished_goal_cycles.sql", "utf8");
    expect(sql).toContain("behavioral_finished_cycles");
    expect(sql).toContain("end_date < coalesce(p_as_of + 1");
  });
});
