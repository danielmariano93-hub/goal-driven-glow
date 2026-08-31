// AnalyticalQueryPlanner (`analytical_plan.v1`) — camada de PLANEJAMENTO.
//
// Causa-raiz que este módulo fecha: a arquitetura era "mensagem → 1 intenção →
// 1 ferramenta → resposta". Pergunta composta ("me traga um overview das metas,
// diga se atingi e compare essas mesmas categorias com o mês passado") perdia
// partes inteiras do pedido.
//
// Aqui a pergunta é decomposta em FACETAS + DOMÍNIO + ESCOPO + PERÍODOS, e o
// plano diz quais motores canônicos precisam rodar e quais componentes a
// resposta precisa conter. Determinístico: nada de número, nada de LLM.
import { normalizeIntentText } from "./IntentResolver.ts";
import {
  resolveScope, mentionsGoalScope, mentionsScopeAnaphora, type AnalysisScope,
} from "./ScopeResolver.ts";
import {
  requirement, type Requirement, type RequiredAnswer,
} from "./AnalysisRequirements.ts";
import { comparablePrevious, currentMonthPeriod, resolvePeriodRolesPt, type PeriodRoleContract } from "../../analytics/periodResolver.ts";

export type AnalyticalFacet =
  | "overview"
  | "attainment"
  | "comparison"
  | "aggregate"
  | "interpretation"
  | "ranking"
  | "filter";

export type AnalyticalDomain =
  | "goals"
  | "categories"
  | "spending"
  | "cards"
  | "debts"
  | "wealth"
  | "income";

export type EngineRef = { engine: string; tool: string; args: Record<string, unknown> };

export type AnalyticalPlan = {
  version: "analytical_plan.v1";
  primary_intent: string;
  facets: AnalyticalFacet[];
  domains: AnalyticalDomain[];
  requested_answers: RequiredAnswer[];
  requirements: Requirement[];
  scope: AnalysisScope;
  periods: {
    current: { from: string; to: string; label?: string };
    comparison: { from: string; to: string } | null;
    comparison_basis: "calendar_previous_month" | "preceding_window" | null;
    methodology: string;
    source_span: { current: string; comparison: string | null };
  };
  engines: EngineRef[];
  response_depth: "brief" | "standard" | "analytical";
  resolution: "deterministic" | "llm_assisted";
  composite: boolean;
};

// ------------------------------------------------------- detecção de facetas

const FACET_RX: Array<{ facet: AnalyticalFacet; rx: RegExp }> = [
  { facet: "overview", rx: /\b(overview|vis[aã]o geral|panorama|resumo|todas|todos|geral|consolidad)/i },
  { facet: "attainment", rx: /\b(atingi|atingiu|bati|cumpri|ultrapass|estour|dentro do teto|acima da meta|abaixo da meta|furei)/i },
  { facet: "comparison", rx: /\b(compar|versus|vs|em rela[çc][aã]o|contra|mesmo per[ií]odo|m[eê]s passado|m[eê]s anterior|antes|hist[oó]ric)/i },
  { facet: "aggregate", rx: /\b(total|somat[oó]ri|no conjunto|no agregado|somando|no total)/i },
  { facet: "interpretation", rx: /\b(melhor(ei|ou|ando)?|pior(ei|ou|ando)?|evolu|fiquei abaixo|fiquei acima|vale|significa|estou melhor|estou pior|mesmo)/i },
  { facet: "ranking", rx: /\b(qual (delas )?(mais|menos)|maior|menor|ranking|top|principal)/i },
  { facet: "filter", rx: /\b(s[oó] as que|apenas as que|somente as que|filtra|s[oó] as|apenas)/i },
];

const DOMAIN_RX: Array<{ domain: AnalyticalDomain; rx: RegExp }> = [
  { domain: "goals", rx: /\b(meta|metas|teto|or[çc]amento|limite de gasto)/i },
  { domain: "categories", rx: /\b(categoria|categorias)/i },
  { domain: "spending", rx: /\b(gast|despesa|consumo)/i },
  { domain: "cards", rx: /\b(cart[aã]o|fatura)/i },
  { domain: "debts", rx: /\b(d[ií]vida|devo|parcelamento)/i },
  { domain: "wealth", rx: /\b(patrim[oô]ni|investiment|reserva|poupan)/i },
  { domain: "income", rx: /\b(receita|renda|sal[aá]ri|ganho)/i },
];

export function detectFacets(text: string): AnalyticalFacet[] {
  const raw = String(text ?? "");
  const out: AnalyticalFacet[] = [];
  for (const { facet, rx } of FACET_RX) if (rx.test(raw) && !out.includes(facet)) out.push(facet);
  return out;
}

export function detectDomains(text: string): AnalyticalDomain[] {
  const raw = String(text ?? "");
  const out: AnalyticalDomain[] = [];
  for (const { domain, rx } of DOMAIN_RX) if (rx.test(raw) && !out.includes(domain)) out.push(domain);
  return out;
}

// --------------------------------------------------------------- composição

/** Facetas que, combinadas, exigem mais de um motor canônico. */
const COMPOSITE_FACETS: AnalyticalFacet[] = ["comparison", "aggregate", "interpretation", "ranking"];

function depthOf(facets: AnalyticalFacet[]): AnalyticalPlan["response_depth"] {
  if (facets.length >= 3) return "analytical";
  if (facets.length === 2) return "standard";
  return "brief";
}

export type PlannerInput = {
  text: string;
  now?: Date;
  previous_scope?: AnalysisScope | null;
  /** Período já resolvido pelo turno (ConversationOrchestrator). */
  turn_period?: { from: string; to: string; label?: string } | null;
  period_roles?: PeriodRoleContract | null;
};

/**
 * Plano analítico determinístico. Devolve `null` quando a mensagem não é uma
 * consulta analítica composta — nesse caso o fluxo atual (intenção única)
 * continua valendo integralmente.
 */
export function resolveAnalyticalPlan(input: PlannerInput): AnalyticalPlan | null {
  const now = input.now ?? new Date();
  const text = String(input.text ?? "");
  const normalized = normalizeIntentText(text);
  if (!normalized) return null;

  const facets = detectFacets(text);
  const domains = detectDomains(text);
  if (!domains.length) return null;

  const scope = resolveScope({ text, previous: input.previous_scope ?? null });

  // Domínio por HERANÇA (`nino_scope.v2`): "comparando essas categorias com o
  // mês anterior" não cita a palavra meta, mas continua sendo a mesma análise
  // do turno anterior. Exigir o termo no texto atual era a causa-raiz do desvio
  // para o caminho antigo (escopo global + ferramenta errada).
  const inheritedCategoryScope = scope.source === "inherited_from_turn"
    && scope.entity_type === "category";
  const categoryDomain = domains.includes("categories") || domains.includes("spending");
  const goalDomain = domains.includes("goals")
    || (inheritedCategoryScope && (categoryDomain || mentionsScopeAnaphora(text)));
  const composite = facets.filter((f) => COMPOSITE_FACETS.includes(f)).length >= 1 && facets.length >= 2;

  // Hoje a composição multi-motor coberta de ponta a ponta é metas x evolução.
  // Outros cruzamentos (patrimônio, cartão, dívida) entram por este mesmo
  // contrato quando os motores correspondentes forem plugados em `engines`.
  if (!goalDomain || !composite) return null;

  const roles = input.period_roles ?? resolvePeriodRolesPt(text, now);
  const current = roles.current_period ?? input.turn_period ?? currentMonthPeriod(now);
  const wantsComparison = facets.includes("comparison");
  const comparisonBasis = wantsComparison
    ? (roles.comparison_basis ?? "preceding_window")
    : null;
  const comparison = wantsComparison
    ? (roles.comparison_period ?? comparablePrevious(current))
    : null;

  const requested: RequiredAnswer[] = ["active_goals", "attainment_per_goal"];
  if (wantsComparison) requested.push("historical_comparison_per_entity");
  if (facets.includes("aggregate") || wantsComparison) requested.push("scoped_aggregate");
  if (facets.includes("interpretation") || facets.includes("overview")) requested.push("overall_interpretation");
  if (facets.includes("ranking")) requested.push("ranking");
  requested.push("priority");

  const requirements: Requirement[] = requested.map((key) =>
    requirement(key, key === "attainment_per_goal" || key === "historical_comparison_per_entity" ? "per_entity" : "single")
  );

  const scopedForGoals: AnalysisScope = mentionsGoalScope(text) || scope.entity_type === "category"
    ? { ...scope, entity_type: "category", locked: true, aggregate_scope: "scoped_entities" }
    : scope;

  return {
    version: "analytical_plan.v1",
    primary_intent: "goal_performance_analysis",
    facets,
    domains,
    requested_answers: requested,
    requirements,
    scope: scopedForGoals,
    periods: {
      current,
      comparison,
      comparison_basis: comparisonBasis,
      methodology: wantsComparison
        ? comparisonBasis === "calendar_previous_month"
          ? "Comparação com o mesmo recorte de dias no mês anterior, calculada pelos motores canônicos."
          : "Comparação com a janela imediatamente anterior de mesma duração, calculada pelos motores canônicos."
        : "Recorte do período da meta, calculado pelos motores canônicos.",
      source_span: roles.source_span,
    },
    engines: [{
      engine: "goal_performance_assessment.v1",
      tool: "assess_goal_performance",
      args: {
        current_from: current.from,
        current_to: current.to,
        comparison_from: comparison?.from ?? null,
        comparison_to: comparison?.to ?? null,
        comparison_basis: comparisonBasis,
        category_ids: scopedForGoals.entity_ids.length ? scopedForGoals.entity_ids : null,
      },
    }],
    response_depth: depthOf(facets),
    resolution: "deterministic",
    composite: true,
  };
}
