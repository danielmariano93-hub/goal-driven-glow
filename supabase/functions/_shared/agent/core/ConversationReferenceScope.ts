// ConversationReferenceScope
//
// Resolves plural anaphora that points to a concrete list the Nino displayed
// in the immediately previous assistant turn. This is intentionally narrow:
// it does not infer categories from free prose and never manufactures scope.
// Example: after a category ranking, "qual delas mais piorou?" means "among
// those displayed categories", not "among every category in the database".

export type ReferenceHistoryMessage = {
  role: "user" | "assistant" | string;
  content: string;
};

const PLURAL_REFERENCE_RX =
  /\b(?:delas|dentre elas|entre elas|dessas categorias|destas categorias|essas categorias|estas categorias)\b/i;

function normalizedKey(value: string): string {
  return value.toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts labels only from bullet/value pairs rendered by the Nino itself:
 *   • Moradia: R$ 8.655,37
 *   - Alimentação: R$ 1.295,98
 *
 * Requiring both a bullet and R$ keeps this from interpreting arbitrary
 * assistant prose as a category list.
 */
export function extractDisplayedMoneyLabels(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const rx = /^\s*[•\-]\s*(?:\*{1,2})?([^:\n*]{2,80}?)(?:\*{1,2})?\s*:\s*R\$/gmi;
  for (const match of String(text ?? "").matchAll(rx)) {
    const label = String(match[1] ?? "").trim();
    if (!label) continue;
    const key = normalizedKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * Returns the referenced category set only when the current user message uses
 * explicit plural anaphora and a recent assistant turn contains a concrete
 * money-ranked list. Otherwise returns null and leaves semantic routing alone.
 */
export function referencedCategoryScope(
  userText: string,
  history: ReferenceHistoryMessage[],
): string[] | null {
  if (!PLURAL_REFERENCE_RX.test(String(userText ?? ""))) return null;
  for (let i = (history ?? []).length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role !== "assistant") continue;
    const labels = extractDisplayedMoneyLabels(message.content);
    if (labels.length >= 2) return labels.slice(0, 20);
  }
  return null;
}
