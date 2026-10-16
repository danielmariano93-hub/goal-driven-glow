// Gate estrutural (insumo do E11): a dificuldade é de renda/obrigações, não de comportamento?
import type { IncomeBaseline, MapaIndicator, StructuralFlags } from "./mapaContracts";
import type { EssentialMonthly } from "./mapaSeguranca";
import type { MapaMonthAgg } from "./mapaMonthly";
import { lastClosedActiveMonths } from "./mapaMonthly";
import { DEBT_SERVICE_CRITICAL, ESSENTIAL_STRUCTURAL_SHARE, NEGATIVE_STREAK_STRUCTURAL } from "./mapaThresholds";

export function computeStructural(args: { months: MapaMonthAgg[]; income: IncomeBaseline; essential: EssentialMonthly | null; indicators: MapaIndicator[] }): StructuralFlags {
  const typical = args.income.typical;
  // Só com essenciais CONFIRMADOS: gasto total sobre a renda não é "pressão estrutural" (inclui lazer e outros).
  const essentialShare = args.essential && args.essential.basis === "essenciais" && typical && typical > 0 ? Math.round((args.essential.value / typical) * 1000) / 1000 : null;
  const debt = args.indicators.find((x) => x.id === "dividas.comprometimento_renda");
  const debtRatio = debt && debt.value !== null ? debt.value / 100 : null;
  const recent = lastClosedActiveMonths(args.months, NEGATIVE_STREAK_STRUCTURAL).reverse();
  let streak: number | null = null;
  if (recent.length >= NEGATIVE_STREAK_STRUCTURAL) { streak = 0; for (const m of recent) { if (m.income - m.consumption < 0) streak += 1; else break; } }
  const known = [essentialShare, debtRatio, streak].some((v) => v !== null);
  const structural = !known ? null
    : (essentialShare !== null && essentialShare > ESSENTIAL_STRUCTURAL_SHARE)
      || (debtRatio !== null && debtRatio > DEBT_SERVICE_CRITICAL)
      || (streak !== null && streak >= NEGATIVE_STREAK_STRUCTURAL);
  return { essential_share_of_income: essentialShare, debt_service_ratio: debtRatio, negative_result_streak: streak, structural };
}
