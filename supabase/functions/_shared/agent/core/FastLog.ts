// FastLog — palavra-mágica que registra um lançamento em um único turno,
// sem passar pela etapa de confirmação. Preserva a segurança:
//   - só grava se o parser conseguir extrair valor + método/descrição;
//   - se faltar algo obrigatório, devolve uma pergunta única (nunca inventa).
// Registra as chamadas em `agent_tool_calls` para auditoria.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { interpret } from "../parser.ts";
import { extractSpans } from "../extract.ts";
import {
  create_transaction_draft, create_transfer_draft, add_goal_contribution_draft,
  confirm_pending_action, type ToolContext, type ToolResult,
} from "../tools.ts";

export const DEFAULT_FAST_LOG_TOKEN = "!ja";

function escapeRx(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Palavras que confundiriam com fala natural — proibidas como token.
// "ja" é intencionalmente permitido: é o default (`!ja`).
const RESERVED_BARE = new Set([
  "sim","nao","não","ok","pode","confirma","confirmar","confirmado",
  "cancela","cancelar","registra","registrar","registro","gasto","gastei",
  "conta","paguei","comprei","recebi",
]);


/**
 * Regras de validação de token:
 *  - obrigatório iniciar com `!`, `#` ou `/`;
 *  - `bare` (sem o prefixo) precisa ter 2–12 chars em `[a-z0-9]`;
 *  - `bare` não pode ser palavra reservada nem casar `^\d+[a-z]?$`
 *    (bloqueia prefixos que sistemas externos costumam antepor, ex. "1908A").
 */
export function isValidFastLogToken(tk: unknown): boolean {
  const s = String(tk ?? "").trim();
  if (!/^[!#/][A-Za-z0-9]{2,12}$/.test(s)) return false;
  const bare = s.slice(1).toLowerCase();
  if (RESERVED_BARE.has(bare)) return false;
  if (/^\d+[a-z]?$/.test(bare)) return false;
  return true;
}

export type FastLogDetection = { triggered: boolean; cleanText: string; token: string };

/** Detecta `!ja` / `#ja` / `/ja` (ou token custom) no começo ou fim do texto. */
export function detectFastLog(text: string, token: string = DEFAULT_FAST_LOG_TOKEN): FastLogDetection {
  const raw = String(text ?? "");
  const rawTk = String(token ?? "").trim();
  // Se o token custom não passar na validação, ignora e usa o padrão.
  const tk = isValidFastLogToken(rawTk) ? rawTk : DEFAULT_FAST_LOG_TOKEN;
  const bareToken = tk.replace(/^[!#/]/, "");
  const alts = Array.from(new Set([tk, `!${bareToken}`, `#${bareToken}`, `/${bareToken}`]))
    .filter(Boolean).map(escapeRx).join("|");
  const rx = new RegExp(`(?:^\\s*(?:${alts})\\s+)|(?:\\s+(?:${alts})\\s*$)`, "i");
  if (!rx.test(raw)) return { triggered: false, cleanText: raw, token: tk };
  const cleanText = raw.replace(rx, " ").trim();
  return { triggered: true, cleanText, token: tk };
}

export async function loadFastLogToken(sb: SupabaseClient, user_id: string): Promise<string> {
  try {
    const { data } = await sb.from("user_ai_preferences")
      .select("fast_log_token").eq("user_id", user_id).maybeSingle();
    const v = (data as any)?.fast_log_token;
    // Só retorna o token do banco se for válido — senão usa o default e evita
    // que valores tóxicos herdados (ex.: prefixo automático do WhatsApp) façam
    // toda mensagem disparar FastLog.
    return isValidFastLogToken(v) ? String(v).trim() : DEFAULT_FAST_LOG_TOKEN;
  } catch { return DEFAULT_FAST_LOG_TOKEN; }
}


export type FastLogOutcome = {
  handled: boolean;
  reply?: string;
  reply_kind?: "receipt" | "question" | "info";
  draft_id?: string;
  tool_calls?: Array<{ step_index: number; tool_name: string; args: any; result: any; ok: boolean; duration_ms: number; error: string | null }>;
};

/** Executa o fluxo direto: rascunho → confirmação, em uma única passada. */
export async function runFastLog(
  sb: SupabaseClient,
  input: { user_id: string; conversation_id: string; cleanText: string },
): Promise<FastLogOutcome> {
  const ctx: ToolContext = {
    sb, user_id: input.user_id, conversation_id: input.conversation_id, user_text: input.cleanText,
  };
  const spans = extractSpans(input.cleanText);
  const intent = interpret(input.cleanText);
  const calls: NonNullable<FastLogOutcome["tool_calls"]> = [];
  let step = 0;

  async function record(name: string, args: any, res: ToolResult, started: number) {
    calls.push({
      step_index: step++, tool_name: name, args, result: res.ok ? (res as any).result : null,
      ok: res.ok, duration_ms: Date.now() - started, error: res.ok ? null : (res as any).error,
    });
  }

  // Transferência estruturada
  if (intent.kind === "transfer") {
    const t0 = Date.now();
    const draft = await create_transfer_draft(ctx, {
      amount: intent.amount, from_account: intent.from_hint ?? "", to_account: intent.to_hint ?? "",
      occurred_at: intent.occurred_at,
    });
    await record("create_transfer_draft", { amount: intent.amount, from_account: intent.from_hint, to_account: intent.to_hint }, draft, t0);
    if (!draft.ok) return { handled: true, reply: "Escreva assim: “!ja transferir 100 de Nubank para Itaú”.", reply_kind: "question", tool_calls: calls };
    const t1 = Date.now();
    const conf = await confirm_pending_action(ctx, { id: (draft.result as any).draft_id });
    await record("confirm_pending_action", { id: (draft.result as any).draft_id }, conf, t1);
    if (!conf.ok) return { handled: true, reply: "Consegui preparar mas não deu para confirmar agora. Tente novamente.", reply_kind: "info", tool_calls: calls };
    return { handled: true, reply: String((conf.result as any).receipt), reply_kind: "receipt", draft_id: (conf.result as any).draft_id, tool_calls: calls };
  }

  // Aporte em meta
  if (intent.kind === "goal_contribution" && intent.goal_hint) {
    const t0 = Date.now();
    const draft = await add_goal_contribution_draft(ctx, { goal: intent.goal_hint, amount: intent.amount, occurred_at: intent.occurred_at });
    await record("add_goal_contribution_draft", { goal: intent.goal_hint, amount: intent.amount }, draft, t0);
    if (!draft.ok) return { handled: true, reply: "Não achei essa meta. Confere o nome dela e tenta de novo.", reply_kind: "question", tool_calls: calls };
    const t1 = Date.now();
    const conf = await confirm_pending_action(ctx, { id: (draft.result as any).draft_id });
    await record("confirm_pending_action", { id: (draft.result as any).draft_id }, conf, t1);
    if (!conf.ok) return { handled: true, reply: "Preparei o aporte mas não consegui confirmar. Tente novamente.", reply_kind: "info", tool_calls: calls };
    return { handled: true, reply: String((conf.result as any).receipt), reply_kind: "receipt", draft_id: (conf.result as any).draft_id, tool_calls: calls };
  }

  // Transação (padrão)
  const amount = spans.amount ?? (intent.kind === "transaction" ? intent.amount : null);
  if (!amount || amount <= 0) {
    return { handled: true, reply: "Não consegui identificar o valor. Ex.: “!ja gastei 42,90 no almoço no Nubank”.", reply_kind: "question", tool_calls: calls };
  }
  const type: "income" | "expense" =
    intent.kind === "transaction" ? intent.type
    : /\b(recebi|ganhei|entrou|sal[aá]rio)\b/i.test(input.cleanText) ? "income" : "expense";

  const isCard = spans.payment_method === "credit_card";
  const description = spans.description || (intent.kind === "transaction" ? intent.description : undefined);
  const accountHint = spans.payment_method === "account"
    ? (spans.account_hint ?? "")
    : (intent.kind === "transaction" ? (intent.account_hint ?? "") : "");

  if (!isCard && !accountHint) {
    return { handled: true, reply: "Em qual conta eu registro? (ex.: Nubank, Itaú, Carteira)", reply_kind: "question", tool_calls: calls };
  }

  const t0 = Date.now();
  const draft = await create_transaction_draft(ctx, {
    type, amount,
    account: isCard ? undefined : accountHint,
    credit_card: isCard ? (spans.card_hint ?? "") : undefined,
    installments_total: spans.installments_total ?? undefined,
    category: spans.category_hint ?? (intent.kind === "transaction" ? intent.category_hint : undefined),
    occurred_at: spans.occurred_at ?? (intent.kind === "transaction" ? intent.occurred_at : undefined),
    description,
  });
  await record("create_transaction_draft", { type, amount }, draft, t0);
  if (!draft.ok) {
    if (draft.error === "account_not_found") return { handled: true, reply: "Em qual conta eu registro? (ex.: Nubank, Itaú, Carteira)", reply_kind: "question", tool_calls: calls };
    if (draft.error === "card_not_found") return { handled: true, reply: "Em qual cartão eu registro?", reply_kind: "question", tool_calls: calls };
    if (draft.error === "needs_description") return { handled: true, reply: "Faltou a descrição. Em quê foi essa compra?", reply_kind: "question", tool_calls: calls };
    return { handled: true, reply: "Não consegui registrar direto. Tente descrever com mais detalhes.", reply_kind: "info", tool_calls: calls };
  }
  const draftId = (draft.result as any).draft_id as string;
  const t1 = Date.now();
  const conf = await confirm_pending_action(ctx, { id: draftId });
  await record("confirm_pending_action", { id: draftId }, conf, t1);
  if (!conf.ok) {
    return { handled: true, reply: "Preparei o lançamento mas não consegui confirmar agora. Tente novamente.", reply_kind: "info", tool_calls: calls };
  }
  return {
    handled: true,
    reply: String((conf.result as any).receipt),
    reply_kind: "receipt",
    draft_id: (conf.result as any).draft_id,
    tool_calls: calls,
  };
}
