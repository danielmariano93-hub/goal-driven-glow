import { describe, expect, it } from "vitest";
import { canonicalMonthComparison, sameWindowComparison } from "../../supabase/functions/_shared/agent/core/SameWindowGuard";
import { comparisonHeader } from "../../supabase/functions/_shared/agent/core/ComparisonPresentation";

const nov = { from: "2026-11-01", to: "2026-11-18" }; // novembro até o dia 18
const outFull = { from: "2026-10-01", to: "2026-10-31" }; // outubro inteiro

describe("padrão seguro: mês atual aberto compara os mesmos dias, sem depender da frase", () => {
  const phrases = [
    "Nino, como estou esse mês comparado com o mesmo período do mês anterior ?",
    "e em relação ao mês passado, como tô indo?",
    "tô gastando mais ou menos que antes?",
    "Diminuíram onde? O que teve em outubro nesse período que não teve esse mês?",
    "compare com outubro",
  ];
  for (const p of phrases) {
    it(`qualquer redação: "${p.slice(0, 40)}…" → 01/10 a 18/10`, () => {
      expect(sameWindowComparison(p, nov, outFull)).toEqual({ from: "2026-10-01", to: "2026-10-18" });
    });
  }
  it("pedido explícito do mês fechado respeita outubro inteiro", () => {
    expect(sameWindowComparison("quanto gastei em outubro inteiro contra novembro?", nov, outFull)).toBeNull();
    expect(sameWindowComparison("compara com o mês anterior completo", nov, outFull)).toBeNull();
  });
  it("período atual já é um mês completo: nada a alinhar", () => {
    expect(sameWindowComparison("compare com o mês anterior", outFull, { from: "2026-09-01", to: "2026-09-30" })).toBeNull();
  });
  it("já alinhado ou outro mês que não o anterior: não mexe", () => {
    expect(sameWindowComparison("mês anterior", nov, { from: "2026-10-01", to: "2026-10-18" })).toBeNull();
    expect(sameWindowComparison("e em setembro?", nov, { from: "2026-09-01", to: "2026-09-30" })).toBeNull();
  });
  it("recorte que não começa no dia 1 e fim de mês curto (fevereiro)", () => {
    expect(sameWindowComparison("contra o mês anterior", { from: "2026-03-10", to: "2026-03-30" }, { from: "2026-02-01", to: "2026-02-28" }))
      .toEqual({ from: "2026-02-10", to: "2026-02-28" });
  });
  it("ano virando: janeiro contra dezembro", () => {
    expect(sameWindowComparison("e o mês passado?", { from: "2026-01-01", to: "2026-01-15" }, { from: "2025-12-01", to: "2025-12-31" }))
      .toEqual({ from: "2025-12-01", to: "2025-12-15" });
  });
  it("sem datas, não faz nada", () => {
    expect(sameWindowComparison("mês anterior", null, outFull)).toBeNull();
  });
});

describe("a resposta diz a suposição", () => {
  const r = (a: any, b: any) => ({ period_a: a, period_b: b, total_a: 100, total_b: 90, requested_group_by: "none" });
  it("avisa que comparou os mesmos dias", () => {
    const h = comparisonHeader(r({ from: "2026-10-01", to: "2026-10-18" }, nov)) ?? "";
    expect(h).toContain("Comparei os mesmos 18 dias");
  });
  it("meses inteiros não levam o aviso", () => {
    const h = comparisonHeader(r({ from: "2026-09-01", to: "2026-09-30" }, outFull)) ?? "";
    expect(h).not.toContain("Comparei os mesmos");
  });
});

describe("aviso quando os períodos comparados têm tamanhos muito diferentes", () => {
  const result = (a: any, b: any) => ({ period_a: a, period_b: b, total_a: 14518.05, total_b: 1931.62, requested_group_by: "none" });
  it("18 dias contra 31 dias avisa que a diferença pode estar exagerada", () => {
    const h = comparisonHeader(result(outFull, nov)) ?? "";
    expect(h).toContain("Os períodos não têm o mesmo tamanho");
    expect(h).toContain("18 dias");
    expect(h).toContain("31");
  });
  it("mesmo tamanho não avisa", () => {
    const h = comparisonHeader(result({ from: "2026-10-01", to: "2026-10-18" }, nov)) ?? "";
    expect(h).not.toContain("não têm o mesmo tamanho");
  });
  it("meses completos de 30 e 31 dias não disparam o aviso", () => {
    const h = comparisonHeader(result({ from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-31" })) ?? "";
    expect(h).not.toContain("não têm o mesmo tamanho");
  });
});

describe("propriedades da álgebra de períodos (todos os meses de 2024 a 2027)", () => {
  const days = (w: { from: string; to: string }) => (Date.parse(w.to) - Date.parse(w.from)) / 86400000 + 1;
  const last = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  it("recorte alinhado fica no mês anterior, nunca passa do fim dele e só encolhe quando o mês é mais curto", () => {
    for (let y = 2024; y <= 2027; y++) for (let m = 1; m <= 12; m++) for (let d = 1; d < last(y, m); d++) {
      const base = { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(d)}` };
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      const full = { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(last(py, pm))}` };
      const w = sameWindowComparison("compare com o mês anterior", base, full);
      // Mês anterior mais curto que o recorte: o mês inteiro já são "os mesmos dias", nada a corrigir.
      if (d >= last(py, pm)) { expect(w, `${base.to}`).toBeNull(); continue; }
      expect(w, `${base.to}`).not.toBeNull();
      expect(w!.from).toBe(full.from);
      expect(w!.to <= full.to).toBe(true);
      expect(days(w!)).toBe(Math.min(d, last(py, pm)));
    }
  });
});

describe("canonical adjacent-month comparisons are independent of model role order", () => {
  const current = { from: "2026-11-01", to: "2026-11-24" };
  const previous = { from: "2026-10-01", to: "2026-10-31" };
  const aligned = { from: "2026-10-01", to: "2026-10-24" };
  const requests = [
    "como estou esse mês comparado com o mesmo período do mês anterior",
    "ahn, como estou esse mês comparado com o mesmo período do mês anterior sabe",
    "tô gastando mais ou menos que no mês passado, até agora?",
  ];
  for (const request of requests) {
    it(`aligns roles in both semantic model orientations: ${request}`, () => {
      expect(canonicalMonthComparison(request, current, previous)).toEqual({
        base: current, comparison: aligned, reordered: false, aligned: true,
      });
      expect(canonicalMonthComparison(request, previous, current)).toEqual({
        base: current, comparison: aligned, reordered: true, aligned: true,
      });
    });
  }
  it("honors explicit closed-month comparison even when the roles are reversed", () => {
    expect(canonicalMonthComparison("compare novembro até hoje com outubro inteiro", previous, current)).toBeNull();
  });
  it("does not silently rewrite non-adjacent months or two completed months", () => {
    expect(canonicalMonthComparison("compare", { from: "2026-09-01", to: "2026-09-30" }, current)).toBeNull();
    expect(canonicalMonthComparison("compare", previous, { from: "2026-09-01", to: "2026-09-30" })).toBeNull();
  });
  it("holds across all months of 2024–2027, including year boundary", () => {
    for (let year = 2024; year <= 2027; year++) {
      for (let month = 1; month <= 12; month++) {
        const p = (n: number) => String(n).padStart(2, "0");
        const py = month === 1 ? year - 1 : year;
        const pm = month === 1 ? 12 : month - 1;
        const prevEnd = new Date(Date.UTC(py, pm, 0)).getUTCDate();
        const currEnd = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const currentWindow = { from: `${year}-${p(month)}-01`, to: `${year}-${p(month)}-${p(Math.min(15, currEnd - 1))}` };
        const fullPrevious = { from: `${py}-${p(pm)}-01`, to: `${py}-${p(pm)}-${p(prevEnd)}` };
        const a = canonicalMonthComparison("mesmo período do mês anterior", currentWindow, fullPrevious);
        const b = canonicalMonthComparison("mesmo período do mês anterior", fullPrevious, currentWindow);
        expect(a?.comparison, `${year}-${month}`).toEqual(b?.comparison);
        expect(a?.base).toEqual(b?.base);
      }
    }
  });
});
