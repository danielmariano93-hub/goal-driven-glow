// SpendingGoalTools (`spending_goals.v1`) — metas de GASTO pelo Nino.
// A meta é da categoria; submetas por estabelecimento dizem onde o limite é
// consumido. O Nino analisa o histórico, propõe números reais e só cria depois
// da confirmação (uma pendência atômica: metas + submetas entram juntas).
// deno-lint-ignore-file no-explicit-any

import type { ToolContext, ToolResult } from "../tools.ts";
import { localDate } from "../../finance-core/ninoClock.ts";
import { merchantMatches, merchantQueryKey } from "../../finance-core/merchant.ts";
import {
  MERCHANT_GROUPS,
  merchantInGroup,
  merchantTargetLimit,
  type CategorySpendingAdvice,
  type MerchantTargetKind,
  type SpendingHistoryAdvice,
} from "../../finance-core/spendingGoals.ts";
import { adviseGoals, loadSpendingGoalContext, type SpendingGoalContext } from "../../spendingGoals/runtime.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (n: number) => BRL.format(Number(n || 0));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

export type PlanTarget = {
  label: string;
  merchant_keys: string[];
  limit_kind: MerchantTargetKind;
  reduction_pct: number | null;
  baseline_amount: number;
  computed_limit: number | null;
};

export type PlanGoal = {
  category_id: string;
  category_name: string;
  goal_id: string | null;
  create: { computed_limit: number; mode: "fixed_limit"; baseline_value: number; replace_limit?: boolean } | null;
  targets: PlanTarget[];
  /** Linhas humanas do rascunho (números exatos do histórico). */
  lines: string[];
};

export type PlanFailure = { ok: false; question: string; error: string };
export type PlanOutcome =
  | { ok: true; goals: PlanGoal[]; summary: string; receipt_text: string }
  | { ok: false; question: string; error: string };

function norm(value: string): string {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/metade/i.test(raw)) return 50;
  raw = raw.replace(/r\$/ig, "").replace(/%/g, "").replace(/\s/g, "");
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function resolveCategory(sg: SpendingGoalContext, term: string): { id: string; name: string } | null {
  const t = norm(term);
  if (!t) return null;
  return sg.categories.find((c) => norm(c.name) === t)
    ?? sg.categories.find((c) => norm(c.name).startsWith(t) || t.startsWith(norm(c.name)))
    ?? sg.categories.find((c) => norm(c.name).includes(t))
    ?? null;
}

/** Janela dos últimos 6 meses fechados. */
function closedWindow(asOf: string): { from: string; to: string; months: number } {
  const [y, m] = asOf.slice(0, 7).split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 7, 1));
  const end = new Date(Date.UTC(y, m - 1, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), months: 6 };
}

/** Termo do usuário → chaves normalizadas do histórico (grupo, marca ou texto). */
function resolveMerchantTerm(sg: SpendingGoalContext, term: string, categoryId: string | null): { label: string; keys: string[] } | null {
  const t = norm(term);
  if (!t) return null;
  const group = MERCHANT_GROUPS.find((g) => norm(g.label) === t || norm(g.label).includes(t) || t.includes(g.id)
    || (g.id === "mobility" && /aplicativos? de transporte|apps? de transporte|corrida/.test(t))
    || (g.id === "delivery" && /delivery|entrega|pedido de comida/.test(t))
    || (g.id === "streaming" && /streaming/.test(t))
    || (g.id === "tech" && /ferramenta|tecnologia|software/.test(t)));
  const seen = new Map<string, string>();
  for (const e of sg.entries) {
    if (categoryId && e.category_id !== categoryId) continue;
    if (e.amount > 0 && !seen.has(e.merchant_key)) seen.set(e.merchant_key, e.merchant_label);
  }
  if (group) {
    const keys = [...seen.keys()].filter((k) => merchantInGroup(group, k));
    return keys.length ? { label: keys.map((k) => seen.get(k)!).join(" + "), keys } : { label: group.label, keys: group.keys };
  }
  const key = merchantQueryKey(term, sg.resolver);
  if (key && seen.has(key)) return { label: seen.get(key)!, keys: [key] };
  const fuzzy = [...seen.entries()].filter(([k, label]) => !k.startsWith("raw:") && merchantMatches(k, label, term));
  if (fuzzy.length) {
    const best = fuzzy.sort((a, b) => a[0].length - b[0].length)[0];
    return { label: best[1], keys: [best[0]] };
  }
  return key ? { label: sg.resolver.resolve(term)?.label ?? term.trim(), keys: [key] } : null;
}

function splitMerchants(raw: unknown): string[] {
  return String(raw ?? "")
    .split(/\s*(?:,|;|\+|\be\b|\bou\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 8);
}

function monthlyAverage(sg: SpendingGoalContext, categoryId: string | null, keys: string[] | null): number {
  const w = closedWindow(sg.as_of);
  const set = keys ? new Set(keys) : null;
  const total = sg.entries
    .filter((e) => e.date >= w.from && e.date <= w.to)
    .filter((e) => (categoryId ? e.category_id === categoryId : true) && (set ? set.has(e.merchant_key) : true))
    .reduce((acc, e) => acc + e.amount, 0);
  return round2(Math.max(0, total) / w.months);
}

function dominantCategory(sg: SpendingGoalContext, keys: string[]): string | null {
  const set = new Set(keys);
  const by = new Map<string, number>();
  for (const e of sg.entries) {
    if (!set.has(e.merchant_key) || !e.category_id || e.amount <= 0) continue;
    by.set(e.category_id, (by.get(e.category_id) ?? 0) + e.amount);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function activeGoalFor(sg: SpendingGoalContext, categoryId: string) {
  return sg.goals
    .filter((g) => g.category_id === categoryId && g.status === "active")
    .sort((a, b) => Number(b.period_type === "monthly_recurring") - Number(a.period_type === "monthly_recurring"))[0] ?? null;
}

function targetLine(t: PlanTarget): string {
  if (t.limit_kind === "zero") {
    return `Submeta ${t.label}: gasto zero${t.baseline_amount > 0 ? ` (hoje ~${brl(t.baseline_amount)} por mês; ${brl(t.baseline_amount * 12)} em 12 meses)` : ""}. Se aparecer cobrança, eu aviso na hora.`;
  }
  if (t.limit_kind === "track") {
    return `Submeta ${t.label}: acompanhar sem limite${t.baseline_amount > 0 ? ` (hoje ~${brl(t.baseline_amount)} por mês)` : ""}.`;
  }
  const how = t.limit_kind === "percent_reduction" ? `reduzir ${t.reduction_pct}%` : "limite fixo";
  return `Submeta ${t.label}: ${how} → até ${brl(t.computed_limit ?? 0)} por mês${t.baseline_amount > 0 ? ` (hoje ~${brl(t.baseline_amount)}; economia de ${brl(Math.max(0, t.baseline_amount - (t.computed_limit ?? 0)))} por mês)` : ""}.`;
}

function finish(goals: PlanGoal[]): PlanOutcome {
  const summary = goals.flatMap((g) => g.lines).join("\n")
    + "\nTudo o que for gasto numa submeta também conta na meta da categoria.";
  const receipt = goals.map((g) => {
    const limit = g.create?.computed_limit;
    const subs = g.targets.map((t) => t.label);
    return `${g.category_name}${limit ? ` (${brl(limit)}/mês)` : ""}${subs.length ? ` com ${subs.length === 1 ? "a submeta" : "as submetas"} ${subs.join(", ")}` : ""}`;
  });
  return {
    ok: true,
    goals,
    summary,
    receipt_text: `Metas de gasto salvas: ${receipt.join("; ")}. O Nino passa a acompanhar e avisar antes do desvio.`,
  };
}

/** Comando direto: "reduza Uber e 99 pela metade", "zerar Lovable", "Lazer até R$ 800". */
export function planFromCommand(
  sg: SpendingGoalContext,
  advice: SpendingHistoryAdvice | null,
  slots: Record<string, unknown>,
): PlanOutcome {
  const merchantTerms = splitMerchants(slots.merchants ?? slots.merchant ?? slots.establishment);
  const categoryTerm = String(slots.category ?? "").trim();
  let category = categoryTerm ? resolveCategory(sg, categoryTerm) : null;
  if (categoryTerm && !category) {
    return { ok: false, error: "category_not_found", question: `Não encontrei a categoria "${categoryTerm}". Qual categoria você quer limitar?` };
  }

  const resolved = merchantTerms.map((term) => ({ term, hit: resolveMerchantTerm(sg, term, category?.id ?? null) }));
  const missing = resolved.filter((r) => !r.hit).map((r) => r.term);
  if (missing.length) {
    return { ok: false, error: "merchant_not_found", question: `Não encontrei ${missing.join(", ")} no seu histórico. Pode me dizer o nome como aparece no extrato?` };
  }
  const keys = [...new Set(resolved.flatMap((r) => r.hit!.keys))];
  if (!category && keys.length) {
    const id = dominantCategory(sg, keys);
    category = id ? sg.categories.find((c) => c.id === id) ?? null : null;
  }
  if (!category) {
    return {
      ok: false,
      error: "category_required",
      question: keys.length
        ? "Ainda não vi gastos nesse estabelecimento. Em qual categoria ele entra?"
        : "Para qual categoria você quer a meta de gasto?",
    };
  }

  const percent = numberValue(slots.percent ?? slots.reduction_pct);
  const amount = numberValue(slots.amount ?? slots.limit);
  const categoryLimit = numberValue(slots.category_limit);
  const kindText = norm(String(slots.limit_kind ?? ""));
  const catAdvice: CategorySpendingAdvice | undefined = advice?.categories.find((c) => c.category_id === category!.id);
  const reference = catAdvice?.reference ?? monthlyAverage(sg, category.id, null);

  const targets: PlanTarget[] = [];
  if (keys.length) {
    const baseline = monthlyAverage(sg, category.id, keys);
    const label = resolved.map((r) => r.hit!.label).join(" + ").slice(0, 80);
    let kind: MerchantTargetKind;
    let pct: number | null = null;
    if (/zero|zerar|cancel|nenhum|nao quero/.test(kindText)) kind = "zero";
    else if (/track|acompanh|monitor/.test(kindText)) kind = "track";
    else if (percent != null && percent > 0 && percent <= 100) { kind = "percent_reduction"; pct = percent; }
    else if (amount != null && amount >= 0) kind = amount === 0 ? "zero" : "amount";
    else { kind = "percent_reduction"; pct = 30; }
    if (kind === "percent_reduction" && !(baseline > 0)) {
      return { ok: false, error: "no_history_for_reduction", question: `Não há gasto recente em ${label} para calcular a redução. Qual limite em R$ por mês você quer?` };
    }
    targets.push({
      label,
      merchant_keys: keys,
      limit_kind: kind,
      reduction_pct: pct,
      baseline_amount: baseline,
      computed_limit: merchantTargetLimit(kind, { amount, reductionPct: pct, baseline }),
    });
  }

  const existing = activeGoalFor(sg, category.id);
  const lines: string[] = [];
  let create: PlanGoal["create"] = null;
  const targetLimits = targets.reduce((acc, t) => acc + (t.computed_limit ?? 0), 0);
  if (categoryLimit != null && categoryLimit > 0) {
    create = { computed_limit: round2(categoryLimit), mode: "fixed_limit", baseline_value: reference, replace_limit: Boolean(existing) };
    lines.push(`Meta de ${category.name}: limite de ${brl(categoryLimit)} por mês${reference > 0 ? ` (sua referência recente é ${brl(reference)})` : ""}.`);
  } else if (!existing) {
    const suggested = Math.max(catAdvice?.recommended_limit ?? reference, targetLimits, 1);
    const saving = targets.reduce((acc, t) => acc + Math.max(0, t.baseline_amount - (t.computed_limit ?? t.baseline_amount)), 0);
    const limit = round2(Math.max(targetLimits, Math.min(suggested, reference > 0 ? reference - saving : suggested) || suggested));
    create = { computed_limit: limit, mode: "fixed_limit", baseline_value: reference };
    lines.push(`Meta de ${category.name} (nova): limite de ${brl(limit)} por mês${reference > 0 ? `; sua referência recente é ${brl(reference)}` : ""}.`);
  } else {
    lines.push(`Meta de ${category.name}: mantém o limite atual de ${brl(Number(existing.computed_limit || 0))} por mês.`);
  }
  lines.push(...targets.map(targetLine));
  if (!targets.length && !create) {
    return { ok: false, error: "nothing_to_change", question: `A meta de ${category.name} já existe. Quer mudar o limite ou limitar algum estabelecimento dentro dela?` };
  }
  return finish([{ category_id: category.id, category_name: category.name, goal_id: existing?.id ?? null, create, targets, lines }]);
}

/** "Analise meus gastos e me ajude a criar metas": histórico → propostas. */
export function planFromAdvice(sg: SpendingGoalContext, advice: SpendingHistoryAdvice, max = 3): PlanOutcome & { analysis?: string } {
  const picks = advice.categories
    .filter((c) => c.discretionary && (c.potential_monthly > 0 || c.suggested_targets.length) && c.reference >= 150)
    .slice(0, max);
  if (!picks.length) {
    return { ok: false, error: "no_candidates", question: "Olhei seu histórico e não encontrei uma categoria de gasto variável com espaço claro para limite agora. Quer criar uma meta para uma categoria específica?" };
  }
  const goals: PlanGoal[] = picks.map((c, i) => {
    const existing = activeGoalFor(sg, c.category_id);
    const targets: PlanTarget[] = c.suggested_targets.map((t) => ({
      label: t.label,
      merchant_keys: t.merchant_keys,
      limit_kind: t.limit_kind,
      reduction_pct: t.reduction_pct,
      baseline_amount: t.baseline,
      computed_limit: t.limit,
    }));
    const trend = c.trend.direction === "up" ? `subindo ${Math.round(Math.abs(c.trend.pct) * 100)}%` : c.trend.direction === "down" ? `caindo ${Math.round(Math.abs(c.trend.pct) * 100)}%` : "estável";
    const header = `${i + 1}) ${c.name}: referência de ${brl(c.reference)} por mês (média histórica ${brl(c.average)}), ${trend}.`
      + (c.max ? ` Maior mês: ${monthName(c.max.month)} (${brl(c.max.amount)})` : "")
      + (c.min ? `; menor: ${monthName(c.min.month)} (${brl(c.min.amount)}).` : ".")
      + (c.atypical.length ? ` Mês fora do padrão: ${c.atypical.map((a) => monthName(a.month)).join(", ")}.` : "");
    const who = c.merchants.slice(0, 3).map((m) => `${m.label} ${Math.round(m.share * 100)}%`).join(", ");
    const lines = [
      header,
      ...(who ? [`   Quem mais explica: ${who}.`] : []),
      existing
        ? `   Você já tem meta de ${c.name} (${brl(Number(existing.computed_limit || 0))}); sugiro detalhar por estabelecimento.`
        : `   Sugestão: limite de ${brl(c.recommended_limit)} por mês — economia de ${brl(c.potential_monthly)} por mês (${brl(c.impact.m12)} em 12 meses).`,
      ...targets.map((t) => `   • ${targetLine(t)}`),
    ];
    return {
      category_id: c.category_id,
      category_name: c.name,
      goal_id: existing?.id ?? null,
      create: existing ? null : { computed_limit: c.recommended_limit, mode: "fixed_limit", baseline_value: c.reference },
      targets,
      lines,
    };
  });
  const potential = picks.filter((c) => !activeGoalFor(sg, c.category_id)).reduce((acc, c) => acc + c.potential_monthly, 0);
  const done = finish(goals);
  if (!done.ok) return done;
  const intro = `Analisei ${advice.months_analyzed} meses de despesa real (sem transferências, faturas, investimentos e estornos) e separei onde um limite muda o seu mês:`;
  const outro = potential > 0
    ? `Impacto somado: ${brl(potential)} por mês, ${brl(potential * 12)} em 12 meses.`
    : "";
  return {
    ...done,
    summary: [intro, ...goals.flatMap((g) => g.lines), outro, "Tudo o que for gasto numa submeta também conta na meta da categoria. Posso criar assim? Se quiser, ajusto algum valor antes."].filter(Boolean).join("\n"),
  };
}

function payloadOf(outcome: Extract<PlanOutcome, { ok: true }>) {
  return {
    goals: outcome.goals.map((g) => ({
      category_id: g.category_id,
      goal_id: g.goal_id,
      create: g.create,
      targets: g.targets.map((t) => ({
        label: t.label,
        merchant_keys: t.merchant_keys,
        limit_kind: t.limit_kind,
        reduction_pct: t.reduction_pct,
        baseline_amount: t.baseline_amount,
        computed_limit: t.computed_limit,
      })),
    })),
    receipt_text: outcome.receipt_text,
    created_on: localDate(),
  };
}

async function upsertPlanDraft(ctx: ToolContext, outcome: Extract<PlanOutcome, { ok: true }>, summary: string): Promise<string> {
  const { data, error } = await ctx.sb.rpc("agent_upsert_draft", {
    p_user_id: ctx.user_id,
    p_conversation_id: ctx.conversation_id,
    p_kind: "spending_goal_plan",
    p_payload: payloadOf(outcome),
    p_summary: summary.slice(0, 3500),
    p_ttl_minutes: 30,
  });
  if (error || !data) throw new Error(`draft_persistence_failed:${error?.message ?? "empty_id"}`);
  return String(data);
}

async function spendingGoalPlanDraft(ctx: ToolContext, args: any): Promise<ToolResult> {
  const sg = await loadSpendingGoalContext(ctx.sb, ctx.user_id, localDate());
  const advice = adviseGoals(sg);
  const outcome = planFromCommand(sg, advice, args ?? {});
  if (outcome.ok === false) {
    const fail = outcome as PlanFailure;
    const slot = ({ category_required: "category", category_not_found: "category", merchant_not_found: "merchants", no_history_for_reduction: "amount" } as Record<string, string>)[fail.error] ?? null;
    return { ok: true, result: { needs_input: true, slot, card_text: fail.question, error: fail.error } };
  }
  const draftId = await upsertPlanDraft(ctx, outcome, outcome.summary);
  return { ok: true, result: { draft_id: draftId, summary: outcome.summary } };
}

/** Análise do histórico + rascunho confirmável (usado pelo assessor). */
export async function executeSpendingGoalAdvice(ctx: ToolContext): Promise<
  { ok: true; reply: string; draft_id: string | null; facts: Record<string, unknown> } | { ok: false; reply: string; error: string }
> {
  const sg = await loadSpendingGoalContext(ctx.sb, ctx.user_id, localDate());
  const advice = adviseGoals(sg);
  const outcome = planFromAdvice(sg, advice);
  if (outcome.ok === false) {
    const fail = outcome as PlanFailure;
    return { ok: false, reply: fail.question, error: fail.error };
  }
  const draftId = await upsertPlanDraft(ctx, outcome, outcome.summary);
  return {
    ok: true,
    reply: outcome.summary,
    draft_id: draftId,
    facts: {
      version: advice.version,
      months_analyzed: advice.months_analyzed,
      total_potential_monthly: advice.total_potential_monthly,
      categories: advice.categories.slice(0, 5).map((c) => ({
        name: c.name, reference: c.reference, recommended_limit: c.recommended_limit, potential_monthly: c.potential_monthly,
      })),
    },
  };
}

export function spendingGoalToolByName(name: string): { execute: (ctx: ToolContext, args: any) => Promise<ToolResult> } | null {
  return name === "lifecycle_spending_goal_plan_draft" ? { execute: spendingGoalPlanDraft } : null;
}
