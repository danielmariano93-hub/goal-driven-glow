// Impacto de uma compra simulada na meta da categoria. Puro: recebe o que o simulador já calculou.
import type { PurchasePlan } from "@/lib/nino/purchasePlan";

export type GoalImpactStatus = "outside" | "fits" | "was_over" | "exceeds";

export interface GoalImpactInput {
  categoryName: string;
  limit: number;
  spent: number;
  remainingBefore: number;
  remainingAfter: number;
}

export interface GoalImpactView {
  status: GoalImpactStatus;
  /** Quanto da meta a compra ocupa (0 se cai fora do período). */
  applied: number;
  /** Parte do que ainda cabia na meta que a compra usa (0 a 1+); nulo se não havia folga ou a compra não conta. */
  usedOfRemaining: number | null;
  /** Barra: fração do limite já gasta e fração que a compra soma (podem passar de 1: estouro). */
  spentFrac: number;
  purchaseFrac: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function goalImpactView(i: GoalImpactInput): GoalImpactView {
  const applied = r2(i.remainingBefore - i.remainingAfter);
  const spentFrac = i.limit > 0 ? i.spent / i.limit : 0;
  const purchaseFrac = i.limit > 0 ? applied / i.limit : 0;
  if (applied <= 0.005) return { status: "outside", applied: 0, usedOfRemaining: null, spentFrac, purchaseFrac: 0 };
  if (i.remainingBefore <= 0) return { status: "was_over", applied, usedOfRemaining: null, spentFrac, purchaseFrac };
  return { status: i.remainingAfter < 0 ? "exceeds" : "fits", applied, usedOfRemaining: applied / i.remainingBefore, spentFrac, purchaseFrac };
}

/** Meses da compra (parcelas) que têm meta na categoria, com o que sobra em cada um. */
export function goalMonths(plan: PurchasePlan | null): Array<{ label: string; limit: number; after: number; exceeds: boolean }> {
  if (!plan) return [];
  return plan.months
    .filter((m) => m.category && m.category.limit != null)
    .map((m) => ({ label: m.label, limit: m.category!.limit as number, after: m.category!.after, exceeds: m.category!.exceeds_limit }));
}

/** "menos de 1%", "3%", "100%". */
export function percentText(frac: number): string {
  const p = frac * 100;
  return p > 0 && p < 1 ? "menos de 1%" : `${Math.round(p)}%`;
}
