// ScopeCarryover (`nino_scope.v2`) — o escopo de categorias sobrevive ao turno.
//
// Causa-raiz que este módulo fecha: `last_analysis.scope` só era gravado quando
// o caminho composto respondia. Um turno respondido pelo fluxo antigo
// ("overview das metas") não deixava rastro, então o turno seguinte
// ("comparando essas categorias…") nascia órfão e virava agregado global.
//
// Aqui qualquer resultado de ferramenta que já resolveu categorias concretas
// (metas por categoria, comparação por categoria, ranking de categorias) devolve
// um escopo herdável. Nenhum número nasce aqui.
// deno-lint-ignore-file no-explicit-any
import type { AnalysisScope } from "./ScopeResolver.ts";

export type ScopeEntity = { id: string; label: string };

function push(out: Map<string, string>, id: unknown, label: unknown) {
  const key = String(id ?? "").trim();
  if (!key) return;
  if (!out.has(key)) out.set(key, String(label ?? "Categoria").trim() || "Categoria");
}

/** Categorias concretas presentes num resultado de ferramenta. */
export function categoriesFromToolResult(result: any): ScopeEntity[] {
  const out = new Map<string, string>();
  const r = result ?? {};

  for (const row of asArray(r.category_goals)) push(out, row?.category_id, row?.category_name ?? row?.name);
  for (const row of asArray(r.categories)) push(out, row?.category_id ?? row?.id, row?.category_name ?? row?.name);
  for (const row of asArray(r.active_category_goals)) push(out, row?.category_id, row?.category_name);
  for (const row of asArray(r.goals)) {
    if (row?.category_id) push(out, row.category_id, row?.category_name ?? row?.name);
  }
  if (r.scope === "category" && r.subject_id) push(out, r.subject_id, r.subject_label);

  return [...out.entries()].map(([id, label]) => ({ id, label }));
}

function asArray(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Escopo herdável extraído do log de ferramentas do turno. Devolve `null`
 * quando nenhuma ferramenta resolveu categorias concretas.
 */
export function scopeFromToolCalls(
  toolCalls: Array<{ tool_name?: string; ok?: boolean; result?: unknown }>,
): AnalysisScope | null {
  const merged = new Map<string, string>();
  for (const call of toolCalls ?? []) {
    if (call?.ok === false) continue;
    for (const e of categoriesFromToolResult(call?.result)) push(merged, e.id, e.label);
  }
  if (!merged.size) return null;
  const entities = [...merged.entries()];
  return {
    entity_type: "category",
    selection: "explicit_ids",
    entity_ids: entities.map(([id]) => id),
    entity_labels: entities.map(([, label]) => label),
    aggregate_scope: "scoped_entities",
    source: "engine_resolved",
    locked: true,
  };
}
