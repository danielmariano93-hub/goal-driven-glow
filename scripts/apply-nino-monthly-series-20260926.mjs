// One-shot patcher for nino_monthly_series.v1.
// It patches large runtime files atomically and fails if main drifted from the
// reviewed fragments. The workflow deletes this script after applying it.
import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value); }

function replaceOnce(path, from, to) {
  const source = read(path);
  if (!source.includes(from)) {
    throw new Error(`Expected fragment not found in ${path}: ${from.slice(0, 180)}`);
  }
  write(path, source.replace(from, to));
}

function insertAfter(path, marker, addition) {
  const source = read(path);
  const index = source.indexOf(marker);
  if (index < 0) throw new Error(`Marker not found in ${path}: ${marker}`);
  if (source.includes(addition.trim())) return;
  const at = index + marker.length;
  write(path, source.slice(0, at) + addition + source.slice(at));
}

// 1) V3 semantic shape: month-by-month factual series != typical monthly spend.
{
  const path = "supabase/functions/_shared/agent/core/FinancialIRv3.ts";
  let source = read(path);
  if (!source.includes("export function isMonthlySeriesShape")) {
    source += `\n\n/** Canonical shape for a factual month-by-month spending series. */\nexport function isMonthlySeriesShape(q: FinancialQueryV3): boolean {\n  const filterFields = new Set((q.filters ?? []).map((f) => f.field));\n  const filtersSupported = [...filterFields].every((field) => field === "category" || field === "merchant");\n  const groupSupported = (q.group_by?.length ?? 0) === 0\n    || (q.group_by.length === 1 && q.group_by[0] === "month");\n  return q.metric === "expense_amount"\n    && q.grain === "month"\n    && q.time.aspect === "trend"\n    && (q.reduce === "none" || q.reduce === "sum")\n    && Boolean(q.time.from && q.time.to)\n    && filtersSupported\n    && groupSupported;\n}\n`;
    write(path, source);
  }
}

// 2) Exact-N monthly windows for trend reads. Aggregate rolling-month semantics
// remain unchanged; only explicit decomposition/evolution phrasing enters trend.
replaceOnce(
  "supabase/functions/_shared/analytics/periodResolver.ts",
  'const TREND_RX = /\\b(evolu(cao|ção)|tendencia|trajetoria|ao longo do tempo|mes a mes)\\b/;',
  'const TREND_RX = /\\b(evolu(cao|ção)|tendencia|trajetoria|ao longo do tempo|mes a mes|mes por mes|em cada mes|separad[oa] por mes|quebrad[oa] por mes|separ(e|a|ar) por mes|mostr(e|ar) por mes|trag(a|zer) por mes|list(e|ar) por mes|quebr(e|ar) por mes)\\b/;',
);

replaceOnce(
  "supabase/functions/_shared/analytics/periodResolver.ts",
  `  if (TREND_RX.test(t)) {\n    const window = explicitPeriod ?? { ...lastCompleteMonths(HABITUAL_WINDOW_MONTHS, now), label: "últimos 6 meses completos", matched: "", complete: true, kind: "range" as const };\n    return {\n      aspect: "trend", from: window.from, to: window.to, n: null, exclude_partial: false,\n      grain: "month", reduce: "none", label: window.label, matched: window.matched ?? "",\n      assumption: null, ambiguous: false,\n    };\n  }`,
  `  if (TREND_RX.test(t)) {\n    const requested = t.match(new RegExp("\\\\bultimos?\\\\s+(" + MONTH_COUNT_TOKEN + ")\\\\s+meses?\\\\b"));\n    const count = requested ? parseMonthCount(requested[1]) : null;\n    if (count) {\n      const wantsComplete = /\\b(completos?|fechados?)\\b/.test(t);\n      if (wantsComplete) {\n        const w = lastCompleteMonths(count, now);\n        return {\n          aspect: "trend", from: w.from, to: w.to, n: count, exclude_partial: true,\n          grain: "month", reduce: "none", label: "últimos " + count + " meses completos", matched: requested?.[0] ?? "",\n          assumption: null, ambiguous: false,\n        };\n      }\n      const shifted = shiftMonthsClamped(todaySP(now), -(count - 1));\n      const from = shifted.slice(0, 7) + "-01";\n      const to = todaySP(now);\n      return {\n        aspect: "trend", from, to, n: count, exclude_partial: false,\n        grain: "month", reduce: "none", label: "últimos " + count + " meses, mês a mês", matched: requested?.[0] ?? "",\n        assumption: null, ambiguous: false,\n      };\n    }\n    const window = explicitPeriod ?? { ...lastCompleteMonths(HABITUAL_WINDOW_MONTHS, now), label: "últimos 6 meses completos", matched: "", complete: true, kind: "range" as const };\n    return {\n      aspect: "trend", from: window.from, to: window.to, n: null, exclude_partial: false,\n      grain: "month", reduce: "none", label: window.label, matched: window.matched ?? "",\n      assumption: null, ambiguous: false,\n    };\n  }`,
);

// 3) Capability validation knows this is supported before the V3 handler runs.
replaceOnce(
  "supabase/functions/_shared/agent/core/IRCapabilityAdapter.ts",
  `    if (q.operation === "trend") {\n      // Trajetória mês a mês: motor longitudinal (ponto de virada, tendência).`,
  `    if (q.operation === "trend") {\n      const monthlyCategory = filter(q, "category");\n      if (metric === "expense"\n        && (group === null || group === "month")\n        && (monthlyCategory || merchant)\n        && onlyFilters(q, ["category", "merchant"])) {\n        return {\n          tool: "spending_timeseries_monthly",\n          capability: "financial_analysis",\n          execution: "deterministic",\n          args: {\n            from: period.from, to: period.to,\n            ...(monthlyCategory ? { category_name: monthlyCategory } : {}),\n            ...(merchant ? { merchant } : {}),\n          },\n        };\n      }\n      // Trajetória mês a mês: motor longitudinal (ponto de virada, tendência).`,
);

replaceOnce(
  "supabase/functions/_shared/agent/core/IRCapabilityAdapter.ts",
  '  "expense_amount + rank|breakdown group merchant (filtro opcional: category; motor merchant_distribution)",',
  '  "expense_amount + rank|breakdown group merchant (filtro opcional: category; motor merchant_distribution)",\n  "expense_amount + trend/grain month com filtro category e/ou merchant (motor spending_timeseries_monthly)",',
);

// 4) Reuse the existing monthly-handler lane so grounding/preservation remain
// authoritative and the generic engine cannot answer a different question.
replaceOnce(
  "supabase/functions/_shared/agent/core/SemanticTurnPipeline.ts",
  `  isTypicalMonthlyShape, normalizeToV3, validateFinancialIRv3,`,
  `  isMonthlySeriesShape, isTypicalMonthlyShape, normalizeToV3, validateFinancialIRv3,`,
);
replaceOnce(
  "supabase/functions/_shared/agent/core/SemanticTurnPipeline.ts",
  `  const typicalQuery = irV3?.queries.length === 1 && isTypicalMonthlyShape(irV3.queries[0])\n    ? irV3.queries[0]\n    : null;`,
  `  const typicalQuery = irV3?.queries.length === 1\n    && (isTypicalMonthlyShape(irV3.queries[0]) || isMonthlySeriesShape(irV3.queries[0]))\n    ? irV3.queries[0]\n    : null;`,
);

// 5) Wire deterministic series into both Core generations during rollout.
for (const path of [
  "supabase/functions/_shared/agent/core/AgentCore.ts",
  "supabase/functions/_shared/agent/core/AgentCoreV2.ts",
]) {
  insertAfter(
    path,
    `} from "./handlers/TypicalMonthlyHandler.ts";`,
    `\nimport {\n  loadMonthlySpendingSeries, monthlySeriesExecutedIR, monthlySpendingSeriesText,\n} from "./handlers/MonthlySeriesHandler.ts";`,
  );

  const marker = `runTypicalMonthly: async (query) => {`;
  insertAfter(path, marker, `\n      if (query.grain === "month" && query.time.aspect === "trend") {\n        const categoryLabel = query.filters.find((f) => f.field === "category")?.value ?? null;\n        const merchantLabel = query.filters.find((f) => f.field === "merchant")?.value ?? null;\n        const categoryIds = categoryLabel\n          ? await resolveCategoryIdsByName(sb, input.user_id, String(categoryLabel))\n          : null;\n        if (categoryLabel && (!categoryIds || !categoryIds.length)) {\n          return { domain_error: "category_not_found" as const };\n        }\n        const from = String(query.time.from ?? "");\n        const to = String(query.time.to ?? "");\n        if (!from || !to) return null;\n        const result = await loadMonthlySpendingSeries(sb, {\n          user_id: input.user_id,\n          from, to,\n          category_ids: categoryIds,\n          category_label: categoryLabel ? String(categoryLabel) : null,\n          merchant: merchantLabel ? String(merchantLabel) : null,\n        });\n        return {\n          text: monthlySpendingSeriesText(result),\n          executed_ir: monthlySeriesExecutedIR(query, result),\n          engine: "spending_timeseries_monthly",\n          result,\n        };\n      }\n`);
}

// Runtime fingerprint for operational traceability.
{
  const path = "supabase/functions/_shared/agent/core/RuntimeContract.ts";
  let source = read(path);
  source = source.replace(/export const AGENT_RUNTIME_VERSION = "[^"]+";/,
    'export const AGENT_RUNTIME_VERSION = "nino-agent-p0.2026-09-26.2";');
  write(path, source);
}

console.log("nino_monthly_series.v1 patch applied successfully");
