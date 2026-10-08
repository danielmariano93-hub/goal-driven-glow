// Categorização de itens de importação (Open Finance, lista, WhatsApp em lote) com a MESMA camada
// que o resto do Nino usa: preferência pessoal, alias confirmado, histórico do usuário, marca
// canônica, conhecimento global e catálogo. Antes o lote só usava a dica do próprio documento e
// chegava "Sem categoria" mesmo para estabelecimentos que o Nino já conhece.
//
// Só aplica quando o motor central decide `auto_apply` (a mesma barreira de confiança do PDF).
// Falha de leitura nunca derruba a importação: o item segue sem categoria para revisão.
import { classifyWithContext, loadCategorizationContext, type CategorizationContext } from "./engine.ts";
import { derivePersonalPreferencesFromHistory } from "./personalHistory.ts";
import { storageMerchantKey } from "./normalize.ts";

export type CategorizableItem = { type: "income" | "expense"; movement_kind?: string | null; description: string; raw_description?: string | null; merchant?: string | null };
export type CategoryPick = { category_id: string; source: string; confidence: number };
export type ImportCategorizer = (item: CategorizableItem) => CategoryPick | null;

const textOf = (item: CategorizableItem) => String(item.merchant || item.description || item.raw_description || "");

/** Kinds que carregam consumo e portanto têm categoria. Estorno herda a categoria do gasto original. */
const CATEGORIZABLE_KINDS = new Set(["transaction", "refund"]);

// deno-lint-ignore no-explicit-any
export async function buildImportCategorizer(sb: any, userId: string, items: CategorizableItem[]): Promise<ImportCategorizer> {
  const eligible = items.filter((i) => CATEGORIZABLE_KINDS.has(String(i.movement_kind ?? "transaction")));
  // Estorno é entrada, mas a categoria dele é a do GASTO original → contexto de despesa.
  const contextTypeOf = (i: CategorizableItem): "income" | "expense" => (i.movement_kind === "refund" ? "expense" : i.type);
  const contexts = new Map<"income" | "expense", CategorizationContext>();

  for (const type of ["expense", "income"] as const) {
    const group = eligible.filter((i) => contextTypeOf(i) === type);
    if (group.length === 0) continue;
    const keys = group.map((i) => storageMerchantKey(textOf(i)));
    const context = await loadCategorizationContext(sb, userId, type, keys);
    // Verdade pessoal por histórico: estabelecimento já categorizado em lançamentos confirmados.
    const derived = await derivePersonalPreferencesFromHistory(sb, userId, type, group.map(textOf)).catch(() => []);
    const valid = new Set(context.candidates.map((c) => c.id));
    const known = new Set((context.preferences ?? []).map((p) => p.merchant_key));
    for (const row of derived) {
      if (row.category_id && valid.has(row.category_id) && !known.has(row.merchant_key)) (context.preferences ??= []).push(row);
    }
    contexts.set(type, context);
  }

  return (item) => {
    if (!CATEGORIZABLE_KINDS.has(String(item.movement_kind ?? "transaction"))) return null;
    const type = contextTypeOf(item);
    const context = contexts.get(type);
    if (!context) return null;
    const result = classifyWithContext({
      type, description: textOf(item), explicit_category: null,
      // Estorno consulta o motor como gasto comum (a regra de estorno do motor corta a marca do texto).
      movement_kind: "transaction",
    }, context);
    return result.category_id && result.action === "auto_apply"
      ? { category_id: result.category_id, source: result.category_source, confidence: result.category_confidence }
      : null;
  };
}
