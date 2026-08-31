// ScopeResolver (`nino_composite.v1`) — contrato explícito de ESCOPO.
//
// Causa-raiz que este módulo fecha: "compare essas mesmas categorias" não tinha
// onde morar. O roteador escolhia uma ferramenta e a comparação, sem sujeito,
// caía em "gasto total" — trocando silenciosamente o significado da pergunta.
//
// Aqui o escopo é um objeto de primeira classe: quem são as entidades, de onde
// vieram e se o agregado pode ou não ser global. Nenhum número nasce aqui.

export type ScopeEntityType = "category" | "merchant" | "account" | "card" | "debt" | "goal" | "global";

export type ScopeSelection =
  | "explicit_ids"
  | "categories_with_active_goals"
  | "all"
  | "inherited";

export type AnalysisScope = {
  entity_type: ScopeEntityType;
  selection: ScopeSelection;
  entity_ids: string[];
  entity_labels: string[];
  aggregate_scope: "scoped_entities" | "global";
  source: "user_text" | "engine_resolved" | "inherited_from_turn";
  /** Travado = proibido responder com agregado global. */
  locked: boolean;
};

/** Referências anafóricas a um conjunto de entidades já estabelecido. */
const ANAPHORA_SET = [
  /\bessas?\s+mesmas?\b/i,
  /\bessas?\s+(categorias|despesas|metas|contas)\b/i,
  /\bdessas?\s+(categorias|despesas|metas)\b/i,
  /\bnessas?\b/i,
  /\bnelas?\b/i,
  /\bdelas?\b/i,
  /\bas\s+mesmas\b/i,
  /\bs[oó]\s+as\s+que\b/i,
];

/** O usuário citou explicitamente metas como recorte. */
const GOAL_SCOPED = [
  /\bmetas?\b/i,
  /\bteto\b/i,
  /\bor[çc]amento\b/i,
  /\blimite\s+de\s+gasto/i,
];

export function mentionsScopeAnaphora(text: string): boolean {
  return ANAPHORA_SET.some((rx) => rx.test(String(text ?? "")));
}

export function mentionsGoalScope(text: string): boolean {
  return GOAL_SCOPED.some((rx) => rx.test(String(text ?? "")));
}

export function globalScope(): AnalysisScope {
  return {
    entity_type: "global",
    selection: "all",
    entity_ids: [],
    entity_labels: [],
    aggregate_scope: "global",
    source: "user_text",
    locked: false,
  };
}

export function goalCategoryScope(): AnalysisScope {
  return {
    entity_type: "category",
    selection: "categories_with_active_goals",
    entity_ids: [],
    entity_labels: [],
    aggregate_scope: "scoped_entities",
    source: "user_text",
    locked: true,
  };
}

/**
 * Resolve o escopo do turno. Quando a mensagem é anafórica e existe escopo
 * anterior, ele é HERDADO — nunca substituído por "tudo".
 */
export function resolveScope(args: {
  text: string;
  previous?: AnalysisScope | null;
}): AnalysisScope {
  const text = String(args.text ?? "");
  const previous = args.previous ?? null;

  if (mentionsScopeAnaphora(text) && previous && previous.entity_type !== "global") {
    return {
      ...previous,
      selection: previous.entity_ids.length ? "explicit_ids" : previous.selection,
      source: "inherited_from_turn",
      locked: true,
    };
  }

  if (mentionsGoalScope(text)) return goalCategoryScope();

  if (previous && previous.locked && mentionsScopeAnaphora(text)) {
    return { ...previous, source: "inherited_from_turn" };
  }

  return globalScope();
}

/** Fixa as entidades resolvidas pelo motor (ids canônicos, uma vez só). */
export function bindEntities(
  scope: AnalysisScope,
  entities: Array<{ id: string; label: string }>,
): AnalysisScope {
  return {
    ...scope,
    selection: entities.length ? "explicit_ids" : scope.selection,
    entity_ids: entities.map((e) => e.id),
    entity_labels: entities.map((e) => e.label),
    source: scope.source === "inherited_from_turn" ? scope.source : "engine_resolved",
  };
}

export type ScopeViolation = { gate: "scope_preserved"; expected: string; found: string };

/**
 * ScopePreservationGate: escopo travado NÃO pode ser respondido com agregado
 * global. Devolve `null` quando está tudo certo.
 */
export function checkScopePreservation(
  scope: AnalysisScope,
  aggregate: { scope?: string } | null | undefined,
): ScopeViolation | null {
  if (!scope.locked) return null;
  const found = String(aggregate?.scope ?? "missing");
  if (found === "scoped_entities") return null;
  return { gate: "scope_preserved", expected: "scoped_entities", found };
}
