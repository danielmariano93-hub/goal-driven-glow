import { describe, expect, it } from "vitest";
import { parseTimeSpec, resolveTimeSpec, TIME_SPEC_JSON_SCHEMA, TIME_SPEC_KINDS, type TimeSpec } from "../../supabase/functions/_shared/time/TimeSpec";
import { buildTemporalContractV3, resolvePeriodExpressionV3 } from "../../supabase/functions/_shared/agent/v3/TemporalContractV3";

const spec = (kind: TimeSpec["kind"], p: Partial<TimeSpec> = {}): TimeSpec => ({ kind, offset: null, extent: null, month: null, year: null, days: null, from_day: null, to_day: null, from: null, to: null, ...p });
const w = (s: TimeSpec, today: string) => { const r = resolveTimeSpec(s, today); return r ? `${r.from}..${r.to}` : null; };
const T = "2026-11-24";

describe("TimeSpec: cada tipo resolve a janela certa (hoje = 24/11/2026)", () => {
  it("dia", () => { expect(w(spec("today"), T)).toBe("2026-11-24..2026-11-24"); expect(w(spec("yesterday"), T)).toBe("2026-11-23..2026-11-23"); });
  it("este mês até hoje e mês inteiro", () => {
    expect(w(spec("calendar_month", { offset: 0, extent: "to_date" }), T)).toBe("2026-11-01..2026-11-24");
    expect(w(spec("calendar_month", { offset: 0 }), T)).toBe("2026-11-01..2026-11-24");
    expect(w(spec("calendar_month", { offset: 0, extent: "whole" }), T)).toBe("2026-11-01..2026-11-30");
  });
  it("mês passado e retrasado são inteiros; to_date num mês passado = mesmos dias", () => {
    expect(w(spec("calendar_month", { offset: -1 }), T)).toBe("2026-10-01..2026-10-31");
    expect(w(spec("calendar_month", { offset: -2 }), T)).toBe("2026-09-01..2026-09-30");
    expect(w(spec("calendar_month", { offset: -1, extent: "to_date" }), T)).toBe("2026-10-01..2026-10-24");
  });
  it("mesmos dias do mês anterior", () => { expect(w(spec("same_days_previous_month"), T)).toBe("2026-10-01..2026-10-24"); });
  it("mês nomeado: sem ano usa o mais recente; futuro é inválido", () => {
    expect(w(spec("named_month", { month: 10 }), T)).toBe("2026-10-01..2026-10-31");
    expect(w(spec("named_month", { month: 12 }), T)).toBe("2025-12-01..2025-12-31");
    expect(w(spec("named_month", { month: 11 }), T)).toBe("2026-11-01..2026-11-24");
    expect(w(spec("named_month", { month: 3, year: 2027 }), T)).toBeNull();
    expect(w(spec("named_month", { month: 13 }), T)).toBeNull();
  });
  it("últimos N dias e os N anteriores não se sobrepõem", () => {
    expect(w(spec("rolling_days", { days: 7 }), T)).toBe("2026-11-18..2026-11-24");
    expect(w(spec("previous_rolling_days", { days: 7 }), T)).toBe("2026-11-11..2026-11-17");
  });
  it("intervalo de dias e desde o dia N", () => {
    expect(w(spec("day_range", { from_day: 1, to_day: 15, offset: -1 }), T)).toBe("2026-10-01..2026-10-15");
    expect(w(spec("day_range", { from_day: 1, to_day: 31, offset: -2 }), T)).toBe("2026-09-01..2026-09-30");
    expect(w(spec("since_day", { from_day: 5 }), T)).toBe("2026-11-05..2026-11-24");
    expect(w(spec("since_day", { from_day: 28 }), T)).toBeNull();
  });
  it("semana e ano", () => {
    expect(w(spec("week", { offset: 0 }), T)).toBe("2026-11-23..2026-11-24");
    expect(w(spec("week", { offset: -1 }), T)).toBe("2026-11-16..2026-11-22");
    expect(w(spec("year", { offset: 0 }), T)).toBe("2026-01-01..2026-11-24");
    expect(w(spec("year", { offset: -1 }), T)).toBe("2025-01-01..2025-12-31");
  });
  it("datas explícitas válidas; inválidas viram null", () => {
    expect(w(spec("explicit_range", { from: "2026-10-05", to: "2026-10-09" }), T)).toBe("2026-10-05..2026-10-09");
    expect(w(spec("explicit_range", { from: "2026-10-09", to: "2026-10-05" }), T)).toBeNull();
    expect(w(spec("explicit_range", { from: "2026-02-30", to: "2026-03-01" }), T)).toBeNull();
  });
  it("spec nulo ou desconhecido não inventa janela", () => {
    expect(resolveTimeSpec(null, T)).toBeNull();
    expect(resolveTimeSpec({ ...spec("today"), kind: "outra_coisa" as any }, T)).toBeNull();
  });
});

describe("propriedades da álgebra (hoje percorrendo 2024–2027)", () => {
  const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000 + 1;
  const dates: string[] = [];
  for (let y = 2024; y <= 2027; y++) for (let m = 1; m <= 12; m++) for (const d of [1, 2, 15, 28, 29, 30, 31]) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso) dates.push(iso);
  }
  it("mesmos dias: começa dia 1 do mês anterior, nunca passa do fim dele e tem min(dia de hoje, tamanho) dias", () => {
    for (const t of dates) {
      const r = resolveTimeSpec(spec("same_days_previous_month"), t)!;
      const [y, m] = t.split("-").map(Number);
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      expect(r.from, t).toBe(`${py}-${String(pm).padStart(2, "0")}-01`);
      expect(days(r.from, r.to), t).toBe(Math.min(Number(t.slice(8, 10)), last));
    }
  });
  it("este mês até hoje: dia 1 até hoje, nunca no futuro", () => {
    for (const t of dates) {
      const r = resolveTimeSpec(spec("calendar_month", { offset: 0, extent: "to_date" }), t)!;
      expect(r.from).toBe(`${t.slice(0, 7)}-01`);
      expect(r.to).toBe(t);
    }
  });
  it("N dias e os N anteriores são vizinhos sem sobreposição e têm N dias", () => {
    for (const t of dates) for (const n of [1, 7, 30]) {
      const a = resolveTimeSpec(spec("rolling_days", { days: n }), t)!;
      const b = resolveTimeSpec(spec("previous_rolling_days", { days: n }), t)!;
      expect(days(a.from, a.to)).toBe(n);
      expect(days(b.from, b.to)).toBe(n);
      expect(days(b.to, a.from)).toBe(2);
    }
  });
});

describe("parse do que vem do modelo", () => {
  it("aceita forma plana válida e normaliza campos ausentes para null", () => {
    expect(parseTimeSpec({ kind: "same_days_previous_month" })).toEqual(spec("same_days_previous_month"));
  });
  it("rejeita kind desconhecido, extent inválido e tipos errados", () => {
    expect(parseTimeSpec({ kind: "foo" })).toBeNull();
    expect(parseTimeSpec({ kind: "calendar_month", extent: "meio" })).toBeNull();
    expect(parseTimeSpec({ kind: "rolling_days", days: "7" })).toBeNull();
    expect(parseTimeSpec("este mês")).toBeNull();
  });
  it("o esquema estrito lista exatamente os tipos do vocabulário e exige todos os campos", () => {
    expect((TIME_SPEC_JSON_SCHEMA.properties.kind as any).enum).toEqual([...TIME_SPEC_KINDS]);
    expect(TIME_SPEC_JSON_SCHEMA.required.length).toBe(Object.keys(TIME_SPEC_JSON_SCHEMA.properties).length);
  });
});

describe("o contrato temporal V3 usa o spec do modelo e só cai no texto sem ele", () => {
  const now = new Date("2026-11-24T15:00:00Z");
  const expr = (value: string, s: TimeSpec | null) => ({ value, source: "current_turn" as const, source_span: value, spec: s });
  it("spec vence o texto (texto com erro de digitação que nenhuma regex lê)", () => {
    const g = resolvePeriodExpressionV3(expr("mês psasado até aogra", spec("same_days_previous_month")), now)!;
    expect(`${g.from}..${g.to}`).toBe("2026-10-01..2026-10-24");
    expect(g.resolved_by).toBe("time_spec");
  });
  it("sem spec, o caminho legado continua funcionando", () => {
    const g = resolvePeriodExpressionV3(expr("mês passado", null), now)!;
    expect(`${g.from}..${g.to}`).toBe("2026-10-01..2026-10-31");
    expect(g.resolved_by).toBe("legacy");
  });
  it("spec inválido cai no texto, nunca numa janela inventada", () => {
    const g = resolvePeriodExpressionV3(expr("mês passado", spec("named_month", { month: 13 })), now)!;
    expect(g.resolved_by).toBe("legacy");
    expect(g.from).toBe("2026-10-01");
  });
  it("turno de comparação: as duas janelas vêm do spec", () => {
    const turn: any = { kind: "task", tasks: [{ kind: "financial_query", family: "financial.query", metric: "expense_amount", operation: "compare", group_by: [], filters: [], limit: null,
      periods: [expr("esse mês até agora", spec("calendar_month", { offset: 0, extent: "to_date" })), expr("mesmo período do mês passado", spec("same_days_previous_month"))], comparison: null }] };
    const c = buildTemporalContractV3(turn, now);
    expect(c.ok).toBe(true);
    expect(c.periods.map((p) => `${p.from}..${p.to}`)).toEqual(["2026-11-01..2026-11-24", "2026-10-01..2026-10-24"]);
  });
});
