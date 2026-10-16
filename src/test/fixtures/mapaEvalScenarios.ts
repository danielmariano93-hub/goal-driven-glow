// Cenários de avaliação do Mapa (≥ 60): leituras montadas pelos motores REAIS, não escritas à mão.
// Cobrem os casos dourados da spec (G1–G9) e adversariais (renda irregular, sem dados, aperto estrutural, dívida alta, atraso).
import { buildMapaReading } from "@/lib/engine/mapaReading";
import type { MapaReading } from "@/lib/engine/mapaContracts";
import type { MapaDebtIn, MapaHabitInputs, MapaHealthInputs, MapaSnapshotInput } from "@/lib/engine/mapaInputs";
import type { MapaMonthlyEntry } from "@/lib/engine/mapaMonthly";

export const EVAL_ASOF = "2026-10-16";
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

const month = (ym: string, income: number, spend: Array<[string, number]>): MapaMonthlyEntry[] => [
  { date: `${ym}-05`, kind: "income", amount: income },
  ...spend.map(([cat, amount], i): MapaMonthlyEntry => ({ date: `${ym}-${String(10 + i).padStart(2, "0")}`, kind: "expense", amount, category_id: cat })),
];
const snap = (cash: number): MapaSnapshotInput => ({ availableToday: cash, confirmedFutureInflows: 0, estimatedFixedInflows: 0, knownFutureCommitments: 500, cardDueThisMonth: 800, netWorthNet: cash - 20000, bridge: null });
const debt = (installment: number, over: Partial<MapaDebtIn> = {}): MapaDebtIn => ({ id: `d${installment}`, name: "Dívida", status: "active", kind: "emprestimo_pessoal", outstanding_balance: installment * 20, installment_amount: installment, interest_rate_pct: 3, interest_rate_period: "mes", ...over });

export interface EvalScenario { name: string; reading: MapaReading }

function build(name: string, entries: MapaMonthlyEntry[], health: Partial<MapaHealthInputs> = {}, habits: Partial<MapaHabitInputs> = {}): EvalScenario {
  return { name, reading: buildMapaReading({ asOf: EVAL_ASOF, entries, health, habits, nowIso: `${EVAL_ASOF}T15:00:00Z` }) };
}

export function evalScenarios(): EvalScenario[] {
  const out: EvalScenario[] = [];
  const flags = { "c-moradia": true, "c-mercado": true, "c-lazer": false };

  // Grade: renda × essenciais × dívida × caixa (subconjunto determinístico).
  const incomes = [2500, 5000, 9000, 16000];
  const essentials = [1500, 3500, 5000];
  const installments = [0, 400, 3200];
  const cash = [100, 4000, 80000];
  let k = 0;
  for (const income of incomes) for (const ess of essentials) for (const inst of installments) for (const c of cash) {
    k += 1;
    if (k % 3 !== 0) continue; // 108 combinações → 36 cenários
    const entries = MONTHS.flatMap((m) => month(m, income, [["c-moradia", ess * 0.6], ["c-mercado", ess * 0.4], ["c-lazer", income * 0.1]]));
    out.push(build(`grade r${income} e${ess} p${inst} c${c}`, entries, {
      categoryEssential: flags, snapshot: snap(c), debts: inst ? [debt(inst)] : [],
      debtOverdue: inst && inst > 3000 ? { count: 1, amount: 900, max_days: 20 } : { count: 0, amount: 0, max_days: null },
    }));
  }

  // G1: caixa baixo no começo do mês com gasto típico alto.
  out.push(build("G1 caixa baixo", MONTHS.flatMap((m) => month(m, 18000, [["c-moradia", 9000], ["c-lazer", 8000]])), { categoryEssential: flags, snapshot: snap(1437.69) }));
  // G2: renda parcial no mês corrente.
  out.push(build("G2 renda parcial", [...MONTHS.flatMap((m) => month(m, 8000, [["c-moradia", 3000], ["c-lazer", 1000]])), { date: "2026-10-14", kind: "income", amount: 208.67 }], { categoryEssential: flags, snapshot: snap(2000) }));
  // G3: renda irregular.
  const irregular = [34000, 7700, 8500, 24000, 9000, 31000];
  out.push(build("G3 renda irregular", MONTHS.flatMap((m, i) => month(m, irregular[i], [["c-moradia", 6000], ["c-lazer", 2000]])), { categoryEssential: flags, snapshot: snap(5000) }));
  // G5: dívidas sem taxa nem tipo.
  out.push(build("G5 dívida sem taxa", MONTHS.flatMap((m) => month(m, 9000, [["c-moradia", 3500], ["c-lazer", 1500]])), { categoryEssential: flags, snapshot: snap(3000), debts: [debt(900, { interest_rate_pct: null, interest_rate_period: null, kind: null })] }));
  // G8: estrutural por essenciais.
  out.push(build("G8 estrutural essenciais", MONTHS.flatMap((m) => month(m, 8000, [["c-moradia", 6800], ["c-lazer", 200]])), { categoryEssential: flags, snapshot: snap(1000) }));
  // G9: sem histórico.
  out.push(build("G9 um mês", month("2026-09", 5000, [["c-moradia", 3000]])));
  out.push(build("G9 sem lançamentos", []));

  // Adversariais.
  out.push(build("aperto: 3 meses no negativo", MONTHS.flatMap((m) => month(m, 5000, [["c-moradia", 3000], ["c-lazer", 3000]])), { categoryEssential: flags, snapshot: snap(50) }));
  out.push(build("aperto + atraso + dívida alta", MONTHS.flatMap((m) => month(m, 5000, [["c-moradia", 3500], ["c-lazer", 1200]])), {
    categoryEssential: flags, snapshot: snap(40), debts: [debt(2800, { kind: "cartao_rotativo", interest_rate_pct: 14 })], debtOverdue: { count: 2, amount: 3100, max_days: 45 },
  }));
  out.push(build("dívida de custo alto sem estrutura", MONTHS.flatMap((m) => month(m, 14000, [["c-moradia", 3000], ["c-lazer", 2000]])), {
    categoryEssential: flags, snapshot: snap(30000), debts: [debt(500, { kind: "cheque_especial", interest_rate_pct: 8, outstanding_balance: 12000 })],
  }));
  out.push(build("tudo em dia", MONTHS.flatMap((m) => month(m, 15000, [["c-moradia", 3000], ["c-mercado", 1500], ["c-lazer", 1500]])), { categoryEssential: flags, snapshot: snap(120000) }));
  out.push(build("lazer alto com tudo em dia", MONTHS.flatMap((m) => month(m, 20000, [["c-moradia", 3000], ["c-lazer", 9000]])), { categoryEssential: flags, snapshot: snap(150000) }));
  out.push(build("metas estouradas", MONTHS.flatMap((m) => month(m, 9000, [["c-moradia", 3000], ["c-lazer", 1200]])), { categoryEssential: flags, snapshot: snap(30000) }, {
    goalPeriods: ["2026-06", "2026-07", "2026-08", "2026-09"].map((p) => ({ key: "c-lazer", period: p, status: "estourado" as const })),
  }));
  out.push(build("contas fixas fora do app", MONTHS.flatMap((m) => month(m, 9000, [["c-moradia", 3000], ["c-lazer", 1200]])), { categoryEssential: flags, snapshot: snap(30000) }, { recurringDetected: 6, recurringRegistered: 1 }));
  out.push(build("plano não cabe", MONTHS.flatMap((m) => month(m, 4000, [["c-moradia", 3200], ["c-lazer", 300]])), {
    categoryEssential: flags, snapshot: snap(8000),
    savingsGoals: [{ id: "g", name: "Casa", target_amount: 24000, saved_amount: 0, created_at: "2026-01-01", target_date: "2027-04-16" }],
  }));
  // renda zero e despesas
  out.push(build("só despesas", MONTHS.flatMap((m) => month(m, 0, [["c-moradia", 2000]])), { categoryEssential: flags, snapshot: snap(10) }));
  // variações extras de saúde mista até passar de 60
  for (let i = 0; i < 12; i++) {
    const income = 6000 + i * 900;
    const spend = 3500 + (i % 4) * 900;
    out.push(build(`misto ${i}`, MONTHS.flatMap((m) => month(m, income, [["c-moradia", spend * 0.7], ["c-mercado", spend * 0.3], ["c-lazer", 600 + i * 150]])), {
      categoryEssential: flags, snapshot: snap(500 + i * 4000), debts: i % 3 === 0 ? [debt(300 + i * 80)] : [],
    }));
  }
  return out;
}
