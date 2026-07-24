import { behavioralMetricAmount, type TransactionRow } from "@/lib/engine/facts";

export interface ReportTxn {
  id?: string;
  account_id?: string;
  type: "income" | "expense" | "transfer";
  status: "confirmed" | "planned";
  amount: number;
  occurred_at: string; // YYYY-MM-DD
  category_id?: string | null;
  category_name?: string | null;
  transfer_group_id?: string | null;
  payment_method?: string | null;
  credit_card_id?: string | null;
  settles_card_id?: string | null;
  movement_kind?: string | null;
}

export interface CategoryBucket {
  category: string;
  total: number;
  count: number;
  average: number;
  percentOfExpenses: number;
  rank: number;
}

export interface SpendingHighlight {
  id: string;
  title: string;
  body: string;
  impact?: string;
}

export interface MonthlyBucket {
  ym: string; // YYYY-MM
  income: number;
  expense: number;
  net: number;
}

function asCanonicalTransaction(t: ReportTxn): TransactionRow {
  return {
    ...t,
    id: t.id ?? "",
    account_id: t.account_id ?? "",
    category_id: t.category_id ?? null,
    status: t.status ?? "confirmed",
    description: null,
    transfer_group_id: t.transfer_group_id ?? null,
  };
}

export function groupByMonth(txns: ReportTxn[]): MonthlyBucket[] {
  const map = new Map<string, MonthlyBucket>();
  for (const t of txns) {
    const canonical = asCanonicalTransaction(t);
    const incomeAmount = behavioralMetricAmount(canonical, "income");
    const expenseAmount = behavioralMetricAmount(canonical, "expense");
    if (incomeAmount === 0 && expenseAmount === 0) continue;
    const ym = t.occurred_at.slice(0, 7);
    const b = map.get(ym) ?? { ym, income: 0, expense: 0, net: 0 };
    b.income += incomeAmount;
    b.expense = Math.max(0, b.expense + expenseAmount);
    b.net = b.income - Math.max(0, b.expense);
    map.set(ym, b);
  }
  return [...map.values()].sort((a, b) => a.ym.localeCompare(b.ym));
}

export function byCategory(txns: ReportTxn[]): CategoryBucket[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const t of txns) {
    const signed = behavioralMetricAmount(asCanonicalTransaction(t), "expense");
    if (signed === 0) continue;
    const k = t.category_name || "Sem categoria";
    const cur = map.get(k) ?? { total: 0, count: 0 };
    cur.total = Math.max(0, cur.total + signed);
    if (signed > 0) cur.count += 1;
    map.set(k, cur);
  }
  const totalExpenses = [...map.values()].reduce((sum, v) => sum + v.total, 0);
  return [...map.entries()]
    .filter(([, value]) => value.total > 0)
    .map(([category, v]) => ({
      category,
      ...v,
      average: v.count > 0 ? v.total / v.count : 0,
      percentOfExpenses: totalExpenses > 0 ? (v.total / totalExpenses) * 100 : 0,
      rank: 0,
    }))
    .sort((a, b) => b.total - a.total)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

const FLEXIBLE_CATEGORY_RX = /lazer|restaurante|delivery|bar|ifood|assinatura|streaming|vestu[aá]rio|beleza|outros|mercado|aliment[aá]ç[aã]o|transporte/i;
const ESSENTIAL_CATEGORY_RX = /moradia|aluguel|condom[ií]nio|financiamento|d[ií]vida|empr[eé]stimo|sa[uú]de|seguro|educaç[aã]o|imposto|conta|energia|[aá]gua|internet/i;

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value: number): string {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function isFlexible(category: string): boolean {
  return FLEXIBLE_CATEGORY_RX.test(category) && !ESSENTIAL_CATEGORY_RX.test(category);
}

function isEssential(category: string): boolean {
  return ESSENTIAL_CATEGORY_RX.test(category);
}

export function spendingHighlights(categories: CategoryBucket[], totalExpense?: number): SpendingHighlight[] {
  const total = totalExpense ?? categories.reduce((sum, c) => sum + c.total, 0);
  if (total <= 0 || categories.length === 0) return [];

  const highlights: SpendingHighlight[] = [];
  const top = categories[0];
  const flexible = categories.find((c) => isFlexible(c.category) && c.total >= Math.max(80, total * 0.03));
  const frequent = categories.find((c) => c.count >= 8 && c.average <= Math.max(80, total * 0.03));
  const top3 = categories.slice(0, 3);
  const top3Total = top3.reduce((sum, c) => sum + c.total, 0);
  const top3Pct = (top3Total / total) * 100;

  if (top && top.percentOfExpenses >= 25) {
    const essential = isEssential(top.category);
    highlights.push({
      id: "concentration",
      title: `${top.category} concentra ${pct(top.percentOfExpenses)} das despesas`,
      body: essential
        ? `É o maior bloco do período. Como parece uma despesa mais rígida, a decisão mais útil é revisar contrato, vencimento ou renegociação — não cortar no impulso.`
        : `É o maior ponto de alavanca do período. Qualquer ajuste aqui mexe mais no resultado do que cortar gastos pequenos espalhados.`,
      impact: `${brl(top.total)} em ${top.count} lançamento${top.count === 1 ? "" : "s"}`,
    });
  }

  if (flexible) {
    const reductionPct = flexible.percentOfExpenses >= 18 ? 15 : 10;
    const saving = flexible.total * (reductionPct / 100);
    highlights.push({
      id: "saving",
      title: `Reduzir ${reductionPct}% em ${flexible.category} libera ${brl(saving)}`,
      body: `Essa simulação usa só o que aconteceu no período. É um ajuste pequeno dentro de uma categoria flexível, sem depender de mexer em contas essenciais.`,
      impact: `${pct(flexible.percentOfExpenses)} das despesas atuais`,
    });
  }

  if (frequent && !highlights.some((h) => h.title.includes(frequent.category))) {
    highlights.push({
      id: "frequency",
      title: `${frequent.category} apareceu ${frequent.count} vezes`,
      body: `O ticket médio foi ${brl(frequent.average)}. Quando a frequência é alta, revisar rotina e recorrência costuma funcionar melhor do que procurar uma compra isolada culpada.`,
      impact: `${brl(frequent.total)} no período`,
    });
  }

  if (top3.length >= 3 && top3Pct >= 60) {
    highlights.push({
      id: "focus",
      title: `Top 3 categorias somam ${pct(top3Pct)}`,
      body: `Seu foco de decisão está concentrado em ${top3.map((c) => c.category).join(", ")}. Revisar só esses grupos já cobre a maior parte do resultado.`,
      impact: `${brl(top3Total)} de ${brl(total)}`,
    });
  }

  if (highlights.length === 0 && top) {
    highlights.push({
      id: "baseline",
      title: `${top.category} lidera o período com ${pct(top.percentOfExpenses)}`,
      body: `Ainda não há concentração forte o bastante para recomendar corte. O melhor agora é manter categorias bem classificadas para enxergar padrões por mais alguns dias.`,
      impact: `${brl(top.total)} no período`,
    });
  }

  return highlights.slice(0, 3);
}

export function filterPeriod(txns: ReportTxn[], from?: string, to?: string): ReportTxn[] {
  return txns.filter((t) => {
    if (from && t.occurred_at < from) return false;
    if (to && t.occurred_at > to) return false;
    return true;
  });
}

export function filterCanonicalReportTransactions(txns: ReportTxn[]): ReportTxn[] {
  return txns.filter((t) => {
    const canonical = asCanonicalTransaction(t);
    return behavioralMetricAmount(canonical, "income") !== 0
      || behavioralMetricAmount(canonical, "expense") !== 0;
  });
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(";"), ...rows.map((r) => headers.map((h) => escape(r[h])).join(";"))].join("\n");
}
