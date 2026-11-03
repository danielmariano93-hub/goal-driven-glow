import { describe, expect, it } from "vitest";
import { buildGoalHistory, type HistoryGoalRow } from "@/lib/engine/goalHistory";
import { buildSpendingLedger, type SpendingLedgerTx } from "@/lib/engine/spendingGoals";

const T = "c-transp", A = "c-alim", S = "c-assin", L = "c-lazer", V = "c-serv", M = "c-mercado", H = "c-moradia", O = "c-outros";
const categories = [
  { id: T, name: "Transporte" }, { id: A, name: "Alimentação" }, { id: S, name: "Assinaturas" }, { id: L, name: "Lazer" },
  { id: V, name: "Serviços" }, { id: M, name: "Mercado" }, { id: H, name: "Moradia" }, { id: O, name: "Outros" },
];
let seq = 0;
const tx = (month: string, amount: number, category_id: string, merchant = "x", day = "10"): SpendingLedgerTx => ({
  id: `v${++seq}`, account_id: "a", category_id, type: "expense", status: "confirmed", amount, occurred_at: `${month}-${day}`,
  description: merchant, merchant_name: merchant, transfer_group_id: null, movement_kind: "transaction",
} as SpendingLedgerTx);
const monthly = (cat: string, values: Record<string, number>, merchant = "x") =>
  Object.entries(values).flatMap(([m, v]) => [tx(m, v / 2, cat, merchant, "05"), tx(m, v / 2, cat, merchant, "20")]);
const goal = (id: string, category_id: string, start: string, baseline: number): HistoryGoalRow => ({
  id, category_id, computed_limit: baseline * 0.9, baseline_value: baseline, status: "active",
  period_type: "monthly_recurring", start_date: start, end_date: null, created_at: start,
});

// Números do caso real (maio–outubro/2026), metas: Transporte e Alimentação desde setembro; Assinaturas e Lazer desde outubro.
const rows = [
  ...monthly(T, { "2026-06": 1707, "2026-07": 1682, "2026-08": 2160, "2026-09": 2257, "2026-10": 2132 }),
  ...monthly(A, { "2026-06": 1368, "2026-07": 1405, "2026-08": 1317, "2026-09": 671, "2026-10": 955 }),
  ...monthly(S, { "2026-07": 2625, "2026-08": 1500, "2026-09": 1619, "2026-10": 613 }),
  ...monthly(L, { "2026-07": 2227, "2026-08": 1550, "2026-09": 2248, "2026-10": 1341 }),
  ...monthly(V, { "2026-05": 600, "2026-06": 900, "2026-07": 800, "2026-08": 700, "2026-09": 850, "2026-10": 900 }, "JIM"),
  ...monthly(M, { "2026-05": 300, "2026-06": 320, "2026-07": 310, "2026-08": 330, "2026-09": 420, "2026-10": 600 }),
  ...monthly(H, { "2026-05": 5000, "2026-06": 5000, "2026-07": 5000, "2026-08": 5000, "2026-09": 5000, "2026-10": 5000 }),
  ...monthly(O, { "2026-07": 500, "2026-08": 500, "2026-09": 500, "2026-10": 500 }),
];
const goals = [goal("gt", T, "2026-09-01", 1850), goal("ga", A, "2026-09-01", 1363), goal("gs", S, "2026-10-01", 1915), goal("gl", L, "2026-10-01", 2008)];
const hist = (g = goals, r = rows, today = "2026-11-03") => buildGoalHistory({ today, goals: g, entries: buildSpendingLedger(r), categories });

describe("veredito: ter meta está fazendo sentido?", () => {
  const v = hist().verdict!;
  it("caso real: as categorias com meta caíram, mas o gasto total quase não mudou → em parte (e diz isso)", () => {
    expect(v.verdict).toBe("parcial");
    expect(v.headline).toMatch(/^Em parte: caiu nas categorias com meta, mas o seu gasto total quase não mudou/);
    expect(v.summary).toMatch(/aparece(u|ram) em outras categorias/);
  });
  it("quando o gasto variável total também cai, o veredito é sim", () => {
    const clean = [
      ...monthly(T, { "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 1500, "2026-10": 1500 }),
      ...monthly(A, { "2026-06": 1000, "2026-07": 1000, "2026-08": 1000, "2026-09": 700, "2026-10": 700 }),
      ...monthly(V, { "2026-06": 700, "2026-07": 700, "2026-08": 700, "2026-09": 700, "2026-10": 700 }),
    ];
    const vs = hist([goal("g1", T, "2026-09-01", 2000), goal("g2", A, "2026-09-01", 1000)], clean).verdict!;
    expect(vs.verdict).toBe("sim");
    expect(vs.headline).toBe("Sim: ter metas está fazendo sentido.");
    expect(vs.summary).toMatch(/gasto variável total também caiu/);
  });
  it("números do caso real", () => {
    expect(v.helped).toBe(3);
    expect(v.hurt).toBe(1);
    // líquido: (1850−2194,5) + (1363−813) + (1915−613) + (2008−1341,5)
    expect(v.net_monthly).toBeCloseTo(2174.5, 0);
    expect(v.net_pct).toBeCloseTo(-0.30, 2);
    expect(v.total_avoided).toBeCloseTo(2380, 0);
    expect(v.by_category.find((c) => c.category_id === T)!.status).toBe("nao_ajudou");
    expect(v.by_category.find((c) => c.category_id === A)!.status).toBe("ajudou");
  });
  it("o líquido NÃO é só o que caiu (o app antigo somava só as categorias que caíram)", () => {
    const grossReduced = v.by_category.filter((c) => (c.delta_month ?? 0) > 0).reduce((a, c) => a + (c.delta_month ?? 0), 0);
    expect(v.net_monthly!).toBeLessThan(grossReduced);
  });
  it("confiança vem do número de meses, não do valor", () => {
    expect(v.closed_goal_months).toBe(6);
    expect(v.confidence).toBe("media");
    expect(v.by_category.find((c) => c.category_id === S)!.confidence).toBe("baixa"); // 1 mês
    expect(v.by_category.find((c) => c.category_id === A)!.confidence).toBe("media"); // 2 meses
  });
  it("avisa quando o resultado depende de uma categoria só", () => {
    expect(v.caveats.some((c) => /Mais da metade do ganho vem de Assinaturas/.test(c))).toBe(true);
  });
  it("compara com o gasto variável total (evitado numa categoria não é, sozinho, dinheiro guardado)", () => {
    expect(v.variable_total).not.toBeNull();
    // o variável total (Serviços e Mercado subiram) caiu menos que o ganho líquido
    expect(v.variable_total!.before_avg - v.variable_total!.after_avg).toBeLessThan(v.net_monthly! * 0.5);
  });
  it("sem meses fechados com meta: cedo demais, sem número inventado", () => {
    const v0 = hist([goal("g", T, "2026-11-01", 1850)]).verdict!;
    expect(v0.verdict).toBe("cedo");
    expect(v0.net_monthly).toBeNull();
    expect(v0.summary).toMatch(/pelo menos 2 meses/);
  });
  it("um único mês fechado também é cedo demais", () => {
    const v1 = hist([goal("g", T, "2026-10-01", 1850)]).verdict!;
    expect(v1.verdict).toBe("cedo");
  });
  it("gasto subiu no conjunto: 'Por enquanto, não.' (sem esconder)", () => {
    const worse = [
      ...monthly(T, { "2026-06": 1000, "2026-07": 1000, "2026-08": 1000, "2026-09": 1400, "2026-10": 1500 }),
      ...monthly(V, { "2026-06": 500, "2026-07": 500, "2026-08": 500, "2026-09": 500, "2026-10": 500 }),
    ];
    const vw = hist([goal("g", T, "2026-09-01", 1000)], worse).verdict!;
    expect(vw.verdict).toBe("nao");
    expect(vw.headline).toBe("Por enquanto, não.");
    expect(vw.net_monthly!).toBeLessThan(0);
  });
  it("praticamente igual: não dá para ver efeito", () => {
    const flat = monthly(T, { "2026-06": 1000, "2026-07": 1000, "2026-08": 1000, "2026-09": 1010, "2026-10": 990 });
    const vf = hist([goal("g", T, "2026-09-01", 1000)], flat).verdict!;
    expect(vf.verdict).toBe("nao");
    expect(vf.headline).toBe("Por enquanto, não dá para ver efeito.");
  });
  it("quando o resto dos gastos caiu junto, avisa e rebaixa a confiança", () => {
    const together = [
      ...monthly(T, { "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 1200, "2026-10": 1200 }),
      ...monthly(V, { "2026-06": 2000, "2026-07": 2000, "2026-08": 2000, "2026-09": 1200, "2026-10": 1200 }),
    ];
    const vt = hist([goal("g", T, "2026-09-01", 2000)], together).verdict!;
    expect(vt.caveats.some((c) => /também caíram/.test(c))).toBe(true);
    expect(vt.confidence).toBe("baixa");
  });
});

describe("categorias que merecem uma meta", () => {
  const c = hist().candidates!;
  const names = c.map((x) => x.category_name);
  it("só categorias sem meta, de consumo livre", () => {
    expect(names).toContain("Serviços");
    for (const n of ["Transporte", "Alimentação", "Assinaturas", "Lazer"]) expect(names).not.toContain(n); // já têm meta
    for (const n of ["Moradia", "Outros"]) expect(names).not.toContain(n); // obrigação / não classificado
  });
  it("essencial (Mercado) só entra se estiver subindo — e diz que subiu", () => {
    const m = c.find((x) => x.category_name === "Mercado");
    expect(m).toBeTruthy();
    expect(m!.trend_pct!).toBeGreaterThanOrEqual(0.2);
    expect(m!.reasons.some((r) => /Subiu/.test(r))).toBe(true);
    const calm = hist(goals, rows.filter((r) => r.category_id !== M).concat(monthly(M, { "2026-05": 300, "2026-06": 300, "2026-07": 300, "2026-08": 300, "2026-09": 300, "2026-10": 300 }))).candidates!;
    expect(calm.map((x) => x.category_name)).not.toContain("Mercado");
  });
  it("traz o porquê em frases, o teto sugerido e o ganho possível", () => {
    const s = c.find((x) => x.category_name === "Serviços")!;
    expect(s.reasons[0]).toMatch(/Média de .* por mês, \d+% do seu gasto variável/);
    expect(s.recommended_limit).toBeGreaterThan(0);
    expect(s.recommended_limit).toBeLessThanOrEqual(s.avg_month);
    expect(s.potential_month).toBeGreaterThanOrEqual(0);
  });
  it("com menos de 3 meses de dados não sugere nada", () => {
    const few = monthly(V, { "2026-09": 800, "2026-10": 900 });
    expect(hist([], few).candidates).toEqual([]);
  });
});
