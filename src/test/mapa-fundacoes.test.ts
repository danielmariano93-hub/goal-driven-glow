import { describe, it, expect } from "vitest";
import { buildMapaReading } from "@/lib/engine/mapaReading";
import { aggregateMonths, mapaAddMonths, type MapaMonthlyEntry } from "@/lib/engine/mapaMonthly";
import { classifyRegularity, computeIncomeBaseline } from "@/lib/engine/mapaIncomeBaseline";
import { computeDataQuality } from "@/lib/engine/mapaDataQuality";
import { MAPA_CONTRACT, validateMapaReading, type MapaIndicator, type MapaReading } from "@/lib/engine/mapaContracts";

const ASOF = "2026-10-16";
const e = (date: string, kind: "income" | "expense", amount: number): MapaMonthlyEntry => ({ date, kind, amount });
/** Um mês com uma renda e um gasto. */
const month = (ym: string, income: number, spend: number): MapaMonthlyEntry[] => [e(`${ym}-05`, "income", income), e(`${ym}-10`, "expense", spend)];

describe("agregação mensal do ledger", () => {
  it("separa mês fechado do corrente e preenche lacunas dentro do período de uso", () => {
    const entries = [...month("2026-07", 1000, 600), ...month("2026-09", 1200, 700), e("2026-10-02", "income", 50)];
    const m = aggregateMonths(entries, ASOF);
    expect(m.map((x) => [x.month, x.closed, x.entries])).toEqual([["2026-07", true, 2], ["2026-08", true, 0], ["2026-09", true, 2], ["2026-10", false, 1]]);
    expect(m[3].income).toBe(50);
  });
  it("estorno (despesa negativa) abate o consumo do mês", () => {
    const m = aggregateMonths([e("2026-09-03", "expense", 500), e("2026-09-04", "expense", -120)], ASOF);
    expect(m[0].consumption).toBe(380);
  });
  it("sem lançamentos, sem meses", () => expect(aggregateMonths([], ASOF)).toEqual([]));
  it("soma de meses cruza o ano", () => expect(mapaAddMonths("2026-12", 1)).toBe("2027-01"));
});

describe("E1 renda típica", () => {
  it("G3 — renda do dono (jun a set) é irregular, mediana ≈ 16,4 mil; outubro parcial fica fora", () => {
    const entries = [
      ...month("2026-06", 34455.79, 36608.11), ...month("2026-07", 7720.9, 22490.61),
      ...month("2026-08", 8526.59, 15303.48), ...month("2026-09", 24355.3, 15859.45),
      e("2026-10-14", "income", 208.67),
    ];
    const r = buildMapaReading({ asOf: ASOF, entries });
    expect(r.income.months_used).toBe(4);
    expect(r.income.regularity).toBe("irregular");
    expect(r.income.typical).toBeCloseTo((8526.59 + 24355.3) / 2, 1);
    expect(r.income.cv).toBeGreaterThan(0.6);
    expect(r.income.mtd_received).toBe(208.67);
    expect(r.income.confidence).toBe("moderada");
  });

  it("renda estável é regular; confiança alta com 6 meses", () => {
    const entries = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].flatMap((m, i) => month(m, 5000 + i * 20, 3000));
    const r = buildMapaReading({ asOf: ASOF, entries });
    expect(r.income.regularity).toBe("regular");
    expect(r.income.confidence).toBe("alta");
  });

  it("G9 — um mês de dados: sem renda típica e nunca completa com o mês parcial", () => {
    const r = buildMapaReading({ asOf: ASOF, entries: [...month("2026-09", 5000, 2000), e("2026-10-03", "income", 9999)] });
    expect(r.income.typical).toBeNull();
    expect(r.income.regularity).toBe("insuficiente");
    expect(r.income.reasons).toContain("poucos_meses_fechados");
    expect(r.income.mtd_received).toBe(9999);
  });

  it("mês fechado com zero de renda conta (renda irregular de verdade), mas mês sem nenhum registro não", () => {
    const entries = [...month("2026-06", 6000, 3000), e("2026-07-10", "expense", 2500), ...month("2026-09", 6000, 3000), ...month("2026-08", 6000, 3000)];
    const r = buildMapaReading({ asOf: ASOF, entries });
    expect(r.income.months_used).toBe(4);
    expect(r.income.typical).toBe(6000);
    expect(r.income.regularity).not.toBe("regular");
  });

  it("classificação por coeficiente de variação", () => {
    expect(classifyRegularity(0.1)).toBe("regular");
    expect(classifyRegularity(0.4)).toBe("variavel");
    expect(classifyRegularity(0.9)).toBe("irregular");
    expect(classifyRegularity(null)).toBe("insuficiente");
  });

  it("sem renda registrada nos meses fechados não inventa regularidade", () => {
    const entries = ["2026-07", "2026-08", "2026-09"].map((m) => e(`${m}-10`, "expense", 100));
    const base = computeIncomeBaseline(aggregateMonths(entries, ASOF));
    expect(base.typical).toBe(0);
    expect(base.reasons).toContain("sem_renda_registrada");
    expect(base.regularity).toBe("insuficiente");
  });
});

describe("E0 qualidade dos dados", () => {
  it("sem dados bloqueia tudo", () => {
    const q = computeDataQuality({ asOf: ASOF, entries: [], months: [] });
    expect(q.flags).toEqual(["sem_dados"]);
    expect(Object.values(q.eligibility).every((v) => v === "bloqueado")).toBe(true);
  });

  it("1 mês fechado: razões e tendências bloqueadas", () => {
    const entries = month("2026-09", 5000, 2000);
    const q = computeDataQuality({ asOf: ASOF, entries, months: aggregateMonths(entries, ASOF) });
    expect(q.eligibility.razoes_de_renda).toBe("bloqueado");
    expect(q.eligibility.tendencias).toBe("bloqueado");
    expect(q.flags).toContain("poucos_meses_fechados");
  });

  it("3 meses seguidos: razões ok, tendências ainda bloqueadas; 4: tendências ok", () => {
    const three = ["2026-07", "2026-08", "2026-09"].flatMap((m) => month(m, 5000, 3000));
    const q3 = computeDataQuality({ asOf: ASOF, entries: three, months: aggregateMonths(three, ASOF) });
    expect(q3.eligibility.razoes_de_renda).toBe("ok");
    expect(q3.eligibility.tendencias).toBe("bloqueado");
    const four = [...month("2026-06", 5000, 3000), ...three];
    const q4 = computeDataQuality({ asOf: ASOF, entries: four, months: aggregateMonths(four, ASOF) });
    expect(q4.eligibility.tendencias).toBe("ok");
  });

  it("lacuna de mês, lançamento antigo, sync atrasado e conciliação divergente viram sinais e rebaixam a elegibilidade", () => {
    const entries = [...month("2026-05", 5000, 3000), ...month("2026-07", 5000, 3000), ...month("2026-08", 5000, 3000), ...month("2026-09", 5000, 3000)];
    const months = aggregateMonths(entries, ASOF);
    const q = computeDataQuality({ asOf: ASOF, entries, months, lastSyncAgeDays: 12, reconciliationDifference: -300 });
    expect(q.gap_months).toBe(1);
    expect(q.flags).toEqual(expect.arrayContaining(["meses_sem_registro", "sem_lancamentos_recentes", "sync_desatualizado", "conciliacao_divergente"]));
    expect(q.eligibility.razoes_de_renda).toBe("parcial");
    expect(q.eligibility.caixa).toBe("parcial");
    expect(q.eligibility.recencia).toBe("parcial");
  });
});

describe("contrato mapa_financeiro.v1", () => {
  it("a leitura montada é válida e traz a versão do contrato", () => {
    const r = buildMapaReading({ asOf: ASOF, entries: month("2026-09", 5000, 3000) });
    expect(r.contract).toBe(MAPA_CONTRACT);
    expect(validateMapaReading(r)).toEqual([]);
  });

  const ind = (over: Partial<MapaIndicator>): MapaIndicator => ({
    id: "seguranca.meses_cobertos", pillar: "seguranca", layer: "saude", value: 1.2, unit: "meses", direction: "higher_better",
    status: "atencao", confidence: "moderada", window: { start: "2026-07-01", end: "2026-09-30", kind: "meses_fechados", n: 3 },
    evidence: ["ledger"], inputs: { numerador: 100, denominador: 80 }, reasons: [], formula_version: "t.v1", ...over,
  });
  const withInd = (i: MapaIndicator): MapaReading => ({ ...buildMapaReading({ asOf: ASOF, entries: [] }), indicators: [i] });

  it.each([
    ["valor nulo sem status sem_dados", ind({ value: null }), "value_status_mismatch"],
    ["sem_dados com valor", ind({ status: "sem_dados" }), "value_status_mismatch"],
    ["status com confiança insuficiente", ind({ confidence: "insuficiente" }), "confidence_insufficient_with_status"],
    ["NaN no valor", ind({ value: Number.NaN }), "non_finite_value"],
    ["Infinity num insumo", ind({ inputs: { x: Number.POSITIVE_INFINITY } }), "non_finite_input:x"],
    ["id fora do pilar", ind({ id: "dividas.algo" }), "id_not_prefixed_by_pillar"],
    ["sem_dados sem motivo", ind({ value: null, status: "sem_dados" }), "sem_dados_without_reason"],
  ])("rejeita: %s", (_n, i, code) => {
    expect(validateMapaReading(withInd(i)).join(" ")).toContain(code);
  });

  it("aceita sem_dados com motivo e com 'needs'", () => {
    expect(validateMapaReading(withInd(ind({ value: null, status: "sem_dados", confidence: "insuficiente", reasons: ["essential_flag_missing"] })))).toEqual([]);
    expect(validateMapaReading(withInd(ind({ value: null, status: "sem_dados", confidence: "insuficiente", needs: { kind: "capture", code: "debt_rate" } })))).toEqual([]);
  });

  it("a direção da mudança respeita o sentido favorável (dívida que cai melhorou)", () => {
    const debt = ind({ id: "dividas.comprometimento_renda", pillar: "dividas", direction: "lower_better", change: { previous: 40, delta: -9, direction: "piorou", comparable: true } });
    expect(validateMapaReading(withInd(debt)).join(" ")).toContain("change_direction_wrong");
    const ok = ind({ id: "dividas.comprometimento_renda", pillar: "dividas", direction: "lower_better", change: { previous: 40, delta: -9, direction: "melhorou", comparable: true } });
    expect(validateMapaReading(withInd(ok))).toEqual([]);
  });
});
