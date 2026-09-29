// proactive_user_model.v1 — o que importa para ESTA pessoa (função pura).
// =======================================================================
// Um destaque é relevante quando mexe em algo que a pessoa quer: uma meta,
// um plano que ela contou na conversa. O modelo junta metas de poupança e a
// memória de relacionamento (`life:*`) e liga cada situação ao objetivo que ela
// afeta, com a conta feita aqui (nunca pela IA).
import type { FinancialSituation } from "./contracts.ts";
import { brlPt } from "./presentation.ts";

export const PROACTIVE_USER_MODEL_VERSION = "proactive_user_model.v1";

export type UserGoalInput = {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  target_date: string | null;
  monthly_target: number | null;
};

export type UserGoal = UserGoalInput & {
  remaining: number;
  months_left: number | null;
  /** Aporte mensal necessário para chegar no prazo (ou a meta mensal declarada). */
  monthly_need: number | null;
  /** A pessoa falou disso na conversa (memória de relacionamento). */
  mentioned: boolean;
};

export type UserModel = {
  version: string;
  goals: UserGoal[];
  /** Meta que ancora a conversa: a citada pela pessoa, senão a de prazo mais próximo. */
  focus_goal: UserGoal | null;
  life_notes: string[];
};

function fold(text: string): string {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const STOPWORDS = new Set(["meta", "minha", "para", "fazer", "comprar", "reserva", "financeira", "objetivo"]);

/** Radical curto: "viagem" e "viajar" viram "viag"; "nordeste" vira "nord". */
function stem(token: string): string {
  return token.replace(/^viaj/, "viag").slice(0, 4);
}

function tokens(text: string): string[] {
  return fold(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOPWORDS.has(t)).map(stem);
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function buildUserModel(input: { today: string; goals: UserGoalInput[]; lifeNotes: string[] }): UserModel {
  const notes = input.lifeNotes.map((n) => String(n ?? "").trim()).filter(Boolean).slice(0, 12);
  const noteTokens = new Set(notes.flatMap(tokens));
  const goals: UserGoal[] = input.goals
    .filter((g) => Number(g.target_amount) > 0)
    .map((g) => {
      const remaining = Math.max(0, Math.round((Number(g.target_amount) - Number(g.saved_amount || 0)) * 100) / 100);
      const monthsLeft = g.target_date ? Math.max(1, monthsBetween(input.today, g.target_date)) : null;
      const declared = Number(g.monthly_target ?? 0);
      const monthlyNeed = declared > 0
        ? declared
        : monthsLeft && remaining > 0 ? Math.round((remaining / monthsLeft) * 100) / 100 : null;
      const mentioned = tokens(g.name).some((t) => noteTokens.has(t));
      return { ...g, remaining, months_left: monthsLeft, monthly_need: monthlyNeed, mentioned };
    })
    .filter((g) => g.remaining > 0);
  const byUrgency = [...goals].sort((a, b) =>
    Number(b.mentioned) - Number(a.mentioned)
    || (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"));
  return {
    version: PROACTIVE_USER_MODEL_VERSION,
    goals,
    focus_goal: byUrgency.find((g) => (g.monthly_need ?? 0) > 0) ?? null,
    life_notes: notes,
  };
}

/** Situações de gasto cujo valor compete diretamente com a meta. */
const SPENDING_KINDS = new Set([
  "spending_pace_change", "growing_category", "cash_flow_imbalance", "emotional_spending",
  "impulsive_spending", "spending_spike", "small_spend_acceleration", "underused_subscription",
]);

/** Pontos somados ao score quando a situação toca o que a pessoa quer. */
export const RELEVANCE_POINTS = { goal: 12, mentioned: 8, goal_link: 10 } as const;

function referencedGoal(situation: FinancialSituation, model: UserModel): UserGoal | null {
  const evidence = (situation.evidence ?? {}) as Record<string, unknown>;
  const goalId = String(evidence.goal_id ?? (evidence.next_action as any)?.goal_id ?? "");
  const byId = goalId ? model.goals.find((g) => g.id === goalId) : undefined;
  if (byId) return byId;
  const text = fold(`${situation.title} ${situation.body}`);
  return model.goals.find((g) => fold(g.name).length >= 3 && text.includes(fold(g.name))) ?? null;
}

/**
 * Liga situações às metas da pessoa:
 *  - situação sobre uma meta ganha relevância (mais ainda se ela citou a meta);
 *  - situação de gasto relevante ganha a frase "isso equivale a X% do que a
 *    meta precisa por mês", calculada aqui a partir de valores já existentes.
 */
export function applyUserModel(situations: FinancialSituation[], model: UserModel): FinancialSituation[] {
  if (!model.goals.length) return situations;
  return situations.map((situation) => {
    let boost = 0;
    const reasons: string[] = [];
    let body = situation.body;
    let goalLink: Record<string, unknown> | null = null;

    const goal = referencedGoal(situation, model);
    if (goal || situation.primary_domain === "goals") {
      boost += RELEVANCE_POINTS.goal;
      reasons.push("user_goal");
      if (goal?.mentioned) {
        boost += RELEVANCE_POINTS.mentioned;
        reasons.push("mentioned_in_conversation");
      }
    } else if (SPENDING_KINDS.has(situation.communication_kind) && model.focus_goal && situation.impact_amount > 0) {
      const focus = model.focus_goal;
      const need = Number(focus.monthly_need ?? 0);
      const share = need > 0 ? situation.impact_amount / need : 0;
      if (share >= 0.2) {
        const pct = Math.min(999, Math.round(share * 100));
        const sentence = pct >= 100
          ? `Esse valor passa do que a meta “${focus.name}” precisa por mês (${brlPt(need)}).`
          : `Esse valor equivale a ${pct}% do que a meta “${focus.name}” precisa por mês.`;
        if (!body.includes(focus.name)) body = `${body} ${sentence}`.trim();
        boost += RELEVANCE_POINTS.goal_link + (focus.mentioned ? RELEVANCE_POINTS.mentioned : 0);
        reasons.push("goal_link");
        if (focus.mentioned) reasons.push("mentioned_in_conversation");
        goalLink = {
          goal_id: focus.id, goal_name: focus.name, monthly_need: need,
          impact_amount: situation.impact_amount, share_pct: pct,
        };
      }
    }

    if (!boost) return situation;
    return {
      ...situation,
      body,
      score_reasons: [...situation.score_reasons, ...reasons],
      evidence: {
        ...situation.evidence,
        relevance_boost: Number((situation.evidence as any)?.relevance_boost ?? 0) + boost,
        user_model: { version: model.version, reasons, goal_link: goalLink, goal_id: goal?.id ?? null },
      },
    };
  });
}
