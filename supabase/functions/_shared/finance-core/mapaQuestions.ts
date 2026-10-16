// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// E13 — Agendador de perguntas. Uma pergunta só existe se destrava um indicador (needs) ou mede algo exploratório aprovado.
// Orçamento de atenção [provisório]: no máximo 1 pergunta resolvida por dia e 3 por semana (CFPB é independente, a cada 15 dias).
// "Pular" adia 7 dias; "depois" adia 2. Puro: recebe as linhas de `map_questions` e devolve o que pode ser perguntado AGORA.
import type { MapaIndicator, MapaQuestionDue } from "./mapaContracts.ts";
import type { MapaMonthlyEstimate, MapaQuestionRow } from "./mapaInputs.ts";
import { aggregateMonths, mapaAddMonths, mapaMonthOf, type MapaMonthlyEntry } from "./mapaMonthly.ts";
import { ESTIMATE_ASK_UNTIL_DAY, QUESTIONS_PER_DAY, QUESTIONS_PER_WEEK, QUESTION_SKIP_COOLDOWN_DAYS } from "./mapaThresholds.ts";

export const QUESTIONS_FORMULA = "mapa_questions.v1";
export const CFPB_CADENCE_DAYS = 15;

export interface QuestionsInput {
  /** Instante de referência (ISO completo). */
  nowIso: string;
  /** Data civil de São Paulo (YYYY-MM-DD). */
  asOf: string;
  indicators: MapaIndicator[];
  entries: MapaMonthlyEntry[];
  estimates: MapaMonthlyEstimate[];
  questions: MapaQuestionRow[];
  lastCfpbAt: string | null;
}

const NEED_TO_KIND: Record<string, MapaQuestionDue["kind"]> = {
  essencial_categoria: "essencial_categoria",
  debt_rate: "taxa_divida",
  debt_kind: "taxa_divida",
  liquidez_investimento: "liquidez_investimento",
  estimativa_mensal: "estimativa_mensal",
};

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(iso);

export function scheduleQuestions(i: QuestionsInput): MapaQuestionDue[] {
  const now = ms(i.nowIso);
  const out: MapaQuestionDue[] = [];

  // CFPB: cadência própria, fora do orçamento.
  const daysSinceCfpb = i.lastCfpbAt ? Math.floor((now - ms(i.lastCfpbAt)) / DAY) : null;
  const cfpbDue = daysSinceCfpb === null || daysSinceCfpb >= CFPB_CADENCE_DAYS;

  // Orçamento: perguntas (que não são CFPB) resolvidas recentemente.
  const resolved = i.questions
    .filter((q) => q.kind !== "cfpb")
    .flatMap((q) => [q.answered_at, q.skipped_at].filter((t): t is string => !!t).map(ms));
  const lastDay = resolved.filter((t) => now - t < DAY).length;
  const lastWeek = resolved.filter((t) => now - t < 7 * DAY).length;
  const budgetOpen = lastDay < QUESTIONS_PER_DAY && lastWeek < QUESTIONS_PER_WEEK;

  const blocked = (kind: string) => i.questions.some((q) =>
    q.kind === kind && (
      (q.skipped_at && now - ms(q.skipped_at) < QUESTION_SKIP_COOLDOWN_DAYS * DAY) ||
      (!q.answered_at && !q.skipped_at && ms(q.due_at) > now)),
  );

  if (budgetOpen) {
    const unlocked = new Map<MapaQuestionDue["kind"], number>();
    for (const ind of i.indicators) {
      const code = ind.needs?.kind === "capture" ? ind.needs.code : null;
      const kind = code ? NEED_TO_KIND[code] : undefined;
      if (kind) unlocked.set(kind, (unlocked.get(kind) ?? 0) + 1);
    }
    for (const [kind, n] of unlocked) {
      if (blocked(kind)) continue;
      out.push({ kind, reason: `destrava_${n}_indicador${n > 1 ? "es" : ""}`, priority: 10 + n });
    }

    // Estimativa do mês que acabou de fechar: antes de a pessoa ver o número real.
    const prev = mapaAddMonths(mapaMonthOf(i.asOf), -1);
    const day = Number(i.asOf.slice(8, 10));
    const prevMonth = aggregateMonths(i.entries, i.asOf).find((m) => m.month === prev);
    const answered = i.estimates.some((e) => e.month === prev);
    if (prevMonth && prevMonth.closed && prevMonth.entries > 0 && !answered && day <= ESTIMATE_ASK_UNTIL_DAY && !blocked("estimativa_mensal")) {
      out.push({ kind: "estimativa_mensal", reason: "calibragem_do_mes_fechado", priority: 3 });
    }
  }

  out.sort((a, b) => b.priority - a.priority);
  // 1 pergunta por vez: a de maior prioridade; as demais esperam o orçamento.
  const result = out.slice(0, QUESTIONS_PER_DAY);
  if (cfpbDue) result.unshift({ kind: "cfpb", reason: daysSinceCfpb === null ? "primeira_medicao" : "ciclo_de_15_dias", priority: 100 });
  return result;
}
