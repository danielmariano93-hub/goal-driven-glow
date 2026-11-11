import type { BenefitState } from "@/lib/engine/benefitWallet";

/** Frase do Ticket sobre o dia de hoje: quanto cabe, ou quanto passou e quanto dá por dia daqui para frente. */
export function todayLine(state: BenefitState, brl: (n: number) => string, dm: (iso: string) => string): string | null {
  if (state.today_remaining === null || state.ideal_per_day === null) return null;
  if (state.today_over > 0.005) {
    const pct = state.today_over_pct !== null ? ` (${state.today_over_pct}%)` : "";
    const forward = state.ideal_from_tomorrow !== null
      ? `Para fechar o ciclo no crédito de ${dm(state.cycle.next)}, dá para gastar ${brl(state.ideal_from_tomorrow)} por dia a partir de amanhã.`
      : `O próximo crédito é em ${dm(state.cycle.next)}.`;
    return `Hoje você já gastou ${brl(state.spent_today)}: ${brl(state.today_over)}${pct} acima dos ${brl(state.ideal_per_day)} do dia. ${forward}`;
  }
  if (state.spent_today > 0 && state.today_remaining === 0) return `Hoje você já gastou ${brl(state.spent_today)}: esse foi todo o ideal do dia.`;
  if (state.spent_today > 0) return `Hoje você já gastou ${brl(state.spent_today)}: ainda cabem ${brl(state.today_remaining)} dos ${brl(state.ideal_per_day)} do dia.`;
  return `Hoje cabem ${brl(state.ideal_per_day)} para fechar o ciclo no crédito de ${dm(state.cycle.next)}.`;
}
