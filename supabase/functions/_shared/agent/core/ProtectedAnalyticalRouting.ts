// ProtectedAnalyticalRouting (`nino_analytical.v2`) — roteamento FAIL-CLOSED.
//
// Causa-raiz que este módulo fecha (incidente real de 31/08/2026): a frase
// "Comparando essas categorias com o mesmo período do mês anterior" caiu no
// planner LLM porque o plano composto não casou. A LLM então escolheu
// `compare_financial_metric` + `get_financial_snapshot`, perdeu o escopo para
// agregado global e comparou julho contra maio/junho.
//
// Regra de domínio: consulta analítica PROTEGIDA (metas/categorias com
// comparação, principalmente follow-up anafórico) tem exatamente dois desfechos
// possíveis — motor canônico determinístico, ou falha honesta. Nunca fluxo
// legado, nunca escopo global, nunca a LLM inventando o sujeito da pergunta.
import { mentionsGoalScope, mentionsScopeAnaphora, type AnalysisScope } from "./ScopeResolver.ts";

/** Ferramenta canônica única para leitura de desempenho de metas. */
export const GOAL_PERFORMANCE_TOOL = "assess_goal_performance";
export const GOAL_PERFORMANCE_ENGINE = "goal_performance_assessment.v1";

/**
 * Ferramentas que respondem OUTRA pergunta e por isso não podem substituir a
 * leitura canônica de desempenho de metas.
 */
export const FORBIDDEN_SUBSTITUTE_TOOLS = [
  "compare_financial_metric",
  "assess_financial_performance",
  "get_financial_snapshot",
] as const;

/** Allowlist estrita por intenção primária do plano analítico. */
export function allowedEnginesFor(primary_intent: string): string[] {
  return primary_intent === "goal_performance_analysis" ? [GOAL_PERFORMANCE_TOOL] : [];
}

export function isForbiddenSubstitute(primary_intent: string, tool: string): boolean {
  return allowedEnginesFor(primary_intent).length > 0
    && !allowedEnginesFor(primary_intent).includes(tool);
}

const COMPARATIVE = [
  /\bcompar\w*/i,
  /\bversus\b/i,
  /\bvs\b/i,
  /\bem rela[çc][aã]o\b/i,
  /\bcontra\b/i,
  /\bmesmo per[ií]odo\b/i,
  /\bmesmo recorte\b/i,
  /\bm[eê]s (?:passado|anterior)\b/i,
  /\bhist[oó]ric\w*/i,
  /\bevolu\w*/i,
];

/** Anáfora ampliada: "como elas ficaram", "e elas?", "nesse mesmo grupo". */
const EXTRA_ANAPHORA = [
  /\bcomo (?:elas|eles) (?:fic|est|and)\w*/i,
  /\bmesmo grupo\b/i,
  /\bmesmo conjunto\b/i,
];

const CATEGORY_MENTION = /\bcategorias?\b/i;

export type ProtectedAnalyticalClassification = {
  is_protected: boolean;
  comparative: boolean;
  anaphoric: boolean;
  goal_or_category_mention: boolean;
  scope_available: boolean;
  /** Motivo determinístico da classificação — vai para telemetria. */
  reason:
    | "not_comparative"
    | "no_subject"
    | "anaphoric_comparison"
    | "inherited_scope_comparison"
    | "goal_scoped_comparison";
};

function hasCategoryScope(scope?: AnalysisScope | null): boolean {
  return Boolean(scope)
    && scope!.entity_type === "category"
    && (scope!.entity_ids?.length ?? 0) > 0;
}

/**
 * Classificação determinística e reutilizável. Nenhum número, nenhuma LLM.
 */
export function classifyProtectedAnalytical(args: {
  text: string;
  previous_scope?: AnalysisScope | null;
}): ProtectedAnalyticalClassification {
  const text = String(args.text ?? "");
  const comparative = COMPARATIVE.some((rx) => rx.test(text));
  const anaphoric = mentionsScopeAnaphora(text) || EXTRA_ANAPHORA.some((rx) => rx.test(text));
  const goalOrCategory = mentionsGoalScope(text) || CATEGORY_MENTION.test(text);
  const scope_available = hasCategoryScope(args.previous_scope ?? null);

  const base = { comparative, anaphoric, goal_or_category_mention: goalOrCategory, scope_available };

  if (!comparative) return { ...base, is_protected: false, reason: "not_comparative" };
  if (anaphoric) return { ...base, is_protected: true, reason: "anaphoric_comparison" };
  if (scope_available) return { ...base, is_protected: true, reason: "inherited_scope_comparison" };
  if (mentionsGoalScope(text)) return { ...base, is_protected: true, reason: "goal_scoped_comparison" };
  // Comparação global legítima ("compare meu gasto total com o mês passado"):
  // continua no fluxo normal.
  return { ...base, is_protected: false, reason: "no_subject" };
}

/**
 * Fail-closed: a pergunta é protegida, era anafórica e o escopo anterior não
 * existe mais (sessão nova, memória expirada). Pedimos o escopo de volta em vez
 * de responder um agregado que ninguém pediu.
 */
export const PROTECTED_SCOPE_MISSING_REPLY =
  "Você está falando de um conjunto de categorias que eu não tenho mais em mãos nesta conversa, "
  + "e eu não vou trocar isso por um total geral. Me diga quais categorias você quer comparar "
  + "(ou peça o overview das suas metas primeiro) que eu refaço a comparação na sua base.";

/** Falha honesta quando o motor canônico não fecha a leitura protegida. */
export const PROTECTED_ENGINE_FAILURE_REPLY =
  "Não vou te entregar esse número agora: a leitura dessas categorias não fechou com a mesma janela "
  + "de comparação, e qualquer outro atalho responderia uma pergunta diferente da sua. "
  + "Me chame de novo em alguns minutos que eu refaço a conta na sua base.";
