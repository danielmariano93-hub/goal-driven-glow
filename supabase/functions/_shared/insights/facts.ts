// Shared behavioral signal computation for the insights engine.
// Used by:
//  - supabase/functions/insights-generate/index.ts (dica do dia na Home)
//  - supabase/functions/_shared/agent/tools.ts (get_spending_highlights)
// Pure functions only — no I/O — so it can be reused across contexts.
// deno-lint-ignore-file no-explicit-any
import { isRealMonthlyMovement, type TransactionRow } from "../engine/facts.ts";

export interface BehavioralSignals {
  month: string;
  top_expense_category: string | null;
  top_expense_category_pct: number;
  category_growth: { name: string; growth_pct: number } | null;
  weekday_hotspot: { weekday: number; label: string; pct: number } | null;
  merchant_repeat: { name: string; occurrences: number; total: number } | null;
  days_without_entry: number;
  goal_pace: { name: string; progress_pct: number; time_pct: number; ahead: boolean } | null;
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeMerchant(s: string | null | undefined): string | null {
  if (!s) return null;
  const cleaned = String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\b(compra|pagamento|debito|credito|pix|ted|doc|de|em|no|na)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned : null;
}

export function computeBehavioralSignals(
  txs: TransactionRow[],
  categoryNames: Map<string, string>,
  goals: Array<{ name?: string | null; target_amount?: number | null; target_date?: string | null; status?: string | null }>,
  contributions: Array<{ goal_id?: string | null; amount: number }>,
  today: Date = new Date(),
): BehavioralSignals {
  const ym = ymOf(today);
  const prevDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevYm = ymOf(prevDate);

  let totalExpense = 0;
  const byCategoryCurrent = new Map<string, number>();
  const byCategoryPrev = new Map<string, number>();
  const byWeekday = new Map<number, number>();
  const byMerchant = new Map<string, { count: number; total: number }>();
  let lastEntry: string | null = null;

  for (const t of txs) {
    if (!isRealMonthlyMovement(t)) continue;
    const amt = Number(t.amount || 0);
    if (!lastEntry || t.occurred_at > lastEntry) lastEntry = t.occurred_at;

    if (t.type === "expense") {
      const cat = t.category_id ? (categoryNames.get(t.category_id) ?? "Sem categoria") : "Sem categoria";
      if (t.occurred_at.startsWith(ym)) {
        totalExpense += amt;
        byCategoryCurrent.set(cat, (byCategoryCurrent.get(cat) ?? 0) + amt);
        // Weekday: usa o dia local do occurred_at (YYYY-MM-DD)
        const [yy, mm, dd] = t.occurred_at.slice(0, 10).split("-").map(Number);
        const wd = new Date(yy, (mm ?? 1) - 1, dd ?? 1).getDay();
        byWeekday.set(wd, (byWeekday.get(wd) ?? 0) + amt);
        // Merchant recente (últimos 30 dias, aqui aproximado ao mês)
        const merchant = normalizeMerchant(t.description);
        if (merchant) {
          const entry = byMerchant.get(merchant) ?? { count: 0, total: 0 };
          entry.count += 1; entry.total += amt;
          byMerchant.set(merchant, entry);
        }
      } else if (t.occurred_at.startsWith(prevYm)) {
        byCategoryPrev.set(cat, (byCategoryPrev.get(cat) ?? 0) + amt);
      }
    }
  }

  // Top categoria + %
  let topCat: string | null = null;
  let topCatValue = 0;
  for (const [name, value] of byCategoryCurrent) {
    if (name === "Sem categoria") continue;
    if (value > topCatValue) { topCatValue = value; topCat = name; }
  }
  const topPct = totalExpense > 0 && topCat ? Math.round((topCatValue / totalExpense) * 100) : 0;

  // Categoria que mais cresceu (>= 30% e valor >= R$ 50)
  let growth: BehavioralSignals["category_growth"] = null;
  for (const [name, cur] of byCategoryCurrent) {
    if (name === "Sem categoria") continue;
    const prev = byCategoryPrev.get(name) ?? 0;
    if (prev < 30 || cur < 50) continue;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct >= 30 && (!growth || pct > growth.growth_pct)) {
      growth = { name, growth_pct: pct };
    }
  }

  // Weekday hotspot
  let hotspot: BehavioralSignals["weekday_hotspot"] = null;
  let hotspotValue = 0;
  let weekdayTotal = 0;
  for (const [_wd, v] of byWeekday) weekdayTotal += v;
  for (const [wd, v] of byWeekday) {
    if (v > hotspotValue) { hotspotValue = v; hotspot = { weekday: wd, label: WEEKDAYS[wd], pct: 0 }; }
  }
  if (hotspot && weekdayTotal > 0) hotspot.pct = Math.round((hotspotValue / weekdayTotal) * 100);
  if (hotspot && hotspot.pct < 30) hotspot = null; // só destaca se realmente concentrar

  // Merchant repetido: >= 3 ocorrências no mês
  let merchantRepeat: BehavioralSignals["merchant_repeat"] = null;
  for (const [name, e] of byMerchant) {
    if (e.count >= 3 && (!merchantRepeat || e.total > merchantRepeat.total)) {
      merchantRepeat = { name, occurrences: e.count, total: Math.round(e.total * 100) / 100 };
    }
  }

  // Days without entry
  let daysWithout = 0;
  if (lastEntry) {
    const last = new Date(lastEntry + "T12:00:00");
    const diff = Math.floor((today.getTime() - last.getTime()) / 86400000);
    daysWithout = Math.max(0, diff);
  } else {
    daysWithout = 30;
  }

  // Goal pace
  let goalPace: BehavioralSignals["goal_pace"] = null;
  const activeGoals = (goals ?? []).filter((g) => (g.status ?? "active") === "active" && g.target_amount && g.target_amount > 0);
  if (activeGoals.length > 0) {
    // Escolhe a primeira meta ativa com target_date
    const withDate = activeGoals.find((g) => g.target_date);
    const chosen = withDate ?? activeGoals[0];
    const goalName = chosen.name ?? "sua meta";
    const target = Number(chosen.target_amount || 0);
    const totalContrib = contributions.reduce((s, c) => s + Number(c.amount || 0), 0);
    const progressPct = target > 0 ? Math.min(100, Math.round((totalContrib / target) * 100)) : 0;
    let timePct = 50;
    if (chosen.target_date) {
      const start = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
      const target_date = new Date(chosen.target_date + "T00:00:00").getTime();
      const elapsed = today.getTime() - start;
      const total = target_date - start;
      timePct = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 100;
    }
    goalPace = { name: goalName, progress_pct: progressPct, time_pct: timePct, ahead: progressPct >= timePct };
  }

  return {
    month: ym,
    top_expense_category: topCat,
    top_expense_category_pct: topPct,
    category_growth: growth,
    weekday_hotspot: hotspot,
    merchant_repeat: merchantRepeat,
    days_without_entry: daysWithout,
    goal_pace: goalPace,
  };
}
