// SemanticClarificationOptions (`nino_semantic_ir.v3`)
//
// Opções de clarificação vêm SEMPRE do banco do usuário — nunca da LLM. Se o
// Nino pergunta "qual cartão?", os nomes oferecidos existem de fato; um nome
// inventado seria uma alucinação disfarçada de pergunta.
import { MAX_CLARIFICATION_OPTIONS, normalizeSlot, type ClarificationSlot } from "./ClarificationResponse.ts";

export type ClarificationOptionSet = {
  slot: ClarificationSlot;
  options: string[];
  source: "database" | "static" | "empty";
};

const PERIOD_OPTIONS = ["este mês", "mês passado", "últimos 3 meses"];

async function names(
  sb: any,
  table: string,
  userId: string,
  extra?: (q: any) => any,
): Promise<string[]> {
  try {
    let q = sb.from(table).select("name").eq("user_id", userId).order("name").limit(MAX_CLARIFICATION_OPTIONS);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) return [];
    return [...new Set((data ?? []).map((r: any) => String(r?.name ?? "").trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Carrega as opções reais do slot. Falha de leitura devolve lista vazia — a
 * pergunta continua honesta, apenas sem sugestões. */
export async function loadClarificationOptions(args: {
  sb: any;
  user_id: string;
  slot: string;
}): Promise<ClarificationOptionSet> {
  const slot = normalizeSlot(args.slot);
  if (slot === "period") return { slot, options: PERIOD_OPTIONS, source: "static" };
  if (!args.sb || !args.user_id) return { slot, options: [], source: "empty" };

  let options: string[] = [];
  if (slot === "card") options = await names(args.sb, "credit_cards", args.user_id, (q) => q.is("archived_at", null));
  else if (slot === "account") options = await names(args.sb, "accounts", args.user_id, (q) => q.eq("active", true));
  else if (slot === "category") options = await names(args.sb, "categories", args.user_id, (q) => q.is("archived_at", null));
  else if (slot === "goal") options = await names(args.sb, "goals", args.user_id);

  return {
    slot,
    options: options.slice(0, MAX_CLARIFICATION_OPTIONS),
    source: options.length ? "database" : "empty",
  };
}
