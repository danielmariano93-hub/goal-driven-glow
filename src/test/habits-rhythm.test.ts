import { describe, expect, it } from "vitest";
import { cravingHours, dayRhythm, hourPattern, localHour, weekHistory, type DatedEntry } from "@/lib/habits/engine/rhythm";

describe("hora local", () => {
  it("converte o instante para o fuso da pessoa", () => {
    expect(localHour("2026-11-11T23:30:00Z", "America/Sao_Paulo")).toBe(20.5);
    expect(localHour("2026-11-11T02:00:00Z", "America/Sao_Paulo")).toBe(23);
    expect(localHour("2026-11-11T12:00:00Z", "Europe/Lisbon")).toBe(12);
  });
  it("entrada inválida não quebra", () => {
    expect(localHour("lixo", "America/Sao_Paulo")).toBeNull();
    expect(localHour("2026-11-11T12:00:00Z", "Fuso/Inexistente")).toBeNull();
  });
});

describe("ritmo do dia", () => {
  const e = (hour: number, amount = 250) => ({ hour, amount });
  it("20h, 1,0 L de 1,5 L: esperado 1,31 L, abaixo do ritmo, faltam 500 ml em 2 h", () => {
    const r = dayRhythm({ target: 1500, total: 1000, entries: [e(8.2), e(12.7), e(15.5), e(17.2)], nowHour: 20 })!;
    expect(r.expected).toBeCloseTo(1312.5, 1);
    expect(r.gap).toBeCloseTo(312.5, 1);
    expect(r.state).toBe("behind");
    expect(r.remaining).toBe(500);
    expect(r.hours_left).toBe(2);
    expect(r.per_hour_needed).toBe(250);
    expect(r.untimed).toBe(0);
    expect(r.perHour.find((h) => h.hour === 8)!.amount).toBe(250);
    expect(r.from).toBe(6);
    expect(r.to).toBe(22);
  });
  it("até 10% da meta abaixo do esperado ainda é 'no ritmo'", () => {
    // 14h: esperado 750; fez 650 (gap 100 <= 150)
    expect(dayRhythm({ target: 1500, total: 650, entries: [], nowHour: 14 })!.state).toBe("on_pace");
    expect(dayRhythm({ target: 1500, total: 550, entries: [], nowHour: 14 })!.state).toBe("behind");
    expect(dayRhythm({ target: 1500, total: 800, entries: [], nowHour: 14 })!.state).toBe("ahead");
  });
  it("antes de acordar não cobra nada; depois de dormir só mostra o que falta", () => {
    expect(dayRhythm({ target: 1500, total: 0, entries: [], nowHour: 5 })!.state).toBe("ahead");
    const late = dayRhythm({ target: 1500, total: 1000, entries: [], nowHour: 22.5 })!;
    expect(late.state).toBe("closed");
    expect(late.hours_left).toBe(0);
    expect(late.per_hour_needed).toBeNull();
  });
  it("meta batida", () => {
    const r = dayRhythm({ target: 1500, total: 1500, entries: [], nowHour: 9 })!;
    expect(r.state).toBe("done");
    expect(r.remaining).toBe(0);
    expect(r.per_hour_needed).toBeNull();
  });
  it("o que não tem hora aparece à parte e a janela cresce se houve registro fora dela", () => {
    const r = dayRhythm({ target: 1500, total: 1000, entries: [e(23.5, 250), e(5.2, 250)], nowHour: 12 })!;
    expect(r.untimed).toBe(500);
    expect(r.from).toBe(5);
    expect(r.to).toBe(24);
    expect(r.perHour.find((h) => h.hour === 23)!.amount).toBe(250);
    expect(r.perHour.find((h) => h.hour === 5)!.amount).toBe(250);
  });
  it("sem meta, sem cálculo", () => {
    expect(dayRhythm({ target: 0, total: 100, entries: [], nowHour: 12 })).toBeNull();
  });
});

describe("padrão por horário", () => {
  const day = (i: number) => `2026-11-${String(i + 1).padStart(2, "0")}`;
  const mk = (days: number): DatedEntry[] =>
    Array.from({ length: days }, (_, i) => [9, 10, 13, 20].map((hour) => ({ local_date: day(i), hour: hour + 0.3, amount: 250 }))).flat();
  it("cedo demais: menos de 7 dias com hora não vira padrão", () => {
    expect(hourPattern(mk(6))).toBeNull();
  });
  it("aponta a janela de pico e o trecho vazio", () => {
    const p = hourPattern(mk(7))!;
    expect(p.days).toBe(7);
    expect(p.share[9]).toBeCloseTo(0.25, 5);
    expect(p.peak).toMatchObject({ from: 9, to: 12 });
    expect(p.peak!.share).toBeCloseTo(0.5, 5);
    expect(p.quiet).toEqual({ from: 14, to: 20 });
  });
  it("distribuição pareada não inventa pico", () => {
    const flat: DatedEntry[] = [];
    for (let d = 0; d < 7; d++) for (let h = 6; h < 22; h++) flat.push({ local_date: day(d), hour: h, amount: 100 });
    const p = hourPattern(flat)!;
    expect(p.peak).toBeNull();
    expect(p.quiet).toBeNull();
  });
});

describe("vontades por hora", () => {
  const pts = (hours: number[], handled: boolean | null = true) => hours.map((hour) => ({ hour, handled }));
  it("menos de 10 vontades: sem leitura", () => {
    expect(cravingHours(pts([15, 16, 17]))).toBeNull();
  });
  it("aponta a janela difícil e conta resistidas", () => {
    const c = cravingHours([...pts([15, 15, 16, 16, 17, 17, 16], true), ...pts([15, 17], false), ...pts([9, 21], true), ...pts([10], null)])!;
    expect(c.total).toBe(12);
    expect(c.resisted).toBe(9);
    expect(c.answered).toBe(11);
    expect(c.peak).toMatchObject({ from: 15, to: 18 });
    expect(c.peak!.share).toBeCloseTo(9 / 12, 5);
    expect(c.perHour[15]).toMatchObject({ resisted: 2, ceded: 1, open: 0 });
  });
  it("espalhadas ao longo do dia: nenhum horário difícil", () => {
    const c = cravingHours(pts([7, 9, 11, 13, 15, 17, 19, 21, 8, 12, 16, 20]))!;
    expect(c.peak).toBeNull();
  });
});

describe("histórico de semanas", () => {
  it("conta só semanas fechadas, nas últimas 8", () => {
    const w = [true, false, true, true, false, true, true, true, false].map((met, i, a) => ({ closed: i < a.length - 1, met }));
    expect(weekHistory(w)).toEqual({ closed: 7, met: 5 });
    expect(weekHistory([{ closed: false, met: true }])).toEqual({ closed: 0, met: 0 });
  });
});
