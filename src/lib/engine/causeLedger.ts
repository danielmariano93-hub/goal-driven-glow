// Livro de causas (`cause_ledger.v1`): por que o caixa livre do mês está diferente do normal dele.
// Puro e determinístico. Entrada: lançamentos canônicos já classificados por natureza (sem consulta nova);
// saída: decomposição por identidade contábil (a soma dos efeitos fecha com a variação), mecanismo por regra,
// resíduo declarado e confiança. Nunca afirma intenção: só fato e associação (hipótese de comportamento é pergunta).
import { round2 } from "./facts";

export const CAUSE_LEDGER_VERSION = "cause_ledger.v1";

/** Natureza do lançamento. `antecipacao` é liquidação de parcelas futuras (timing), `desconhecida` vira resíduo. */
export type CauseClass = "fixa" | "parcela_cartao" | "variavel" | "pontual" | "antecipacao" | "desconhecida";

export interface CauseEntry {
  kind: "income" | "expense";
  /** Despesa: consumo (estorno negativo). Receita: valor positivo. */
  amount: number;
  class: CauseClass;
}

export interface CauseMonth {
  month: string; // YYYY-MM
  income: number;
  fixa: number;
  parcela_cartao: number;
  variavel: number;
  pontual: number;
  antecipacao: number;
  desconhecida: number;
}

export type CauseDriverKey = "renda" | CauseClass;
export type CauseNature = "structural" | "behavioral" | "timing" | "unknown";
export type CauseMechanism = "estavel" | "renda" | "compromissos" | "comportamento" | "pontual" | "calendario" | "indefinido";

export interface CauseDriver {
  key: CauseDriverKey;
  label: string;
  nature: CauseNature;
  current: number;
  baseline: number;
  /** Efeito no caixa livre: positivo melhora, negativo piora. */
  effect: number;
  share_of_delta: number | null;
}

export interface CauseLedger {
  version: typeof CAUSE_LEDGER_VERSION;
  month: string;
  baseline_months: string[];
  free_cash_current: number;
  free_cash_baseline: number;
  delta: number;
  drivers: CauseDriver[];
  /** Parte da variação não explicada por natureza conhecida (lançamentos sem classificação + arredondamento). */
  residual: number;
  residual_share: number | null;
  mechanism: CauseMechanism;
  /** Driver que mais pesa contra o caixa (ou null se estável). */
  main_driver: CauseDriverKey | null;
  confidence: "alta" | "media" | "baixa";
  reasons: string[];
}

const EXPENSE_CLASSES: CauseClass[] = ["fixa", "parcela_cartao", "variavel", "pontual", "antecipacao", "desconhecida"];
const LABEL: Record<CauseDriverKey, string> = {
  renda: "Renda",
  fixa: "Gastos fixos",
  parcela_cartao: "Parcelas de cartão",
  variavel: "Gastos variáveis",
  pontual: "Gastos pontuais",
  antecipacao: "Antecipação de parcelas",
  desconhecida: "Sem classificação",
};
const NATURE: Record<CauseDriverKey, CauseNature> = {
  renda: "structural",
  fixa: "structural",
  parcela_cartao: "structural",
  variavel: "behavioral",
  pontual: "unknown",
  antecipacao: "timing",
  desconhecida: "unknown",
};

export function buildCauseMonth(month: string, entries: CauseEntry[]): CauseMonth {
  const m: CauseMonth = { month, income: 0, fixa: 0, parcela_cartao: 0, variavel: 0, pontual: 0, antecipacao: 0, desconhecida: 0 };
  for (const e of entries) {
    if (e.kind === "income") m.income += e.amount;
    else m[e.class] += e.amount;
  }
  for (const k of ["income", ...EXPENSE_CLASSES] as const) m[k] = round2(m[k]);
  return m;
}

const freeCash = (m: CauseMonth) => round2(m.income - EXPENSE_CLASSES.reduce((s, k) => s + m[k], 0));

/** Mediana com 3+ meses (um mês atípico, como a renda extraordinária, não vira "normal"); média com menos. */
function center(values: number[]): number {
  if (!values.length) return 0;
  if (values.length < 3) return round2(values.reduce((s, v) => s + v, 0) / values.length);
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round2(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

export function computeCauseLedger(current: CauseMonth, baseline: CauseMonth[]): CauseLedger {
  const reasons: string[] = [];
  const base = {} as Record<CauseDriverKey, number>;
  base.renda = center(baseline.map((m) => m.income));
  for (const k of EXPENSE_CLASSES) base[k] = center(baseline.map((m) => m[k]));

  const baselineFree = round2(base.renda - EXPENSE_CLASSES.reduce((s, k) => s + base[k], 0));
  const currentFree = freeCash(current);
  const delta = round2(currentFree - baselineFree);

  const drivers: CauseDriver[] = (["renda", ...EXPENSE_CLASSES] as CauseDriverKey[]).map((key) => {
    const cur = key === "renda" ? current.income : current[key];
    const effect = round2(key === "renda" ? cur - base[key] : -(cur - base[key]));
    return { key, label: LABEL[key], nature: NATURE[key], current: cur, baseline: base[key], effect, share_of_delta: null };
  });
  // Identidade: a soma dos efeitos é a variação. A diferença só pode ser arredondamento; o que não tem natureza conhecida
  // (lançamentos sem classificação) é declarado como resíduo.
  const explained = round2(drivers.filter((d) => d.key !== "desconhecida").reduce((s, d) => s + d.effect, 0));
  const unknown = drivers.find((d) => d.key === "desconhecida")!;
  const residual = round2(delta - explained);
  for (const d of drivers) d.share_of_delta = delta === 0 ? null : round2(d.effect / delta);
  const kept = drivers.filter((d) => Math.abs(d.effect) >= 0.01 || d.key === "renda").sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  const residualShare = delta === 0 ? null : round2(Math.abs(residual) / Math.abs(delta));

  const tolerance = Math.max(100, Math.abs(baselineFree) * 0.05, base.renda * 0.03);
  const worst = [...drivers].filter((d) => d.key !== "desconhecida").sort((a, b) => a.effect - b.effect)[0];

  let mechanism: CauseMechanism = "estavel";
  let main: CauseDriverKey | null = null;
  if (Math.abs(delta) >= tolerance && delta < 0) {
    main = worst.effect < 0 ? worst.key : null;
    if (!main) mechanism = "indefinido";
    else if (main === "renda") mechanism = "renda";
    else if (main === "fixa" || main === "parcela_cartao") mechanism = "compromissos";
    else if (main === "variavel") mechanism = "comportamento";
    else if (main === "pontual") mechanism = "pontual";
    else if (main === "antecipacao") mechanism = "calendario";
    else mechanism = "indefinido";
  }

  if (baseline.length < 2) reasons.push("poucos_meses_de_comparacao");
  if (unknown.current > 0 && current.income + freeCash(current) !== 0 && unknown.current / Math.max(1, current.income) > 0.2) reasons.push("muito_gasto_sem_classificacao");
  if (residualShare !== null && residualShare > 0.2) reasons.push("residual_alto");
  const confidence: CauseLedger["confidence"] = reasons.length === 0 && baseline.length >= 3 ? "alta" : reasons.length <= 1 && baseline.length >= 2 ? "media" : "baixa";

  return {
    version: CAUSE_LEDGER_VERSION,
    month: current.month,
    baseline_months: baseline.map((m) => m.month),
    free_cash_current: currentFree,
    free_cash_baseline: baselineFree,
    delta,
    drivers: kept,
    residual,
    residual_share: residualShare,
    mechanism,
    main_driver: main,
    confidence,
    reasons,
  };
}
