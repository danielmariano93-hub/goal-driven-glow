// SemanticAspectOverlay (`nino_semantic_ir.v4`)
//
// Aplica o ASPECTO TEMPORAL determinístico do turno sobre o IR canonicalizado
// em v3. A causa-raiz: o compilador (LLM) devolvia sempre um recorte pontual, e
// "quanto eu gasto com alimentação por mês?" (hábito) recebia o mesmo tratamento
// de "quanto gastei com alimentação?" (mês corrente parcial). O aspecto NÃO é
// decidido pela LLM: sai do resolver pt-BR, aqui, e desce para cada query.
//
// Regras:
// - sobrescreve queries de fluxo (expense/income) quando o aspecto veio do
//   inferidor legado (`mtd`/`calendar`);
// - quando o próprio texto pede uma janela mensal explícita (ex.: "mês a mês
//   nos últimos 6 meses"), o resolver determinístico também é autoridade sobre
//   as DATAS de um `trend` já emitido pelo compilador. Isso evita séries como
//   26/04–26/09, cujo primeiro bucket mensal nasce artificialmente parcial;
// - uma comparação com baseline estatístico já tem semântica temporal explícita
//   no contrato e NÃO pode ser reinterpretada por palavras como "últimos 3 meses";
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

    // O baseline estatístico é um slot semântico explícito do Turn Contract.
    // Ex.: "agosto acima da média dos últimos 3 meses" significa:
    // target=agosto, baseline=média(maio,junho,julho). O resolver lexical de
    // aspecto enxerga "últimos 3 meses" e tentaria transformar o TARGET numa
    // janela last_n_complete, criando requested_vs_executed_mismatch mesmo com
    // o motor correto. Depois do Brain, isso seria uma segunda autoridade
    // semântica; portanto é proibido.
    const hasExplicitStatisticalBaseline = q.legacy_operation === "compare"
      && q.comparison_baseline === "mean_previous_complete_months"
      && Number.isInteger(q.comparison_baseline_window)
      && Number(q.comparison_baseline_window) >= 2;
    if (hasExplicitStatisticalBaseline) return q;

    // Um sinal habitual inequívoco no texto atual é autoridade sobre um
    // `trend` emitido pelo compilador. Tendência real continua protegida porque
    // o resolver a classifica como `trend`, não como `habitual`.
    const correctsCompilerTrend = (aspect.aspect === "habitual" || aspect.aspect === "last_n_complete")
      && q.time.aspect === "trend";

    // O compilador pode acertar que a operação é `trend`, mas carregar a janela
    // genérica de "últimos N meses" (dia X -> dia X). Quando o resolver
    // determinístico encontrou N buckets mensais explícitos, a janela correta
    // é calendário: primeiro dia do primeiro bucket -> hoje (ou último mês
    // fechado, quando solicitado). Sem isso abril/maio/etc. ficam incomparáveis.
    const correctsExplicitTrendWindow = aspect.aspect === "trend"
      && q.time.aspect === "trend"
      && Number.isInteger(aspect.n)
      && Number(aspect.n) >= 1
      && Boolean(aspect.from)
      && Boolean(aspect.to);

    if (!INFERRED_ASPECTS.has(String(q.time.aspect))
      && !correctsCompilerTrend
      && !correctsExplicitTrendWindow) return q;

    changed.push(q.id);
    const windowed = aspect.aspect === "habitual" || aspect.aspect === "last_n_complete";
    const deterministicMonthlyWindow = aspect.aspect === "trend" && correctsExplicitTrendWindow;
    return {
      ...q,
      time: {
        aspect: aspect.aspect,
        from: aspect.from,
        to: aspect.to,
        n: aspect.n ?? null,
        exclude_partial: windowed || deterministicMonthlyWindow
          ? aspect.exclude_partial
          : q.time.exclude_partial,
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