// one-shot patcher: merchant filter + low-risk current-month default.
// Fails fast if any expected source fragment is missing.
import fs from 'node:fs';

function patch(path, replacements) {
  let s = fs.readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    if (!s.includes(from)) throw new Error(`expected fragment not found in ${path}: ${from.slice(0,120)}`);
    s = s.replace(from, to);
  }
  fs.writeFileSync(path, s);
}

patch('supabase/functions/_shared/agent/core/FinancialQueryIR.ts', [
  ['field: "category" | "card" | "account" | "payment_method";', 'field: "category" | "merchant" | "card" | "account" | "payment_method";'],
  ['const FILTER_FIELDS = new Set(["category", "card", "account", "payment_method"]);', 'const FILTER_FIELDS = new Set(["category", "merchant", "card", "account", "payment_method"]);'],
]);

patch('supabase/functions/_shared/agent/core/ConversationTurnContract.ts', [
  ['if (!["category", "card", "account", "payment_method"].includes(field) || !filterValue) return null;', 'if (!["category", "merchant", "card", "account", "payment_method"].includes(field) || !filterValue) return null;'],
  ['  const resolution = inferResolution({ raw: value, mode, action, focus, reference });\n  const domain = inferDomain(mode, value.domain);', '  let resolution = inferResolution({ raw: value, mode, action, focus, reference });\n  const domain = inferDomain(mode, value.domain);\n  // Low-risk temporal default policy: omitting a period in a factual financial read\n  // is not an unresolved semantic slot. The backend owns the current-month default.\n  // Explicit ambiguous/conflicting time expressions remain fail-closed.\n  if (mode === "read" && domain === "financial_read"\n    && resolution.time === "missing" && normalizePeriodExpressions(focus).length === 0) {\n    resolution = { ...resolution, time: "not_applicable" };\n  }'],
]);

patch('supabase/functions/_shared/agent/core/ConversationBrain.ts', [
  ['field: { type: "string", enum: ["category", "card", "account", "payment_method"] },', 'field: { type: "string", enum: ["category", "merchant", "card", "account", "payment_method"] },'],
  ['25. Se domain=financial_read, financial_read é obrigatório e descreve a MESMA interpretação canônica: metric, operation, group_by, filters, limit e semântica de comparação. Não inclua datas resolvidas nem nomes de tools. Se domain não for financial_read, financial_read=null. Exemplos: "quanto gastei" => expense_amount/sum; "quais categorias mais gastei" => expense_amount/rank/group_by=[category].', '25. Se domain=financial_read, financial_read é obrigatório e descreve a MESMA interpretação canônica: metric, operation, group_by, filters, limit e semântica de comparação. Não inclua datas resolvidas nem nomes de tools. Se domain não for financial_read, financial_read=null. Exemplos: "quanto gastei" => expense_amount/sum; "quais categorias mais gastei" => expense_amount/rank/group_by=[category].\n27. Estabelecimento específico é filtro financeiro de primeira classe: preserve focus.merchant e inclua também filters=[{field:"merchant",value:"..."}] na query correspondente. Se houver categoria explícita, preserve os dois filtros; nunca descarte um deles.\n28. Em leitura factual de gasto/receita sem expressão temporal, NÃO peça período: mantenha focus.period_expression=null/period_expressions=[], resolution.time=not_applicable e mode=read. O backend aplica o default temporal de baixo risco (mês vigente). Só use clarify para tempo quando o usuário forneceu uma expressão temporal realmente ambígua ou conflitante.'],
]);

patch('supabase/functions/_shared/agent/core/IRCapabilityAdapter.ts', [
  ['  if (q.metric === "expense_amount" || q.metric === "income_amount") {\n    const metric = q.metric === "income_amount" ? "income" : "expense";\n    const group = q.group_by[0] ?? null;\n\n    if (["value", "sum", "rank", "breakdown"].includes(q.operation)) {', '  if (q.metric === "expense_amount" || q.metric === "income_amount") {\n    const metric = q.metric === "income_amount" ? "income" : "expense";\n    const group = q.group_by[0] ?? null;\n    const merchant = filter(q, "merchant");\n\n    // Specific merchant lookup is a first-class deterministic capability.\n    // merchant_profile already owns merchant truth; category remains an optional\n    // additional scope and is never silently dropped.\n    if (merchant && ["value", "sum"].includes(q.operation)) {\n      if (metric !== "expense" || group || !onlyFilters(q, ["category", "merchant"])) return null;\n      const category = filter(q, "category");\n      return {\n        tool: "merchant_profile",\n        capability: "financial_analysis",\n        execution: "deterministic",\n        args: {\n          query: merchant,\n          from: period.from,\n          to: period.to,\n          ...(category ? { category_name: category } : {}),\n        },\n      };\n    }\n\n    if (["value", "sum", "rank", "breakdown"].includes(q.operation)) {'],
  ['  "expense_amount + rank|breakdown group merchant (filtro opcional: category; motor merchant_distribution)",', '  "expense_amount + rank|breakdown group merchant (filtro opcional: category; motor merchant_distribution)",\n  "expense_amount + value|sum com filtro merchant (filtro category opcional; motor merchant_profile)",'],
]);

patch('supabase/functions/_shared/agent/engineToolsImpl.ts', [
  ['export function merchant_profile(\n  ctx: EngineToolContext,\n  args: { query: string; days?: number; from?: string; to?: string },\n): Promise<EngineToolResult> {\n  return guard(async () => {\n    const period = periodFromArgs(args ?? ({} as any), 90);\n    const comparison = previousWindow(period);\n    const [txs, aliases] = await Promise.all([\n      loadEngineTransactions(ctx, comparison.from, period.to),\n      loadAliases(ctx),\n    ]);\n    const env = merchantProfile({\n      txs: txs as any,\n      period,\n      comparisonPeriod: comparison,\n      aliases,\n      query: String(args?.query ?? ""),\n    });\n    const f = env.facts;\n    const headline = f.found\n      ? `${f.label}: ${brl(f.net_total)} em ${f.count} compra(s), ticket médio ${brl(f.avg_ticket)}.`\n      : `Não encontrei lançamentos de “${f.query}” nessa janela.`;\n    return withAnswerFormat(env, headline, f.delta_abs);\n  });\n}', 'export function merchant_profile(\n  ctx: EngineToolContext,\n  args: { query: string; days?: number; from?: string; to?: string; category_id?: string; category_name?: string },\n): Promise<EngineToolResult> {\n  return guard(async () => {\n    const period = periodFromArgs(args ?? ({} as any), 90);\n    const comparison = previousWindow(period);\n    const [txs, aliases, categoryId, categoryNames] = await Promise.all([\n      loadEngineTransactions(ctx, comparison.from, period.to),\n      loadAliases(ctx),\n      resolveCategoryId(ctx, args ?? {}),\n      loadCategoryNames(ctx),\n    ]);\n    if ((args?.category_id || args?.category_name) && !categoryId) throw new Error("category_not_found");\n    const categoryName = categoryId ? (categoryNames[categoryId] ?? args?.category_name ?? null) : null;\n    const env = merchantProfile({\n      txs: txs as any,\n      period,\n      comparisonPeriod: comparison,\n      aliases,\n      categoryId,\n      query: String(args?.query ?? ""),\n    });\n    const f = env.facts;\n    const scope = categoryName ? ` em ${categoryName}` : "";\n    const headline = f.found\n      ? `${f.label}${scope}: ${brl(f.net_total)} em ${f.count} compra(s), ticket médio ${brl(f.avg_ticket)}.`\n      : `Não encontrei lançamentos de “${f.query}”${scope} nessa janela.`;\n    return withAnswerFormat({ ...env, facts: { ...f, category_id: categoryId, category_name: categoryName } }, headline, f.delta_abs);\n  });\n}'],
]);

// Preservation layers must understand the same first-class filter.
for (const path of [
  'supabase/functions/_shared/agent/core/ExecutedIRBridge.ts',
  'supabase/functions/_shared/agent/core/SemanticPreservation.ts',
]) {
  let s = fs.readFileSync(path, 'utf8');
  const before = '["category", "card", "account", "payment_method"]';
  if (!s.includes(before)) throw new Error(`expected filter list missing in ${path}`);
  s = s.replaceAll(before, '["category", "merchant", "card", "account", "payment_method"]');
  fs.writeFileSync(path, s);
}

patch('supabase/functions/_shared/agent/core/AgentCoreV2.ts', [
  ['function constraintsFromContract(contract: ConversationTurnContract, _canonical: string) {', 'function applyLowRiskFinancialReadDefault(\n  contract: CanonicalConversationTurnContract,\n  fallbackCanonicalRequest: string,\n): CanonicalConversationTurnContract {\n  if (contract.mode !== "clarify" || contract.domain !== "financial_read" || !contract.financial_read?.queries?.length) return contract;\n  if (contract.resolution.time !== "missing" || normalizePeriodExpressions(contract.focus).length > 0) return contract;\n  const unresolvedOther = [contract.resolution.intent, contract.resolution.entity, contract.resolution.reference]\n    .some((state) => state === "ambiguous" || state === "missing" || state === "conflicting");\n  if (unresolvedOther) return contract;\n  const canonicalRequest = String(contract.canonical_request ?? fallbackCanonicalRequest).trim();\n  if (!canonicalRequest) return contract;\n  return {\n    ...contract,\n    mode: "read",\n    canonical_request: canonicalRequest,\n    clarification_question: null,\n    resolution: { ...contract.resolution, time: "not_applicable" },\n  };\n}\n\nfunction constraintsFromContract(contract: ConversationTurnContract, _canonical: string) {'],
  ['  const contract: CanonicalConversationTurnContract = brain.contract;', '  const contract: CanonicalConversationTurnContract = applyLowRiskFinancialReadDefault(brain.contract, brainText);'],
]);

patch('supabase/functions/_shared/agent/core/RuntimeContract.ts', [
  ['export const AGENT_RUNTIME_VERSION = "nino-agent-p0.2026-09-25.4";', 'export const AGENT_RUNTIME_VERSION = "nino-agent-p0.2026-09-26.1";'],
]);

console.log('Nino merchant + temporal default patch applied successfully.');
