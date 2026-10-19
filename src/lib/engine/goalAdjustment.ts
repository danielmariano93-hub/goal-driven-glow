// Avaliação de ajuste de meta (`goal_adjustment.v1`).
//
// Quando a pessoa muda o limite (ou a forma de medir) de uma meta de categoria,
// o ajuste fica registrado. Quando o período fecha, comparamos o que realmente
// foi gasto com o limite ANTIGO e com o NOVO e dizemos, sem rodeio, se o ajuste
// foi necessário, desnecessário ou insuficiente. Módulo puro, sem I/O.
//
// Cautela de leitura: o gasto depois do ajuste pode ter sido influenciado pelo
// próprio ajuste (limite maior = menos freio). Por isso o texto fala em "teria
// ficado", nunca em causa e efeito garantido.

import { spendingMonthLabel, type SpendingEntry } from "./spendingGoals";

export const GOAL_ADJUSTMENT_VERSION = "goal_adjustment.v1";

export interface GoalAdjustmentRow {
  id: string;
  goal_id: string | null;
  category_id: string;
  adjusted_on: string;
  period_start: string;
  period_end: string;
  old_limit: number;
  new_limit: number;
  old_mode?: string | null;
  new_mode?: string | null;
  old_baseline_kind?: string | null;
  new_baseline_kind?: string | null;
  reason?: string | null;
}

export type AdjustmentDirection = "loosened" | "tightened" | "measure_changed";

export type AdjustmentVerdict =
  | "pending"
  | "necessary"
  | "unnecessary"
  | "insufficient"
  | "worked"
  | "too_tight"
  | "neutral";

export interface AdjustmentReview {
  id: string;
  goal_id: string | null;
  category_id: string;
  category_name: string;
  adjusted_on: string;
  period_start: string;
  period_end: string;
  direction: AdjustmentDirection;
  old_limit: number;
  new_limit: number;
  delta: number;
  delta_pct: number | null;
  closed: boolean;
  /** Gasto da categoria até o dia do ajuste. */
  spent_at_adjustment: number;
  /** O limite antigo já tinha sido ultrapassado quando a meta foi mexida. */
  over_at_adjustment: boolean;
  /** Gasto no período (final, se fechado). */
  spent: number;
  /** Fechamento no ritmo atual (só período aberto). */
  projected: number | null;
  /** Número usado na comparação: gasto final, ou projeção se ainda aberto. */
  outcome: number;
  within_old: boolean;
  within_new: boolean;
  verdict: AdjustmentVerdict;
  /** Em período aberto, para onde a leitura aponta até agora. */
  leaning: Exclude<AdjustmentVerdict, "pending"> | null;
  headline: string;
  explanation: string;
  reason: string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));

function daysInclusive(a: string, b: string): number {
  const ms = Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

export function adjustmentDirection(a: Pick<GoalAdjustmentRow, "old_limit" | "new_limit">): AdjustmentDirection {
  const diff = round2(a.new_limit - a.old_limit);
  if (diff > 0) return "loosened";
  if (diff < 0) return "tightened";
  return "measure_changed";
}

function classify(direction: AdjustmentDirection, withinOld: boolean, withinNew: boolean): Exclude<AdjustmentVerdict, "pending"> {
  if (direction === "loosened") {
    if (withinOld) return "unnecessary";
    return withinNew ? "necessary" : "insufficient";
  }
  if (direction === "tightened") {
    if (withinNew) return "worked";
    return withinOld ? "too_tight" : "insufficient";
  }
  return "neutral";
}

export function reviewGoalAdjustment(args: {
  adjustment: GoalAdjustmentRow;
  entries: SpendingEntry[];
  today: string;
  categoryName: string;
}): AdjustmentReview {
  const { adjustment: a, entries, today, categoryName } = args;
  const inPeriod = entries.filter((e) => e.category_id === a.category_id && e.date >= a.period_start && e.date <= a.period_end);
  const spent = round2(inPeriod.reduce((s, e) => s + e.amount, 0));
  const spentAt = round2(inPeriod.filter((e) => e.date <= a.adjusted_on).reduce((s, e) => s + e.amount, 0));
  const closed = today > a.period_end;
  const total = Math.max(1, daysInclusive(a.period_start, a.period_end));
  const elapsed = closed ? total : Math.min(total, Math.max(1, daysInclusive(a.period_start, today)));
  // Ritmo simples: nunca projeta abaixo do que já foi gasto.
  const projected = closed ? null : round2(Math.max(spent, (spent / elapsed) * total));
  const outcome = projected ?? spent;
  const direction = adjustmentDirection(a);
  const withinOld = outcome <= a.old_limit;
  const withinNew = outcome <= a.new_limit;
  const leaning = classify(direction, withinOld, withinNew);
  const verdict: AdjustmentVerdict = closed ? leaning : "pending";
  const overAtAdjustment = spentAt > a.old_limit;
  const delta = round2(a.new_limit - a.old_limit);
  const deltaPct = a.old_limit > 0 ? Math.round((delta / a.old_limit) * 100) : null;
  const month = spendingMonthLabel(a.period_start.slice(0, 7));

  const { headline, explanation } = narrate({
    direction, verdict, leaning, closed, a, outcome, spent, projected, overAtAdjustment, categoryName, month, withinOld, withinNew,
  });

  return {
    id: a.id, goal_id: a.goal_id, category_id: a.category_id, category_name: categoryName,
    adjusted_on: a.adjusted_on, period_start: a.period_start, period_end: a.period_end,
    direction, old_limit: a.old_limit, new_limit: a.new_limit, delta, delta_pct: deltaPct,
    closed, spent_at_adjustment: spentAt, over_at_adjustment: overAtAdjustment,
    spent, projected, outcome, within_old: withinOld, within_new: withinNew,
    verdict, leaning: direction === "measure_changed" ? "neutral" : leaning,
    headline, explanation, reason: a.reason ?? null,
  };
}

function narrate(x: {
  direction: AdjustmentDirection; verdict: AdjustmentVerdict; leaning: Exclude<AdjustmentVerdict, "pending">;
  closed: boolean; a: GoalAdjustmentRow; outcome: number; spent: number; projected: number | null;
  overAtAdjustment: boolean; categoryName: string; month: string; withinOld: boolean; withinNew: boolean;
}): { headline: string; explanation: string } {
  const { a } = x;
  const cat = x.categoryName;
  const oldL = brl(a.old_limit);
  const newL = brl(a.new_limit);
  const caveat = x.overAtAdjustment && x.direction === "loosened"
    ? ` O ajuste foi feito depois de o limite antigo já ter sido ultrapassado, então vale perguntar se o teto estava errado ou se foi só o mês que fugiu.`
    : "";
  if (x.direction === "measure_changed") {
    return {
      headline: `Forma de medir de ${cat} mudou`,
      explanation: `O limite continua em ${newL}, mas a forma de calcular mudou. ${x.closed ? `Em ${x.month} você gastou ${brl(x.spent)}.` : `Até agora você gastou ${brl(x.spent)}.`}`,
    };
  }
  const closedText = x.closed ? `Em ${x.month} você gastou ${brl(x.spent)}` : `No ritmo atual, ${cat} fecha em ${brl(x.outcome)}`;
  const move = x.direction === "loosened" ? `de ${oldL} para ${newL}` : `de ${oldL} para ${newL}`;
  switch (x.leaning) {
    case "necessary":
      return {
        headline: x.closed ? "O ajuste foi necessário" : "O ajuste está se mostrando necessário",
        explanation: `${closedText}. Com o limite antigo (${oldL}) a meta teria estourado; com o novo (${newL}) ficou dentro. A mudança ${move} fez sentido.${caveat}`,
      };
    case "unnecessary":
      return {
        headline: x.closed ? "O ajuste não era necessário" : "O ajuste pode não ter sido necessário",
        explanation: `${closedText}. Isso já cabia no limite antigo (${oldL}), então não precisava afrouxar para ${newL}. Um teto mais folgado tira o freio sem ganho.${caveat}`,
      };
    case "insufficient":
      return {
        headline: x.closed ? "O ajuste não bastou" : "O ajuste ainda não é suficiente",
        explanation: `${closedText}, acima do limite novo (${newL}) e também do antigo (${oldL}). Mudar o número não resolveu: a categoria pede olhar para o que pesa nela, não só para o teto.${caveat}`,
      };
    case "worked":
      return {
        headline: x.closed ? "Teto mais apertado funcionou" : "Teto mais apertado está funcionando",
        explanation: `${closedText}, dentro do novo limite de ${newL} (antes ${oldL}). Você cumpriu uma meta mais exigente.`,
      };
    case "too_tight":
      return {
        headline: x.closed ? "O novo teto ficou apertado" : "O novo teto deve ficar apertado",
        explanation: `${closedText}. Cabia no limite antigo (${oldL}), mas passa do novo (${newL}). Se esse nível de gasto é a sua realidade, vale ajustar o teto de novo para um valor realista.`,
      };
    default:
      return { headline: "Ajuste registrado", explanation: `Limite ${move}.` };
  }
}

/** Ajustes mais recentes primeiro; um por vez por meta e período já vem do banco. */
export function reviewGoalAdjustments(args: {
  adjustments: GoalAdjustmentRow[];
  entries: SpendingEntry[];
  today: string;
  categoryNames: Map<string, string>;
}): AdjustmentReview[] {
  return [...args.adjustments]
    .sort((x, y) => (x.adjusted_on < y.adjusted_on ? 1 : x.adjusted_on > y.adjusted_on ? -1 : 0))
    .map((adjustment) => reviewGoalAdjustment({
      adjustment,
      entries: args.entries,
      today: args.today,
      categoryName: args.categoryNames.get(adjustment.category_id) ?? "Categoria",
    }));
}
