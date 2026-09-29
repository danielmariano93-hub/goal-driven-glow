// DeterministicConversationFastPath
//
// Narrow, fail-closed interpretation for high-confidence Portuguese-BR turns.
// The goal is not to replace semantic AI; it is to avoid spending provider
// quota on intents whose meaning is already explicit and structurally known.
// Anything even slightly ambiguous returns null and keeps the normal V3 path.

import {
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "./ConversationTurnContract.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import { detectCategory } from "./ConversationMemory.ts";
import { interpret as interpretDeterministic, type ParsedIntent } from "../parser.ts";

export type DeterministicFastPathInput = {
  text: string;
  memory: ConversationMemory | null;
};

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function brNumber(raw: string): number | null {
  let s = String(raw ?? "").trim().replace(/^r\$\s*/i, "");
  const scale = /\b(mil|k|mi|milhao|milhoes|milhão|milhões)\b/i.exec(s)?.[1] ?? "";
  s = s.replace(/\b(mil|k|mi|milhao|milhoes|milhão|milhões)\b/ig, "").trim();
  s = s.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  const token = norm(scale);
  if (token === "mil" || token === "k") n *= 1_000;
  if (["mi", "milhao", "milhoes"].includes(token)) n *= 1_000_000;
  return Math.round(n * 100) / 100;
}

function amounts(text: string): number[] {
  const matches = [...String(text ?? "").matchAll(/r\$\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(mil|k|mi|milh(?:ã|a)o(?:es)?|milh[oõ]es))?/gi)];
  const out = matches.map((m) => brNumber(`${m[1]} ${m[2] ?? ""}`)).filter((v): v is number => v != null);
  if (out.length) return out;
  const plain = String(text ?? "").match(/\b(\d+(?:[.,]\d{1,2})?)\b/);
  const value = plain ? brNumber(plain[1]) : null;
  return value == null ? [] : [value];
}

function actionContract(args: {
  text: string;
  action: string;
  slots: Record<string, unknown>;
  inherit?: boolean;
  reference?: { target: "debt" | "goal" | "category" | "merchant" | "generic"; expression: string } | null;
}): CanonicalConversationTurnContract | null {
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: args.inherit ? "follow_up" : "new_request",
    mode: "write",
    domain: "financial_write",
    canonical_request: args.text,
    inherit_focus: !!args.inherit,
    focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
    action: { action: args.action, slots: args.slots },
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: args.reference ? "resolved" : "not_applicable",
      time: "not_applicable",
      entity: args.reference ? "resolved" : "not_applicable",
      action: "resolved",
    },
    reference: args.reference ? {
      kind: "previous_entity",
      target: args.reference.target,
      expression: args.reference.expression,
      status: "resolved",
    } : null,
    financial_read: null,
    advisory_kind: null,
  });
}

function readContract(args: {
  text: string;
  metric: "expense_amount" | "income_amount" | "balance" | "net_worth" | "debt_balance" | "goal_progress" | "future_installments" | "financial_health";
  operation?: "value" | "sum" | "rank" | "breakdown" | "compare" | "trend" | "forecast" | "explain";
  groupBy?: Array<"category" | "merchant" | "card" | "account" | "month" | "weekday">;
  filters?: Array<{ field: "category" | "merchant" | "card" | "account" | "payment_method"; value: string }>;
  period?: string | null;
  inherit?: boolean;
  reference?: { target: "debt" | "goal" | "category" | "merchant" | "generic"; expression: string } | null;
}): CanonicalConversationTurnContract | null {
  const filters = (args.filters ?? []).map((f) => ({ ...f, op: "eq" }));
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: args.inherit ? "follow_up" : "new_request",
    mode: "read",
    domain: "financial_read",
    canonical_request: args.text,
    inherit_focus: !!args.inherit,
    focus: {
      category: filters.find((f) => f.field === "category")?.value ?? null,
      merchant: filters.find((f) => f.field === "merchant")?.value ?? null,
      goal: null,
      period_expression: args.period ?? null,
      period_expressions: args.period ? [args.period] : [],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: args.reference ? "resolved" : "not_applicable",
      time: args.period ? "resolved" : "not_applicable",
      entity: filters.length || args.reference ? "resolved" : "not_applicable",
      action: "not_applicable",
    },
    reference: args.reference ? {
      kind: "previous_entity",
      target: args.reference.target,
      expression: args.reference.expression,
      status: "resolved",
    } : null,
    financial_read: {
      intent: "lookup",
      queries: [{
        metric: args.metric,
        operation: args.operation ?? "value",
        group_by: args.groupBy ?? [],
        filters,
        limit: null,
        comparison_direction: "any",
        comparison_baseline: "period",
        comparison_baseline_window: null,
        comparison_baseline_expression: null,
        comparison_target_expression: null,
      }],
    },
    advisory_kind: null,
  });
}

function activeReference(memory: ConversationMemory | null, target: string): boolean {
  return !!memory?.references?.some((ref) => ref.status === "active" && ref.target === target);
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSpendingContext(memory: ConversationMemory | null): boolean {
  if (!memory || memory.previous_intent !== "read") return false;
  const summary = norm(memory.conversation_summary);
  const topic = norm(memory.current_topic);
  return /\b(?:gast|despes|consumo)\w*\b/.test(`${summary} ${topic}`)
    || Boolean(memory.active_category || memory.active_merchant);
}

function activePeriodExpression(memory: ConversationMemory | null): string | null {
  const from = String(memory?.active_period?.from ?? "");
  const to = String(memory?.active_period?.to ?? "");
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(from) || !/^20\d{2}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  return `${from}..${to}`;
}

function namedAfter(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  const value = match?.[1]?.trim().replace(/[?.!,;]+$/, "") ?? "";
  return value || null;
}

function debtFastPath(input: DeterministicFastPathInput): CanonicalConversationTurnContract | null {
  const text = String(input.text ?? "").trim();
  const t = norm(text);
  const money = amounts(text)[0] ?? null;
  const debtName = namedAfter(text, /d[ií]vida\s+(?:do|da|com)\s+(.+?)(?:\s+(?:inteira|inteiro|toda|todo|hoje))?[?.!]*$/i);
  const anaphora = /\b(?:essa|dessa|nessa|nesta|aquela|dela|ela)\b/i.test(text) && activeReference(input.memory, "debt");

  if (/\b(?:quita|quitar|quitei)\b/.test(t) && /\bdivida\b/.test(t)) {
    if (!debtName && !anaphora) return null;
    return actionContract({
      text,
      action: "debt.pay",
      slots: { ...(debtName ? { debt: debtName } : {}), full_payment: true },
      inherit: anaphora,
      reference: anaphora ? { target: "debt", expression: text } : null,
    });
  }

  if (/\b(?:paguei|paga|pague|registre|registrar)\b/.test(t)
    && (t.includes("divida") || anaphora) && money != null && money > 0) {
    if (!debtName && !anaphora) return null;
    return actionContract({
      text,
      action: "debt.pay",
      slots: { ...(debtName ? { debt: debtName } : {}), amount: money },
      inherit: anaphora,
      reference: anaphora ? { target: "debt", expression: text } : null,
    });
  }

  const debtRead = /\b(?:quais?\s+(?:as\s+)?dividas?|quanto\s+(?:eu\s+)?devo|saldo\s+(?:das?\s+)?dividas?|parcelas?\s+(?:das?\s+)?dividas?|dividas?\s+vencidas?|vencimentos?\s+(?:das?\s+)?dividas?)\b/.test(t);
  const debtFollowup = /\b(?:quanto\s+falta|quando\s+vence|proxima\s+parcela|saldo)\b/.test(t)
    && /\b(?:essa|dessa|nessa|dela|ela|divida)\b/.test(t);
  if (debtRead || debtFollowup) {
    const ref = debtFollowup && activeReference(input.memory, "debt")
      ? { target: "debt" as const, expression: text }
      : null;
    return readContract({ text, metric: "debt_balance", inherit: !!ref, reference: ref });
  }
  return null;
}

function goalFastPath(input: DeterministicFastPathInput): CanonicalConversationTurnContract | null {
  const text = String(input.text ?? "").trim();
  const t = norm(text);
  const vals = amounts(text);

  if (/\b(?:quais?|mostra|liste|listar)\b.*\bmetas?\b/.test(t)
    || /\bmetas?\b.*\b(?:quanto\s+falta|progresso|andamento)\b/.test(t)) {
    return readContract({ text, metric: "goal_progress" });
  }

  if (/\b(?:cria|crie|criar)\b.*\bmeta\b/.test(t) && vals.length >= 2
    && /\b(?:ja|tambem)\b.*\b(?:coloca|coloque|aporta|aporte|guarda|guarde)\b/.test(t)) {
    const name = namedAfter(text, /meta\s+(.+?)\s+(?:de|no\s+valor\s+de)\s+r\$/i);
    if (!name || vals[0] <= 0 || vals[1] <= 0) return null;
    const targetDateExpression = namedAfter(text, /\b(?:at[eé]|para)\s+(.+?)\s+e\s+j[aá]\b/i);
    return actionContract({
      text,
      action: "goal.create",
      slots: {
        name,
        target_amount: vals[0],
        initial_contribution: vals[1],
        ...(targetDateExpression ? { target_date_expression: targetDateExpression } : {}),
      },
    });
  }

  const update = /\b(?:altera|alterar|muda|mudar|ajusta|ajustar)\b.*\bmeta\s+(.+?)\s+(?:para|pra)\s+r\$/i.exec(text);
  if (update && vals[0] != null && vals[0] > 0) {
    return actionContract({ text, action: "goal.update", slots: { goal: update[1].trim(), target_amount: vals[0] } });
  }

  const remove = /\b(?:exclui|excluir|apaga|apagar|remove|remover)\b.*\bmeta\s+(.+?)[?.!]*$/i.exec(text);
  if (remove?.[1]?.trim()) return actionContract({ text, action: "goal.delete", slots: { goal: remove[1].trim() } });

  const contribute = /\b(?:coloca|coloque|aporta|aporte|guardei|poupei|separei)\b/i.test(text)
    && /\bmeta\b/i.test(text) && vals[0] != null && vals[0] > 0;
  if (contribute) {
    const goal = namedAfter(text, /meta\s+(.+?)[?.!]*$/i);
    if (goal) return actionContract({ text, action: "goal.contribute", slots: { goal, amount: vals[0] } });
  }
  return null;
}

function categoryFastPath(input: DeterministicFastPathInput): CanonicalConversationTurnContract | null {
  const text = String(input.text ?? "").trim();
  const create = /\b(?:cria|crie|criar)\b.*\bcategoria(?:\s+chamada)?\s+(.+?)[?.!]*$/i.exec(text);
  if (create?.[1]?.trim()) return actionContract({ text, action: "category.create", slots: { name: create[1].trim() } });

  const rename = /\b(?:renomeia|renomear|muda\s+o\s+nome\s+da)\b.*\bcategoria\s+(.+?)\s+(?:para|pra)\s+(.+?)[?.!]*$/i.exec(text);
  if (rename?.[1]?.trim() && rename?.[2]?.trim()) {
    return actionContract({ text, action: "category.update", slots: { category: rename[1].trim(), new_name: rename[2].trim() } });
  }

  const remove = /\b(?:exclui|excluir|apaga|apagar|remove|remover)\b.*\bcategoria\s+(.+?)[?.!]*$/i.exec(text);
  if (remove?.[1]?.trim()) return actionContract({ text, action: "category.delete", slots: { category: remove[1].trim() } });
  return null;
}

function recurringFastPath(input: DeterministicFastPathInput): CanonicalConversationTurnContract | null {
  const text = String(input.text ?? "").trim();
  const t = norm(text);
  const vals = amounts(text);
  const recurringSignal = /\b(?:recorrente|todo\s+mes|todo\s+dia\s+\d+|mensalmente|assinatura)\b/.test(t);
  if (!recurringSignal) return null;

  if (/\b(?:cancela|cancelar|exclui|excluir|remove|remover)\b/.test(t)) {
    const name = namedAfter(text, /(?:recorr[eê]ncia|assinatura)\s+(?:da|do|de)?\s*(.+?)[?.!]*$/i);
    if (name) return actionContract({ text, action: "recurring.delete", slots: { recurring: name } });
  }

  if (/\b(?:muda|mudar|altera|alterar|ajusta|ajustar)\b/.test(t) && vals[0] != null) {
    const name = namedAfter(text, /(?:recorr[eê]ncia|assinatura)\s+(?:da|do|de)?\s*(.+?)\s+(?:para|pra)\s+r\$/i);
    if (name) return actionContract({ text, action: "recurring.update", slots: { recurring: name, amount: vals[0] } });
  }

  if (/\b(?:registra|registre|lan[cç]a|lan[cç]ar|cria|criar)\b/.test(t) && vals[0] != null && vals[0] > 0) {
    const day = Number(/\b(?:dia|no\s+dia)\s+(\d{1,2})\b/i.exec(text)?.[1] ?? 0);
    const name = namedAfter(text, /(?:de|do|da)\s+([\p{L}\d][\p{L}\d ._-]*?)(?:\s+como\s+(?:assinatura\s+)?recorrente|\s+todo\s+dia|\s+todo\s+m[eê]s|[?.!]*$)/iu)
      ?? namedAfter(text, /(?:registra|registre|lan[cç]a|cria)\s+r\$[^\s]+\s+de\s+(.+?)[?.!]*$/i);
    if (!name) return null;
    return actionContract({
      text,
      action: "recurring.create",
      slots: {
        name,
        amount: vals[0],
        kind: "expense",
        frequency: "monthly",
        ...(day >= 1 && day <= 31 ? { day_of_month: day } : {}),
      },
    });
  }
  return null;
}

function splitFastPath(input: DeterministicFastPathInput): CanonicalConversationTurnContract | null {
  const text = String(input.text ?? "").trim();
  const vals = amounts(text);
  const match = /^(?:o\s+)?([\p{L}][\p{L} .'-]{1,60}?)\s+(?:j[aá]\s+)?me\s+pagou\b/iu.exec(text);
  if (!match || vals[0] == null || vals[0] <= 0 || !/\b(?:rol[eê]|divis[aã]o|jantar|almo[cç]o|viagem)\b/i.test(text)) return null;
  const split = namedAfter(text, /(?:da|do)\s+(?:divis[aã]o\s+do\s+|rol[eê]\s+do\s+)?(.+?)[?.!]*$/i);
  return actionContract({
    text,
    action: "split.receive",
    slots: { participant: match[1].trim(), amount: vals[0], ...(split ? { split } : {}) },
  });
}

function transactionMaintenanceFastPath(input: DeterministicFastPathInput): CanonicalConversationTurnContract | null {
  const text = String(input.text ?? "").trim();
  const vals = amounts(text);
  const remove = /\b(?:exclui|excluir|apaga|apagar|remove|remover)\b.*\b(?:lan[cç]amento|gasto|despesa|transa[cç][aã]o)\s+(.+?)[?.!]*$/i.exec(text);
  if (remove?.[1]?.trim()) return actionContract({ text, action: "transaction.delete", slots: { transaction: remove[1].trim() } });

  const changeAmount = /\b(?:corrige|corrigir|altera|alterar|muda|mudar)\b\s+(.+?)\s+(?:para|pra)\s+r\$/i.exec(text);
  if (changeAmount?.[1]?.trim() && vals[0] != null && vals[0] > 0) {
    return actionContract({ text, action: "transaction.update", slots: { transaction: changeAmount[1].trim(), amount: vals[0] } });
  }

  const recat = /\b(?:corrige|corrigir|muda|mudar|altera|alterar)\b.*\b(?:lan[cç]amento|gasto|despesa)\s+(.+?)\s+(?:de\s+)?([\p{L} ]+?)\s+(?:para|pra|→|->)\s+([\p{L} ]+?)[?.!]*$/iu.exec(text);
  if (recat?.[1]?.trim() && recat?.[3]?.trim()) {
    return actionContract({ text, action: "transaction.update", slots: { transaction: recat[1].trim(), category: recat[3].trim() } });
  }
  return null;
}

function simpleReadFastPath(input: DeterministicFastPathInput): CanonicalConversationTurnContract | null {
  const text = String(input.text ?? "").trim();
  const t = norm(text);
  const memory = input.memory;
  const category = detectCategory(text) ?? null;
  const periodMatch = text.match(/\b(m[eê]s passado|m[eê]s anterior|este m[eê]s|esse m[eê]s|hoje|ontem|[uú]ltimos?\s+(?:\d+|cinco|sete|seis|quatro|tr[eê]s|dois|oito|nove|dez|doze)\s+meses|de\s+(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+a\s+(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))\b/i);
  const period = periodMatch?.[1] ?? null;

  // Provider-failure recovery for a closed, contextual category switch such
  // as "Tá. Agora olha só Lazer pra mim" or "E em Alimentação?". The current
  // turn supplies the category, while the exact previously executed period is
  // copied as a canonical window. Merchant scope is deliberately cleared: an
  // explicit category switch must not silently retain an older establishment.
  if (category && hasSpendingContext(memory)) {
    const categoryToken = regexEscape(norm(category));
    const categoryOnly = new RegExp(
      `^(?:(?:ta|ok|beleza|certo)[\\s.,!?]+)?(?:agora\\s+)?(?:` +
        `(?:olha|ve|veja|mostra|mostre)\\s+(?:so\\s+)?(?:a\\s+categoria\\s+)?${categoryToken}(?:\\s+(?:pra|para)\\s+mim)?` +
        `|(?:e\\s+)?(?:so\\s+|apenas\\s+)?(?:em\\s+)?${categoryToken}` +
      `)[\\s.,!?]*$`,
    );
    if (categoryOnly.test(t)) {
      return readContract({
        text,
        metric: "expense_amount",
        operation: "sum",
        filters: [{ field: "category", value: category }],
        period: activePeriodExpression(memory),
        inherit: false,
      });
    }
  }

  // Same availability boundary for an unambiguous temporal continuation. It
  // is only legal after a proven spending read; debt/goal conversations cannot
  // be coerced into an expense query by the phrase "e no mês passado?".
  const periodOnly = /^(?:e\s+)?(?:no|do|em|para)?\s*(m[eê]s\s+(?:passado|anterior)|este\s+m[eê]s|esse\s+m[eê]s|hoje|ontem)[\s?.!]*$/i.exec(text);
  if (periodOnly && hasSpendingContext(memory)) {
    return readContract({
      text,
      metric: "expense_amount",
      operation: "sum",
      filters: [
        ...(memory?.active_category ? [{ field: "category" as const, value: memory.active_category }] : []),
        ...(memory?.active_merchant ? [{ field: "merchant" as const, value: memory.active_merchant }] : []),
      ],
      period: periodOnly[1],
      inherit: true,
    });
  }

  if (/\bquanto\b.*\bgastei\b/.test(t) && (category || memory?.active_category)) {
    const inherited = !category && !!memory?.active_category;
    const cat = category ?? memory?.active_category ?? null;
    if (!cat) return null;
    return readContract({
      text,
      metric: "expense_amount",
      operation: "sum",
      filters: [{ field: "category", value: cat }],
      period,
      inherit: inherited,
    });
  }

  if (/\b(?:em|quais?)\s+(?:os\s+)?estabelecimentos\b/.test(t) && memory?.active_category) {
    return readContract({
      text,
      metric: "expense_amount",
      operation: "breakdown",
      groupBy: ["merchant"],
      filters: [{ field: "category", value: memory.active_category }],
      period,
      inherit: true,
    });
  }

  if (/\b(?:mes\s+a\s+mes|mes\s+por\s+mes)\b/.test(t) && period && (category || memory?.active_category)) {
    const cat = category ?? memory?.active_category ?? null;
    if (!cat) return null;
    const merchant = /\bno\s+([\p{L}\d .'-]+?)\s+com\s+/iu.exec(text)?.[1]?.trim() ?? null;
    return readContract({
      text,
      metric: "expense_amount",
      operation: "trend",
      groupBy: ["month"],
      filters: [
        { field: "category", value: cat },
        ...(merchant ? [{ field: "merchant" as const, value: merchant }] : []),
      ],
      period,
      inherit: !category,
    });
  }

  if (/\bnao\s+quero\s+media\b/.test(t) && /\bquero\s+o\s+total\b/.test(t) && period && (memory?.active_category || memory?.active_merchant)) {
    return readContract({
      text,
      metric: "expense_amount",
      operation: "sum",
      filters: [
        ...(memory?.active_category ? [{ field: "category" as const, value: memory.active_category }] : []),
        ...(memory?.active_merchant ? [{ field: "merchant" as const, value: memory.active_merchant }] : []),
      ],
      period,
      inherit: true,
    });
  }
  return null;
}

function parsedWriteFastPath(input: DeterministicFastPathInput): CanonicalConversationTurnContract | null {
  const parsed: ParsedIntent = interpretDeterministic(input.text);
  if (parsed.kind === "transaction") {
    return actionContract({
      text: input.text,
      action: "transaction.create",
      slots: {
        type: parsed.type,
        amount: parsed.amount,
        occurred_at: parsed.occurred_at,
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.category_hint ? { category: parsed.category_hint } : {}),
        ...(parsed.account_hint ? { account: parsed.account_hint } : {}),
      },
    });
  }
  if (parsed.kind === "transfer") {
    return actionContract({
      text: input.text,
      action: "transfer.create",
      slots: {
        amount: parsed.amount,
        occurred_at: parsed.occurred_at,
        ...(parsed.from_hint ? { from_account: parsed.from_hint } : {}),
        ...(parsed.to_hint ? { to_account: parsed.to_hint } : {}),
      },
    });
  }
  if (parsed.kind === "goal") {
    return actionContract({
      text: input.text,
      action: "goal.create",
      slots: {
        name: parsed.name,
        target_amount: parsed.target_amount,
        ...(parsed.target_date ? { target_date: parsed.target_date } : {}),
      },
    });
  }
  if (parsed.kind === "goal_contribution") {
    return actionContract({
      text: input.text,
      action: "goal.contribute",
      slots: {
        goal: parsed.goal_hint,
        amount: parsed.amount,
        occurred_at: parsed.occurred_at,
      },
    });
  }
  return null;
}

export function deterministicConversationFastPath(
  input: DeterministicFastPathInput,
): CanonicalConversationTurnContract | null {
  const text = String(input.text ?? "").trim();
  if (!text) return null;

  // Destructive/maintenance intents first so a phrase like "apaga gasto de 50"
  // can never degrade into transaction.create.
  return transactionMaintenanceFastPath(input)
    ?? debtFastPath(input)
    ?? categoryFastPath(input)
    ?? recurringFastPath(input)
    ?? splitFastPath(input)
    ?? goalFastPath(input)
    ?? simpleReadFastPath(input)
    ?? parsedWriteFastPath(input);
}
