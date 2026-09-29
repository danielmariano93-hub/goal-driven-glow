// Nino Runtime V3 — revisão do período ("como foi meu mês?", "resumo do mês").
//
// A autoridade semântica já decidiu que a pessoa quer um BALANÇO, não um
// número. Este módulo reúne fatos que já existem nos motores (gasto e entrada
// por categoria, tetos, agenda, metas), faz as contas simples aqui (sobra,
// peso de cada categoria, variação, reembolso líquido) e entrega:
//   - `facts`: a única verdade que o compositor pode citar;
//   - `headline`: a leitura em uma frase (substituível pela voz do compositor);
//   - `blocks`: o corpo diagramado (negrito, listas, espaçamento, poucos emojis),
//     entregue sempre igual, com ou sem composição.
// deno-lint-ignore-file no-explicit-any

import type { AdvisorToolCall, AdvisorToolRunner } from "./AdvisorReasoningV3.ts";

export const PERIOD_REVIEW_VERSION = "nino_period_review.v1";

export type Amount = { name: string; value: number };

export type ReviewPeriod = { from: string; to: string; label?: string | null };

export type PeriodReviewInput = {
  today: string;
  period: ReviewPeriod;
  expense: { total: number; categories: Amount[] };
  income: { total: number; categories: Amount[] };
  comparison: { period: ReviewPeriod; total: number; categories: Amount[] } | null;
  /** Entradas dos últimos meses completos, para separar o extraordinário. */
  income_baseline: { months: number; categories: Amount[] } | null;
  ceilings: Array<{ category: string; limit: number; spent: number; overage: number; projected_overage: number }>;
  upcoming: Array<{ name: string; amount: number; date: string }>;
  donation_goal_names: string[];
  savings_goals: Array<{ name: string; remaining: number }>;
};

export type CategoryNote = {
  name: string;
  value: number;
  share_pct: number;
  commitment: boolean;
  reimbursed: number | null;
  net_after_reimbursement: number | null;
  ceiling_overage: number | null;
  ceiling_projected_overage: number | null;
};

export type PeriodReviewResult = {
  facts: Record<string, unknown>;
  headline: string;
  blocks: string;
  body: string;
};

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function money(value: number): string {
  return BRL.format(Math.round(value * 100) / 100).replace(/ /g, " ");
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const STOPWORDS = new Set(["do", "da", "de", "dos", "das", "e", "o", "a", "os", "as"]);

/** "Divisão do Rolê" e "Divisão Rolê" são a mesma coisa para o reembolso. */
export function categoryKey(name: string): string {
  return String(name ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter((token) => token && !STOPWORDS.has(token)).join(" ");
}

const COMMITMENT_RE = /\b(dizimo|dizimos|oferta|ofertas|doacao|doacoes|caridade|contribuicao igreja)\b/;

function isCommitment(name: string, donationGoals: string[]): boolean {
  const key = categoryKey(name);
  if (COMMITMENT_RE.test(key)) return true;
  return donationGoals.some((goal) => {
    const goalKey = categoryKey(goal);
    return !!goalKey && (key === goalKey || key.includes(goalKey) || goalKey.includes(key));
  });
}

function monthLabel(period: ReviewPeriod): { month: string; year: string } | null {
  const [y, m] = period.from.split("-");
  const sameMonth = period.from.slice(0, 7) === period.to.slice(0, 7);
  if (!sameMonth || period.from.slice(8, 10) !== "01") return null;
  return { month: MONTHS[Number(m) - 1], year: y };
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** O período em curso termina hoje (ou depois): o mês ainda não fechou. */
export function isOngoing(period: ReviewPeriod, today: string): boolean {
  return period.from <= today && period.to >= today;
}

/**
 * Janela equivalente anterior: mês em curso compara com o mesmo trecho do mês
 * passado (1 a N); mês fechado compara com o mês anterior inteiro; qualquer
 * outro recorte compara com o mesmo número de dias imediatamente antes.
 */
export function comparisonPeriodFor(period: ReviewPeriod, today: string): ReviewPeriod {
  const effectiveTo = isOngoing(period, today) ? today : period.to;
  const label = monthLabel(period);
  const [y, m] = period.from.split("-").map(Number);
  if (label) {
    const prevStart = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const prevEnd = lastDayOfMonth(prevStart);
    if (isOngoing(period, today) || effectiveTo < lastDayOfMonth(period.from)) {
      const day = Number(effectiveTo.slice(8, 10));
      const clipped = `${prevStart.slice(0, 8)}${String(Math.min(day, Number(prevEnd.slice(8, 10)))).padStart(2, "0")}`;
      return { from: prevStart, to: clipped, label: MONTHS[Number(prevStart.slice(5, 7)) - 1] };
    }
    return { from: prevStart, to: prevEnd, label: MONTHS[Number(prevStart.slice(5, 7)) - 1] };
  }
  const days = Math.round((Date.parse(`${effectiveTo}T12:00:00Z`) - Date.parse(`${period.from}T12:00:00Z`)) / 86_400_000) + 1;
  const to = new Date(Date.parse(`${period.from}T12:00:00Z`) - 86_400_000);
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label: null };
}

/** Últimos N meses completos antes do início do período. */
export function baselineMonthsWindow(period: ReviewPeriod, n = 3): ReviewPeriod {
  const [y, m] = period.from.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  const start = new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
  return { from: start, to: end };
}

/**
 * Leitura de assessor de uma lista de categorias de gasto: peso no total,
 * compromisso escolhido (dízimo/doação), quanto voltou de reembolso e teto.
 * Usada tanto no balanço do mês quanto no ranking "onde mais gastei".
 */
export function annotateCategories(args: {
  categories: Amount[];
  total: number;
  income_categories: Amount[];
  ceilings: PeriodReviewInput["ceilings"];
  donation_goal_names: string[];
  limit?: number;
}): CategoryNote[] {
  const incomeByKey = new Map<string, number>();
  for (const item of args.income_categories) {
    const key = categoryKey(item.name);
    incomeByKey.set(key, (incomeByKey.get(key) ?? 0) + Number(item.value || 0));
  }
  const ceilingByKey = new Map(args.ceilings.map((c) => [categoryKey(c.category), c]));
  return args.categories
    .filter((item) => Number(item.value) > 0)
    .slice(0, args.limit ?? 3)
    .map((item) => {
      const key = categoryKey(item.name);
      const reimbursed = incomeByKey.get(key) ?? 0;
      const ceiling = ceilingByKey.get(key);
      return {
        name: item.name,
        value: round2(item.value),
        share_pct: args.total > 0 ? Math.round((item.value / args.total) * 100) : 0,
        commitment: isCommitment(item.name, args.donation_goal_names),
        reimbursed: reimbursed > 0 ? round2(reimbursed) : null,
        net_after_reimbursement: reimbursed > 0 ? round2(item.value - reimbursed) : null,
        ceiling_overage: ceiling && ceiling.overage > 0 ? round2(ceiling.overage) : null,
        ceiling_projected_overage: ceiling && ceiling.overage <= 0 && ceiling.projected_overage > 0
          ? round2(ceiling.projected_overage)
          : null,
      };
    });
}

/** Uma linha por categoria: nome em negrito, valor, peso e a leitura. */
export function categoryLine(note: CategoryNote): string {
  const tags: string[] = [];
  if (note.commitment) tags.push("compromisso seu");
  if (note.ceiling_overage) tags.push(`passou ${money(note.ceiling_overage)} do teto ⚠️`);
  else if (note.ceiling_projected_overage) tags.push(`no ritmo, passa ${money(note.ceiling_projected_overage)} do teto`);
  if (note.reimbursed) {
    tags.push(note.net_after_reimbursement! <= 0
      ? `voltaram ${money(note.reimbursed)}, mais do que saiu`
      : `voltaram ${money(note.reimbursed)}, custo real de ${money(note.net_after_reimbursement!)}`);
  }
  const share = note.share_pct > 0 ? ` (${note.share_pct}%)` : "";
  return `• *${note.name}*: ${money(note.value)}${share}${tags.length ? ` · ${tags.join(" · ")}` : ""}`;
}

type Change = { name: string; from: number; to: number; delta: number };

function biggestChanges(current: Amount[], previous: Amount[], previousTotal: number): Change[] {
  const prev = new Map(previous.map((item) => [item.name, Number(item.value || 0)]));
  const names = new Set([...current.map((item) => item.name), ...previous.map((item) => item.name)]);
  const cur = new Map(current.map((item) => [item.name, Number(item.value || 0)]));
  const floor = Math.max(150, previousTotal * 0.08);
  const changes: Change[] = [];
  for (const name of names) {
    if (name === "Sem categoria") continue;
    const from = prev.get(name) ?? 0;
    const to = cur.get(name) ?? 0;
    const delta = to - from;
    if (Math.abs(delta) < floor || from <= 0) continue;
    changes.push({ name, from: round2(from), to: round2(to), delta: round2(delta) });
  }
  const up = changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const down = changes.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  return [up, down].filter(Boolean) as Change[];
}

function extraordinaryIncome(input: PeriodReviewInput): Array<{ name: string; value: number; typical: number }> {
  const baseline = input.income_baseline;
  if (!baseline || baseline.months <= 0) return [];
  const typical = new Map(baseline.categories.map((item) => [categoryKey(item.name), Number(item.value || 0) / baseline.months]));
  const floor = Math.max(500, input.income.total * 0.2);
  return input.income.categories
    .map((item) => ({ name: item.name, value: round2(item.value), typical: round2(typical.get(categoryKey(item.name)) ?? 0) }))
    .filter((item) => item.value - item.typical >= floor && item.value >= item.typical * 1.5)
    .sort((a, b) => b.value - a.value)
    .slice(0, 1);
}

function periodTitle(period: ReviewPeriod, today: string): string {
  const label = monthLabel(period);
  const ongoing = isOngoing(period, today);
  const end = ongoing ? today : period.to;
  if (label) {
    return ongoing
      ? `📊 *${capitalize(label.month)} até agora* (1 a ${ddmm(end)})`
      : `📊 *Seu ${label.month} de ${label.year}*`;
  }
  return `📊 *Seu período de ${ddmm(period.from)} a ${ddmm(end)}*`;
}

export function buildPeriodReview(input: PeriodReviewInput): PeriodReviewResult {
  const ongoing = isOngoing(input.period, input.today);
  const expense = round2(input.expense.total);
  const income = round2(input.income.total);
  const result = round2(income - expense);
  const extra = extraordinaryIncome(input);
  const notes = annotateCategories({
    categories: input.expense.categories,
    total: expense,
    income_categories: input.income.categories,
    ceilings: input.ceilings,
    donation_goal_names: input.donation_goal_names,
  });
  const exceeded = input.ceilings.filter((c) => c.overage > 0).sort((a, b) => b.overage - a.overage);
  const changes = input.comparison ? biggestChanges(input.expense.categories, input.comparison.categories, input.comparison.total) : [];
  const upcoming = ongoing
    ? input.upcoming.filter((item) => item.date >= input.today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3)
    : [];
  const goal = input.savings_goals.filter((g) => g.remaining > 0).sort((a, b) => b.remaining - a.remaining)[0] ?? null;

  // ---- leitura em uma frase ------------------------------------------------
  const label = monthLabel(input.period);
  const subject = label ? capitalize(label.month) : "Esse período";
  const verb = ongoing ? "está sendo" : "foi";
  let headline: string;
  if (extra.length) {
    headline = `${subject} ${verb} um mês fora da curva: entrou bem mais que o normal por causa de ${extra[0].name}.`;
  } else if (income > 0 && result < 0) {
    headline = `${subject} ${ongoing ? "está apertado" : "fechou apertado"}: saiu mais do que entrou${ongoing ? " até aqui" : ""}.`;
  } else if (exceeded.length) {
    headline = `${subject} ${verb} um mês no azul, mas ${exceeded[0].category} já passou do teto.`;
  } else if (income > 0) {
    headline = `${subject} ${verb} um mês equilibrado: entrou mais do que saiu.`;
  } else {
    headline = `Aqui está o resumo de ${label ? label.month : "esse período"}.`;
  }

  // ---- sugestão (uma só, a mais valiosa) -------------------------------------
  let suggestion: string | null = null;
  if (extra.length && goal) {
    suggestion = `Com a entrada extra de ${extra[0].name}, dá para dar um salto na meta *${goal.name}* (faltam ${money(goal.remaining)}). Quer que eu simule quanto colocar lá?`;
  } else if (exceeded.length && ongoing) {
    suggestion = `Segurar *${exceeded[0].category}* até o fim do mês evita que o teto estoure ainda mais.`;
  } else if (result > 0 && goal) {
    suggestion = `Separar parte da sobra para a meta *${goal.name}* (faltam ${money(goal.remaining)}) acelera o seu plano. Quer que eu simule?`;
  } else if (result < 0 && notes[0] && !notes[0].commitment) {
    suggestion = `Vale olhar os gastos de *${notes[0].name}*, que foi onde mais pesou.`;
  }

  // ---- corpo diagramado -------------------------------------------------------
  const sections: string[] = [periodTitle(input.period, input.today)];
  const money1: string[] = [`*Entradas:* ${money(income)}`];
  if (extra.length) money1.push(`↳ ${money(extra[0].value)} de ${extra[0].name}, fora do seu normal`);
  money1.push(`*Gastos:* ${money(expense)}`);
  money1.push(result >= 0 ? `*Sobrou:* ${money(result)}` : `*Faltou:* ${money(Math.abs(result))}`);
  sections.push(money1.join("\n"));
  if (notes.length) sections.push(["*Onde mais foi*", ...notes.map(categoryLine)].join("\n"));
  const overflow = exceeded.filter((c) => !notes.some((n) => categoryKey(n.name) === categoryKey(c.category)));
  if (overflow.length) {
    sections.push(["*Atenção*", ...overflow.slice(0, 2).map((c) => `• *${c.category}* passou ${money(c.overage)} do teto`)].join("\n"));
  }
  if (changes.length && input.comparison) {
    const cp = input.comparison.period;
    const ref = ongoing && cp.label ? `mesmo período de ${cp.label}` : cp.label ?? `${ddmm(cp.from)} a ${ddmm(cp.to)}`;
    sections.push([
      `*O que mudou* (vs. ${ref})`,
      ...changes.map((c) => `• *${c.name}*: ${c.delta > 0 ? "subiu" : "caiu"} de ${money(c.from)} para ${money(c.to)}`),
    ].join("\n"));
  }
  if (upcoming.length) {
    sections.push(["*Próximos dias*", ...upcoming.map((u) => `• ${u.name}: ${money(u.amount)} em ${ddmm(u.date)}`)].join("\n"));
  }
  if (suggestion) sections.push(`💡 ${suggestion}`);
  const blocks = sections.join("\n\n");

  const facts = {
    version: PERIOD_REVIEW_VERSION,
    period: { from: input.period.from, to: ongoing ? input.today : input.period.to, ongoing },
    income_total: income,
    expense_total: expense,
    result,
    extraordinary_income: extra,
    top_categories: notes,
    ceilings_exceeded: exceeded.map((c) => ({ category: c.category, overage: round2(c.overage), limit: c.limit })),
    changes,
    comparison_period: input.comparison?.period ?? null,
    upcoming,
    suggestion_goal: goal,
  };
  return { facts, headline, blocks, body: `${headline}\n\n${blocks}` };
}

// ---------------------------------------------------------------------------
// Execução: reúne os fatos pelos motores existentes (somente leitura).
// ---------------------------------------------------------------------------

export type PeriodReviewOutcome = {
  version: string;
  ok: boolean;
  reply: string;
  headline: string;
  blocks: string;
  facts: Record<string, unknown>;
  tool_calls: AdvisorToolCall[];
  error: string | null;
};

function amounts(result: any): Amount[] {
  return Array.isArray(result?.categories)
    ? result.categories.map((item: any) => ({ name: String(item.name ?? ""), value: Number(item.value ?? 0) })).filter((item: Amount) => item.name)
    : [];
}

export async function executePeriodReview(args: {
  period: ReviewPeriod;
  today: string;
  runTool: AdvisorToolRunner;
}): Promise<PeriodReviewOutcome> {
  const calls: AdvisorToolCall[] = [];
  const run = async (tool: string, toolArgs: Record<string, unknown>) => {
    try {
      const out = await args.runTool(tool, toolArgs);
      calls.push({ tool_name: tool, args: toolArgs, result: out.ok ? out.result : null, ok: out.ok, error: out.error ?? null });
      return out;
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 160);
      calls.push({ tool_name: tool, args: toolArgs, result: null, ok: false, error: message });
      return { ok: false, result: null, error: message };
    }
  };
  const ongoing = isOngoing(args.period, args.today);
  const to = ongoing ? args.today : args.period.to;
  const comparison = comparisonPeriodFor(args.period, args.today);
  const baseline = baselineMonthsWindow(args.period, 3);
  const report = { view: "breakdown", group_by: "category", limit: 20 };
  const [expense, income, previous, incomeBase, snapshot, goals] = await Promise.all([
    run("analyze_spending", { ...report, from: args.period.from, to, metric: "expense" }),
    run("analyze_spending", { ...report, from: args.period.from, to, metric: "income" }),
    run("analyze_spending", { ...report, from: comparison.from, to: comparison.to, metric: "expense" }),
    run("analyze_spending", { ...report, from: baseline.from, to: baseline.to, metric: "income" }),
    ongoing ? run("get_financial_snapshot", {}) : Promise.resolve({ ok: false, result: null }),
    run("get_goals_overview", {}),
  ]);
  if (!expense.ok || !income.ok) {
    return {
      version: PERIOD_REVIEW_VERSION, ok: false, headline: "", blocks: "", facts: {}, tool_calls: calls,
      reply: "Não consegui juntar os números desse período agora. Se quiser, me pergunte uma parte específica, como quanto você gastou ou recebeu.",
      error: "period_review_sources_unavailable",
    };
  }
  const snap = snapshot.ok ? snapshot.result : null;
  const goalItems: any[] = Array.isArray(goals.result?.items) ? goals.result.items : [];
  const review = buildPeriodReview({
    today: args.today,
    period: args.period,
    expense: { total: Number(expense.result?.total_metric ?? 0), categories: amounts(expense.result) },
    income: { total: Number(income.result?.total_metric ?? 0), categories: amounts(income.result) },
    comparison: previous.ok
      ? { period: comparison, total: Number(previous.result?.total_metric ?? 0), categories: amounts(previous.result) }
      : null,
    income_baseline: incomeBase.ok ? { months: 3, categories: amounts(incomeBase.result) } : null,
    ceilings: (snap?.active_category_goals ?? []).map((goal: any) => ({
      category: String(goal.category_name ?? ""),
      limit: Number(goal.target_amount ?? goal.limit ?? 0),
      spent: Number(goal.actual_spend ?? goal.spent ?? 0),
      overage: Number(goal.current_overage ?? 0),
      projected_overage: Number(goal.projected_overage ?? 0),
    })).filter((goal: any) => goal.category),
    upcoming: ((snap?.commitment_agenda?.items ?? []) as any[])
      .filter((item) => item.type === "expense" && item.payment_status !== "paid")
      .filter((item) => String(item.date) <= new Date(Date.parse(`${args.today}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10))
      .map((item) => ({ name: String(item.name ?? "Compromisso"), amount: Number(item.amount ?? 0), date: String(item.date) })),
    donation_goal_names: goalItems.filter((g) => g.type === "donation").map((g) => String(g.name ?? "")),
    savings_goals: goalItems
      .filter((g) => g.type !== "donation" && g.status !== "completed" && g.status !== "archived")
      .map((g) => ({ name: String(g.name ?? ""), remaining: Number(g.remaining ?? 0) })),
  });
  return {
    version: PERIOD_REVIEW_VERSION,
    ok: true,
    reply: review.body,
    headline: review.headline,
    blocks: review.blocks,
    facts: review.facts,
    tool_calls: calls,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Leitura de assessor para "onde mais gastei?" (ranking por categoria).
// ---------------------------------------------------------------------------

export type CategoryReadingOutcome = {
  body: string;
  facts: Record<string, unknown>;
  tool_calls: AdvisorToolCall[];
};

function spokenPeriod(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `de ${Number(from.slice(8, 10))} a ${Number(to.slice(8, 10))} de ${MONTHS[Number(from.slice(5, 7)) - 1]}`;
  }
  return `de ${ddmm(from)} a ${ddmm(to)}`;
}

/** Monta o texto do ranking de categorias com leitura (peso, compromisso, reembolso, teto). */
export function buildCategoryReading(args: {
  period: { from: string; to: string };
  total: number;
  categories: Amount[];
  income_categories: Amount[];
  ceilings: PeriodReviewInput["ceilings"];
  donation_goal_names: string[];
  limit?: number;
}): { body: string; notes: CategoryNote[] } {
  const notes = annotateCategories({
    categories: args.categories,
    total: args.total,
    income_categories: args.income_categories,
    ceilings: args.ceilings,
    donation_goal_names: args.donation_goal_names,
    limit: args.limit ?? 5,
  });
  const lines = [
    `📊 ${capitalize(spokenPeriod(args.period.from, args.period.to))}, você gastou *${money(args.total)}*.`,
    "",
    "*Onde mais foi*",
    ...notes.map(categoryLine),
  ];
  const top = notes.find((note) => !note.commitment && !(note.net_after_reimbursement != null && note.net_after_reimbursement <= 0));
  if (top && top !== notes[0]) {
    lines.push("", `Tirando os compromissos e o que voltou para você, o que mais pesou foi *${top.name}*.`);
  }
  return { body: lines.join("\n"), notes };
}

export async function executeCategoryReading(args: {
  spending: any;
  today: string;
  runTool: AdvisorToolRunner;
}): Promise<CategoryReadingOutcome | null> {
  const period = args.spending?.period;
  if (!period?.from || !period?.to) return null;
  const categories = amounts(args.spending);
  if (!categories.length) return null;
  const calls: AdvisorToolCall[] = [];
  const run = async (tool: string, toolArgs: Record<string, unknown>) => {
    try {
      const out = await args.runTool(tool, toolArgs);
      calls.push({ tool_name: tool, args: toolArgs, result: out.ok ? out.result : null, ok: out.ok, error: out.error ?? null });
      return out;
    } catch {
      return { ok: false, result: null };
    }
  };
  const currentMonth = String(period.from).slice(0, 7) === args.today.slice(0, 7);
  const [income, snapshot, goals] = await Promise.all([
    run("analyze_spending", { view: "breakdown", group_by: "category", limit: 20, from: period.from, to: period.to, metric: "income" }),
    currentMonth ? run("get_financial_snapshot", {}) : Promise.resolve({ ok: false, result: null }),
    run("get_goals_overview", {}),
  ]);
  const snap = snapshot.ok ? (snapshot as any).result : null;
  const goalItems: any[] = Array.isArray((goals as any).result?.items) ? (goals as any).result.items : [];
  const reading = buildCategoryReading({
    period: { from: period.from, to: period.to },
    total: Number(args.spending?.total_metric ?? 0),
    categories,
    income_categories: income.ok ? amounts((income as any).result) : [],
    ceilings: (snap?.active_category_goals ?? []).map((goal: any) => ({
      category: String(goal.category_name ?? ""),
      limit: Number(goal.target_amount ?? 0),
      spent: Number(goal.actual_spend ?? 0),
      overage: Number(goal.current_overage ?? 0),
      projected_overage: Number(goal.projected_overage ?? 0),
    })).filter((goal: any) => goal.category),
    donation_goal_names: goalItems.filter((g) => g.type === "donation").map((g) => String(g.name ?? "")),
  });
  return {
    body: reading.body,
    facts: { version: PERIOD_REVIEW_VERSION, category_reading: reading.notes, total: Number(args.spending?.total_metric ?? 0), period },
    tool_calls: calls,
  };
}
