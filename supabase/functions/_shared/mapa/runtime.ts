// Runtime servidor do Mapa Financeiro (`mapa_financeiro.v1`).
// Carrega o ledger canônico (competência, estornos, sem transferência/fatura/investimento) e os insumos de saúde
// financeira, e entrega a leitura pronta. Nenhuma fórmula vive aqui: tudo está em `finance-core` (mapa*.ts).
// Falha de uma fonte degrada a leitura (indicador sem dados), nunca derruba a resposta.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../derived/pagedSelect.ts";
import { loadExecutiveInput } from "../insights/executive/load.ts";
import { computeDebtStatus } from "../finance-core/debtStatus.ts";
import { buildMapaReading } from "../finance-core/mapaReading.ts";
import { snapshotInputFromPayload, type MapaDebtIn, type MapaHealthInputs } from "../finance-core/mapaInputs.ts";
import type { MapaReading } from "../finance-core/mapaContracts.ts";

/** Acesso controlado por flag (`mapa_access`): por ora só quem foi liberado. */
export async function mapaAccess(sb: any, userId: string): Promise<boolean> {
  const { data, error } = await sb.from("mapa_access").select("enabled").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`mapa_access:${error.message}`);
  return data?.enabled === true;
}

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const shiftDays = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function safe<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) { console.warn(`mapa:${label}`, String(error).slice(0, 160)); return fallback; }
}

export async function loadHealthInputs(sb: any, userId: string, today: string): Promise<MapaHealthInputs> {
  const since = shiftDays(today, -90);
  const [snapshot, flags, debtRows, payments, investments, goals, contributions, movements, debtTx] = await Promise.all([
    safe("snapshot", null, async () => {
      const { data } = await sb.from("financial_current_snapshots").select("payload").eq("user_id", userId).order("computed_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      return snapshotInputFromPayload(data?.payload);
    }),
    safe("flags", {} as Record<string, boolean>, async () => {
      const { data } = await sb.from("category_essential_flags").select("category_id,essential").eq("user_id", userId);
      return Object.fromEntries(((data ?? []) as any[]).map((r) => [String(r.category_id), r.essential === true]));
    }),
    safe("debts", [] as any[], async () => (await sb.from("debts").select("*").eq("user_id", userId)).data ?? []),
    safe("debt_payments", [] as any[], async () => (await sb.from("debt_payments").select("debt_id,paid_at,amount,amount_applied,installments_covered").eq("user_id", userId)).data ?? []),
    safe("investments", [] as any[], async () => (await sb.from("investments").select("id,name,current_value,liquidity,reserve_role").eq("user_id", userId)).data ?? []),
    safe("goals", [] as any[], async () => (await sb.from("goals").select("id,name,target_amount,target_date,created_at,kind,status").eq("user_id", userId)).data ?? []),
    safe("goal_contributions", [] as any[], async () => (await sb.from("goal_contributions").select("goal_id,amount").eq("user_id", userId)).data ?? []),
    safe("investment_movements", [] as any[], async () =>
      (await sb.from("investment_movements").select("kind,amount,occurred_at").eq("user_id", userId).in("kind", ["redemption", "withdrawal"]).gte("occurred_at", since)).data ?? []),
    safe("debt_payments_ledger", [] as any[], async () => fetchAllPages<any>((a, b) =>
      sb.from("transactions").select("id,amount,occurred_at")
        .eq("user_id", userId).eq("status", "confirmed").eq("type", "expense")
        .in("movement_kind", ["debt_payment", "loan_payment"]).gte("occurred_at", `${since}T00:00:00`)
        .order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(a, b),
      { source: "mapa_debt_payments" })),
  ]);

  const activeDebts = (debtRows as any[]).filter((d) => String(d.status ?? "active") === "active");
  const status = activeDebts.length
    ? computeDebtStatus({
      debts: activeDebts as any,
      payments: (payments as any[]).map((p) => ({ ...p, amount: num(p.amount), amount_applied: p.amount_applied == null ? null : num(p.amount_applied) })),
      today,
    })
    : null;
  const maxDays = status ? Math.max(0, ...status.items.map((i: any) => (typeof i.days_overdue === "number" ? i.days_overdue : 0))) : null;

  const debts: MapaDebtIn[] = (debtRows as any[]).map((d) => ({
    id: String(d.id), name: String(d.name ?? ""), status: String(d.status ?? "active"),
    kind: d.kind ?? null, outstanding_balance: num(d.outstanding_balance),
    installment_amount: d.installment_amount == null ? null : num(d.installment_amount),
    interest_rate_pct: d.interest_rate_pct == null ? null : num(d.interest_rate_pct),
    interest_rate_period: d.interest_rate_period ?? null,
  }));
  const saved = new Map<string, number>();
  for (const c of contributions as any[]) saved.set(String(c.goal_id), (saved.get(String(c.goal_id)) ?? 0) + num(c.amount));

  return {
    snapshot,
    categoryEssential: flags,
    debts,
    debtOverdue: status ? { count: status.facts.overdue_count, amount: status.facts.overdue_amount, max_days: maxDays || null } : { count: 0, amount: 0, max_days: null },
    investments: (investments as any[]).map((v) => ({ id: String(v.id), name: String(v.name ?? ""), current_value: num(v.current_value), liquidity: v.liquidity ?? null, reserve_role: v.reserve_role ?? null })),
    savingsGoals: (goals as any[])
      .filter((g) => g.kind !== "donation" && String(g.status ?? "active") === "active")
      .map((g) => ({ id: String(g.id), name: String(g.name ?? ""), target_amount: num(g.target_amount), saved_amount: saved.get(String(g.id)) ?? 0, created_at: String(g.created_at ?? today).slice(0, 10), target_date: g.target_date ? String(g.target_date).slice(0, 10) : null })),
    redemptions90: (movements as any[]).map((m) => ({ date: String(m.occurred_at).slice(0, 10), amount: num(m.amount) })),
    debtPayments90: (debtTx as any[]).map((t) => ({ date: String(t.occurred_at).slice(0, 10), amount: num(t.amount) })),
  };
}

export async function loadMapaReading(sb: any, userId: string, today: string): Promise<MapaReading> {
  // 24 meses de histórico; leitura paginada dentro do loader.
  const [input, health] = await Promise.all([loadExecutiveInput(sb, userId, today, 24), loadHealthInputs(sb, userId, today)]);
  const entries = input.entries.map((e) => ({ date: e.date, kind: e.kind, amount: e.amount, category_id: e.category_id }));
  return buildMapaReading({ asOf: today, entries, health });
}
