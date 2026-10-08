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

// "Pix enviado THALES ..." → "THALES ...": a identidade aprendida é o nome da pessoa, não o verbo do extrato.
const PIX_PREFIX = /^\s*(?:pix|ted|doc|transfer[eê]ncia)\s+(?:enviado|enviada|recebido|recebida)\s+(?:para\s+|de\s+)?/i;
const textOf = (item: CategorizableItem) => String(item.merchant || item.description || item.raw_description || "").replace(PIX_PREFIX, "");

/** Kinds que carregam consumo e portanto têm categoria. Estorno herda a categoria do gasto original.
 *  Pix/transferência a pessoa também entra, mas SÓ com o que a pessoa já ensinou (nada de chute por palavra). */
const CATEGORIZABLE_KINDS = new Set(["transaction", "refund", "external_transfer_out"]);
const LEARNED_SOURCES = new Set(["personal", "alias", "history", "user"]);

// deno-lint-ignore no-explicit-any
export async function buildImportCategorizer(sb: any, userId: string, items: CategorizableItem[]): Promise<ImportCategorizer> {
  const eligible = items.filter((i) => CATEGORIZABLE_KINDS.has(String(i.movement_kind ?? "transaction")));
  // Estorno é entrada, mas a categoria dele é a do GASTO original → contexto de despesa.
  const contextTypeOf = (i: CategorizableItem): "income" | "expense" =>
    (i.movement_kind === "refund" || i.movement_kind === "external_transfer_out" ? "expense" : i.type);
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
    if (!result.category_id || result.action !== "auto_apply") return null;
    if (item.movement_kind === "external_transfer_out" && !LEARNED_SOURCES.has(result.category_source)) return null;
    return { category_id: result.category_id, source: result.category_source, confidence: result.category_confidence };
  };
}
