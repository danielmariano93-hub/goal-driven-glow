import { describe, expect, it } from "vitest";
import { addMonths, averageChange, changeText, measureStats, movingAverage, nextDue } from "@/lib/habits/engine/goals";

const pt = (date: string, value: number) => ({ date, value });

describe("média móvel do peso", () => {
  it("cada ponto vira a média dos 7 dias que terminam nele", () => {
    const avg = movingAverage([pt("2026-11-01", 80), pt("2026-11-03", 82), pt("2026-11-09", 81)]);
    expect(avg[0].value).toBe(80);
    expect(avg[1].value).toBe(81); // (80+82)/2
    expect(avg[2].value).toBe(81.5); // janela 03/11 a 09/11: 82 e 81 (01/11 já saiu)
  });
  it("ordena por data", () => {
    expect(movingAverage([pt("2026-11-03", 82), pt("2026-11-01", 80)]).map((p) => p.date)).toEqual(["2026-11-01", "2026-11-03"]);
  });
});

describe("variação pela média semanal", () => {
  const series = (start: string, values: number[]) => values.map((v, i) => pt(`2026-10-${String(Number(start) + i).padStart(2, "0")}`, v));
  it("compara a média dos 7 primeiros dias com a dos 7 últimos", () => {
    const pts = [pt("2026-10-12", 83.4), pt("2026-10-14", 83.0), pt("2026-10-17", 83.3), pt("2026-10-20", 82.9), pt("2026-11-05", 82.2), pt("2026-11-08", 82.0), pt("2026-11-10", 81.8)];
    const r = averageChange(pts)!;
    expect(r.start).toBe(83.2); // (83,4+83,0+83,3)/3 = 83,23
    expect(r.now).toBe(82); // (82,2+82,0+81,8)/3
    expect(r.change).toBe(-1.2);
  });
  it("menos de 4 medidas ou menos de 14 dias: sem variação (ponto isolado não vale)", () => {
    expect(averageChange([pt("2026-11-01", 80), pt("2026-11-09", 79)])).toBeNull();
    expect(averageChange([pt("2026-11-01", 80), pt("2026-11-03", 80), pt("2026-11-05", 79), pt("2026-11-10", 79)])).toBeNull();
    expect(averageChange(series("1", [80, 80, 80]))).toBeNull();
  });
});

describe("medida mensal (cintura)", () => {
  it("primeira, última e diferença; tendência só a partir de 4 medidas", () => {
    const two = measureStats([pt("2026-10-12", 89.5), pt("2026-11-11", 88)]);
    expect(two).toMatchObject({ n: 2, change: -1.5, trend_ready: false });
    expect(two.first!.value).toBe(89.5);
    expect(two.last!.value).toBe(88);
    expect(measureStats([pt("2026-08-12", 91), pt("2026-09-12", 90), pt("2026-10-12", 89.5), pt("2026-11-11", 88)]).trend_ready).toBe(true);
  });
  it("uma medida ou nenhuma: sem diferença", () => {
    expect(measureStats([pt("2026-11-11", 88)]).change).toBeNull();
    expect(measureStats([])).toMatchObject({ n: 0, first: null, last: null, change: null });
  });
});

describe("próxima medida", () => {
  it("mensal: um mês depois da última, com fim de mês respeitado", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-12", 1)).toBe("2026-12-12");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });
  it("estados: já é dia, falta pouco, longe", () => {
    expect(nextDue("monthly", "2026-10-12", "2026-10-12", "2026-11-11")).toMatchObject({ due_on: "2026-11-12", days: 1, state: "soon" });
    expect(nextDue("monthly", "2026-10-12", "2026-10-12", "2026-11-12").state).toBe("due");
    expect(nextDue("monthly", "2026-10-12", "2026-10-12", "2026-11-20").state).toBe("due");
    expect(nextDue("weekly", "2026-11-09", "2026-10-12", "2026-11-10")).toMatchObject({ due_on: "2026-11-16", state: "ok" });
  });
  it("sem nenhuma medida, vale desde o começo do objetivo", () => {
    expect(nextDue("monthly", null, "2026-11-01", "2026-11-11")).toMatchObject({ due_on: "2026-11-01", state: "due" });
  });
});

describe("frase da variação", () => {
  it("sinal, vírgula e unidade; zero é 'sem variação'", () => {
    expect(changeText(-1.5, "cm")).toBe("−1,5 cm");
    expect(changeText(0.4, "kg")).toBe("+0,4 kg");
    expect(changeText(0, "kg")).toBe("sem variação");
  });
});
