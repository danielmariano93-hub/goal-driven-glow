import { describe, expect, it } from "vitest";
import { clockText, localParts, regularity, type LogTime } from "@/lib/habits/engine/regularity";

const TZ = "America/Sao_Paulo"; // UTC-3
const log = (local_date: string, hhmmLocal: string, over: Partial<LogTime> = {}): LogTime => {
  const [h, m] = hhmmLocal.split(":").map(Number);
  const d = new Date(`${local_date}T00:00:00Z`);
  d.setUTCHours(h + 3, m); // local → UTC
  return { habit_id: "a", local_date, status: "done", source: "app", logged_at: d.toISOString(), ...over };
};
const days = (n: number) => Array.from({ length: n }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);

describe("partes locais do instante", () => {
  it("data e minutos no fuso da pessoa", () => {
    expect(localParts("2026-11-11T11:40:00Z", TZ)).toEqual({ date: "2026-11-11", minutes: 8 * 60 + 40 });
    expect(localParts("2026-11-11T02:30:00Z", TZ)).toEqual({ date: "2026-11-10", minutes: 23 * 60 + 30 });
    expect(localParts("lixo", TZ)).toBeNull();
    expect(clockText(7 * 60 + 40)).toBe("07:40");
  });
});

describe("regularidade do horário", () => {
  it("menos de 7 dias: ainda cedo", () => {
    expect(regularity(days(6).map((d) => log(d, "07:40")), TZ)).toBeNull();
  });
  it("mediana e quantos dias ficaram a até 1 hora dela", () => {
    const l = [...days(8).map((d) => log(d, "07:40")), log("2026-11-09", "10:30"), log("2026-11-10", "07:05")];
    const r = regularity(l, TZ)!;
    expect(r.days).toBe(10);
    expect(clockText(r.typical_min)).toBe("07:40");
    expect(r.within).toBe(9); // 07:05 está a 35 min; 10:30 está fora
    expect(r.share).toBeCloseTo(0.9, 5);
  });
  it("retroativo ('dia anterior'), registro em outro dia e repetido não entram", () => {
    const base = days(7).map((d) => log(d, "21:00"));
    const noise = [
      log("2026-11-08", "08:00", { source: "backfill" }),
      log("2026-11-09", "21:00", { logged_at: new Date("2026-11-11T00:00:00Z").toISOString() }), // marcado dois dias depois
      log("2026-11-01", "06:00"), // segundo registro do mesmo dia
      log("2026-11-10", "09:00", { status: "skipped" }),
    ];
    const r = regularity([...base, ...noise], TZ)!;
    expect(r.days).toBe(7);
    expect(clockText(r.typical_min)).toBe("21:00");
  });
  it("virada às 03:00: marcar à 00:30 conta para o dia anterior e não 'quebra' a regularidade de quem faz à noite", () => {
    const l = [
      ...days(5).map((d) => log(d, "23:30")),
      // 00:30 do dia seguinte, registrado no dia do hábito anterior (local_date = dia anterior)
      { habit_id: "a", local_date: "2026-11-06", status: "done", source: "app", logged_at: "2026-11-07T03:30:00Z" },
      { habit_id: "a", local_date: "2026-11-07", status: "done", source: "app", logged_at: "2026-11-08T03:10:00Z" },
    ];
    const r = regularity(l, TZ)!;
    expect(r.days).toBe(7);
    expect(clockText(r.typical_min)).toBe("23:30");
    expect(r.within).toBe(7); // 00:30 e 00:10 estão a até 1 h de 23:30 no eixo que vira às 03:00
  });
});
