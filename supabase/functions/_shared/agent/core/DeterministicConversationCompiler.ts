// Final deterministic compiler boundary.
// Keeps the broad fail-closed fast-path small while hardening phrases that have
// already appeared in production/adversarial tests. No provider call happens here.

import {
  GROUNDED_FINANCIAL_EVIDENCE_MARKER,
  normalizeConversationTurnContract,
  type CanonicalConversationTurnContract,
} from "./ConversationTurnContract.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import type { MonthlySeriesEvidence, ReferenceObject } from "./ConversationReferenceStore.ts";
import { deterministicConversationFastPath } from "./DeterministicConversationFastPath.ts";

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function brMoney(raw: string): number | null {
  let s = String(raw ?? "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

function brl(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function monthLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${MONTHS_PT[Number(match[2]) - 1] ?? match[2]} de ${match[1]}`;
}

function conversationalContract(args: {
  text: string;
  reply: string;
  inherit?: boolean;
  reference?: ReferenceObject | null;
}): CanonicalConversationTurnContract | null {
  const reference = args.reference ?? null;
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: args.inherit ? "follow_up" : "conversational",
    mode: "converse",
    domain: "conversation",
    canonical_request: args.text,
    inherit_focus: !!args.inherit,
    focus: {
      category: reference?.target === "category" ? reference.entity_labels[0] ?? null : null,
      merchant: reference?.target === "merchant" ? reference.entity_labels[0] ?? null : null,
      goal: null,
      period_expression: null,
      period_expressions: [],
    },
    action: null,
    direct_reply: args.reply,
    clarification_question: null,
    resolution: {
      intent: "resolved",
      reference: reference ? "resolved" : "not_applicable",
      time: "not_applicable",
      entity: reference ? "resolved" : "not_applicable",
      action: "not_applicable",
    },
    reference: reference ? {
      kind: "previous_result_set",
      target: reference.target,
      expression: GROUNDED_FINANCIAL_EVIDENCE_MARKER,
      status: "resolved",
    } : null,
    financial_read: null,
    advisory_kind: null,
  });
}

function latestMonthlyEvidence(memory: ConversationMemory | null): {
  reference: ReferenceObject;
  evidence: MonthlySeriesEvidence;
} | null {
  const candidates = (memory?.references ?? []).filter((reference) =>
    reference.status === "active" && reference.source?.context?.evidence?.kind === "monthly_series"
  ).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const reference = candidates[0] ?? null;
  const evidence = reference?.source?.context?.evidence ?? null;
  return reference && evidence?.kind === "monthly_series" ? { reference, evidence } : null;
}

function groundedMonthlyFollowup(text: string, memory: ConversationMemory | null): CanonicalConversationTurnContract | null {
  const found = latestMonthlyEvidence(memory);
  if (!found) return null;
  const t = norm(text);
  const points = found.evidence.months.filter((point) => point.has_data && Number.isFinite(point.total));
  if (!points.length) return null;

  if (/\b(?:mostra|mostre|gera|gere|traz|quero)\b.*\bgrafico\b/.test(t)) {
    return conversationalContract({
      text,
      reply: "Preparei o gráfico mês a mês com o mesmo recorte e os mesmos valores da análise. 📊",
      inherit: true,
      reference: found.reference,
    });
  }

  if (/\b(?:pior|maior gasto|mais gastei|mais caro)\b/.test(t) && /\bmes/.test(t)) {
    const worst = [...points].sort((a, b) => b.total - a.total)[0];
    return conversationalContract({
      text,
      reply: `Entre os meses mostrados, ${monthLabel(worst.month)} foi o de maior gasto: ${brl(worst.total)}.`,
      inherit: true,
      reference: found.reference,
    });
  }

  if (/\b(?:melhor|menor gasto|menos gastei|mais barato)\b/.test(t) && /\bmes/.test(t)) {
    const best = [...points].sort((a, b) => a.total - b.total)[0];
    return conversationalContract({
      text,
      reply: `Entre os meses mostrados, ${monthLabel(best.month)} foi o de menor gasto: ${brl(best.total)}.`,
      inherit: true,
      reference: found.reference,
    });
  }

  if (/\b(?:o que|que)\b.*\b(?:deveria|devo)\b.*\b(?:observar|notar|prestar atencao)\b/.test(t)) {
    const first = points[0];
    const last = points[points.length - 1];
    const worst = [...points].sort((a, b) => b.total - a.total)[0];
    const partial = found.evidence.partial_first_month || found.evidence.partial_last_month;
    const delta = Math.round((last.total - first.total) * 100) / 100;
    const direction = Math.abs(delta) < 0.005
      ? "terminou no mesmo nível em que começou"
      : delta > 0
        ? `terminou ${brl(delta)} acima do primeiro mês`
        : `terminou ${brl(Math.abs(delta))} abaixo do primeiro mês`;
    const caveat = partial
      ? " O primeiro ou o último mês é parcial, então não trate essa ponta como uma tendência fechada."
      : "";
    return conversationalContract({
      text,
      reply: `O principal ponto é ${monthLabel(worst.month)}, o maior gasto da série (${brl(worst.total)}). A série ${direction}.${caveat}`,
      inherit: true,
      reference: found.reference,
    });
  }

  if (/^(?:caramba|nossa|uau|poxa)\b.*\b(?:nao tinha percebido|nao sabia|nao tinha visto|surpreendeu)\b/.test(t)) {
    return conversationalContract({
      text,
      reply: "Pois é — quando a gente coloca os meses lado a lado, a mudança fica bem mais visível. 💛",
      inherit: true,
      reference: found.reference,
    });
  }

  return null;
}

function introductoryFinancialGreeting(text: string): CanonicalConversationTurnContract | null {
  const t = norm(text);
  const greeting = /^(?:oi|ola|bom dia|boa tarde|boa noite)\b/.test(t);
  const discovery = /\b(?:tentando|quero|preciso)\b.*\b(?:entender|organizar|olhar|analisar)\b.*\b(?:gastos?|financas?|dinheiro)\b/.test(t);
  if (!greeting || !discovery || /\b(?:quanto|qual|quais|quando|onde|registra|lanca|paguei)\b/.test(t)) return null;
  return conversationalContract({
    text,
    reply: "Tudo bem por aqui 💛 Vamos olhar isso juntos. Você pode começar pelo total de um período, por uma categoria ou por um estabelecimento.",
  });
}

function previousRange(from: string, to: string): { from: string; to: string } | null {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return null;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousTo = new Date(start.getTime() - 86_400_000);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * 86_400_000);
  return { from: previousFrom.toISOString().slice(0, 10), to: previousTo.toISOString().slice(0, 10) };
}

function contextualWeightAnalysis(text: string, memory: ConversationMemory | null): CanonicalConversationTurnContract | null {
  const t = norm(text);
  if (!memory || !/\bisso\b.*\b(?:muito|alto|normal)\b/.test(t) || !/\b(?:pesou|peso|categoria)\b/.test(t)) return null;
  const from = String(memory.active_period?.from ?? "");
  const to = String(memory.active_period?.to ?? "");
  const previous = previousRange(from, to);
  if (!previous) return null;
  const baseline = `${previous.from}..${previous.to}`;
  const target = `${from}..${to}`;
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "read",
    domain: "financial_read",
    canonical_request: text,
    inherit_focus: true,
    focus: { category: null, merchant: null, goal: null, period_expression: target, period_expressions: [baseline, target] },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: { intent: "resolved", reference: "not_applicable", time: "resolved", entity: "not_applicable", action: "not_applicable" },
    reference: null,
    financial_read: {
      intent: "analyze",
      queries: [
        {
          metric: "expense_amount", operation: "compare", group_by: [], filters: [], limit: null,
          comparison_direction: "any", comparison_baseline: "period", comparison_baseline_window: null,
          comparison_baseline_expression: baseline, comparison_target_expression: target,
        },
        {
          metric: "expense_amount", operation: "breakdown", group_by: ["category"], filters: [], limit: 5,
          comparison_direction: "any", comparison_baseline: "period", comparison_baseline_window: null,
          comparison_baseline_expression: null, comparison_target_expression: null,
        },
      ],
    },
    advisory_kind: null,
  });
}

function writeContract(text: string, action: string, slots: Record<string, unknown>): CanonicalConversationTurnContract | null {
  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "new_request",
    mode: "write",
    domain: "financial_write",
    canonical_request: text,
    inherit_focus: false,
    focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
    action: { action, slots },
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved", reference: "not_applicable", time: "not_applicable",
      entity: "resolved", action: "resolved",
    },
    reference: null,
    financial_read: null,
    advisory_kind: null,
  });
}

function monthlySeriesContract(text: string, memory: ConversationMemory): CanonicalConversationTurnContract | null {
  const t = norm(text);
  if (!/\b(?:mes a mes|mes por mes)\b/.test(t)) return null;
  const period = t.match(/\bultimos?\s+(\d+|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|doze)\s+meses\b/)?.[0] ?? null;
  if (!period) return null;
  const category = memory.active_category ?? null;
  if (!category) return null;

  return normalizeConversationTurnContract({
    version: "conversation_turn_contract.v2",
    act: "follow_up",
    mode: "read",
    domain: "financial_read",
    canonical_request: text,
    inherit_focus: true,
    focus: {
      category,
      merchant: memory.active_merchant ?? null,
      goal: null,
      period_expression: period,
      period_expressions: [period],
    },
    action: null,
    direct_reply: null,
    clarification_question: null,
    resolution: {
      intent: "resolved", reference: "not_applicable", time: "resolved",
      entity: "resolved", action: "not_applicable",
    },
    reference: null,
    financial_read: {
      intent: "lookup",
      queries: [{
        metric: "expense_amount",
        operation: "trend",
        group_by: ["month"],
        filters: [
          { field: "category", op: "eq", value: category },
          ...(memory.active_merchant ? [{ field: "merchant", op: "eq", value: memory.active_merchant }] : []),
        ],
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

export function compileDeterministicConversationTurn(args: {
  text: string;
  memory: ConversationMemory | null;
}): CanonicalConversationTurnContract | null {
  const text = String(args.text ?? "").trim();
  const t = norm(text);

  const greeting = introductoryFinancialGreeting(text);
  if (greeting) return greeting;

  const monthlyFollowup = groundedMonthlyFollowup(text, args.memory);
  if (monthlyFollowup) return monthlyFollowup;

  const weightAnalysis = contextualWeightAnalysis(text, args.memory);
  if (weightAnalysis) return weightAnalysis;

  // "Registra R$300 de pagamento na dívida do Lucas" is a payment, never an
  // expense transaction. Require all three anchors so ambiguous "registra 300"
  // still falls through to the normal classifier.
  if (/\b(?:registra|registre|registrar|paguei|paga|pague)\b/.test(t)
    && /\bpagamento\b/.test(t) && /\bdivida\b/.test(t)) {
    const amountRaw = /r\$\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/i.exec(text)?.[1] ?? "";
    const amount = brMoney(amountRaw);
    const debt = /d[ií]vida\s+(?:do|da|com)\s+(.+?)[?.!]*$/i.exec(text)?.[1]?.trim() ?? "";
    if (amount != null && amount > 0 && debt) {
      return writeContract(text, "debt.pay", { debt, amount });
    }
  }

  if (args.memory) {
    const monthly = monthlySeriesContract(text, args.memory);
    if (monthly) return monthly;
  }

  return deterministicConversationFastPath(args);
}
