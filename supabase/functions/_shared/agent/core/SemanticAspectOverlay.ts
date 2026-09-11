// SemanticAspectOverlay (`nino_semantic_ir.v4`)
//
// Aplica o ASPECTO TEMPORAL determinístico do turno sobre o IR canonicalizado
// em v3. A causa-raiz: o compilador (LLM) devolvia sempre um recorte pontual, e
// "quanto eu gasto com alimentação por mês?" (hábito) recebia o mesmo tratamento
// de "quanto gastei com alimentação?" (mês corrente parcial). O aspecto NÃO é
// decidido pela LLM: sai do resolver pt-BR, aqui, e desce para cada query.
//
// Regras:
// - só sobrescreve queries de fluxo (expense/income) cujo aspecto veio do
//   inferidor legado (`mtd`/`calendar`) — aspecto declarado explicitamente é
//   respeitado;
// - habitual/last_n_complete SEMPRE excluem o mês parcial e viram grão mensal;
// - a premissa entra em `assumptions`, para a resposta poder declarar a régua.
import type { FinancialQueryIRv3, FinancialQueryV3 } from "./FinancialIRv3.ts";
import { resolveTimeAspectPt, type ResolvedTimeAspect } from "../../analytics/periodResolver.ts";

const FLOW_METRICS = new Set(["expense_amount", "income_amount"]);
const INFERRED_ASPECTS = new Set(["mtd", "calendar"]);

export type AspectOverlayResult = {
  ir: FinancialQueryIRv3;
  applied: boolean;
  aspect: ResolvedTimeAspect;
  changed_queries: string[];
};

export function applyTurnAspect(
  ir: FinancialQueryIRv3,
  text: string,
  now: Date = new Date(),
): AspectOverlayResult {
  const aspect = resolveTimeAspectPt(text, now);
  const changed: string[] = [];

  if (aspect.aspect === "mtd" || aspect.aspect === "calendar") {
    return { ir, applied: false, aspect, changed_queries: [] };
  }

  const queries: FinancialQueryV3[] = ir.queries.map((q) => {
    if (!FLOW_METRICS.has(String(q.metric))) return q;
    // Um sinal habitual inequívoco no texto atual é autoridade sobre um
    // `trend` emitido pelo compilador. Tendência real continua protegida porque
    // o resolver a classifica como `trend`, não como `habitual`.
    const correctsCompilerTrend = (aspect.aspect === "habitual" || aspect.aspect === "last_n_complete")
      && q.time.aspect === "trend";
    if (!INFERRED_ASPECTS.has(String(q.time.aspect)) && !correctsCompilerTrend) return q;
    changed.push(q.id);
    const windowed = aspect.aspect === "habitual" || aspect.aspect === "last_n_complete";
    return {
      ...q,
      time: {
        aspect: aspect.aspect,
        from: aspect.from,
        to: aspect.to,
        n: aspect.n ?? null,
        exclude_partial: windowed ? true : q.time.exclude_partial,
        label: aspect.label,
      },
      grain: windowed || aspect.aspect === "trend" ? "month" : q.grain,
      reduce: aspect.reduce ?? q.reduce,
    };
  });

  if (!changed.length) return { ir, applied: false, aspect, changed_queries: [] };

  return {
    ir: {
      ...ir,
      queries,
      assumptions: [...new Set([...ir.assumptions, ...(aspect.assumption ? [aspect.assumption] : [])])],
    },
    applied: true,
    aspect,
    changed_queries: changed,
  };
}
