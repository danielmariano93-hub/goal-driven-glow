// Evidence-grounded temporal grading for synthetic agent evaluations.
// A financial amount alone is not a valid answer to a time-bound question.
// The evaluator checks the *actual executed tool windows* independently of
// the natural-language response and of the interpreter's own contract.
const pad = (n) => String(n).padStart(2, "0");
const windowKey = (w) => w && typeof w.from === "string" && typeof w.to === "string"
  ? `${w.from}..${w.to}` : null;

export function expectedComparisonWindows(today, mode = "same_days") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today ?? ""))) return null;
  const date = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== today) return null;
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1;
  const py = month === 1 ? year - 1 : year;
  const pm = month === 1 ? 12 : month - 1;
  const previousEnd = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const current = { from: `${year}-${pad(month)}-01`, to: today };
  const baseline = {
    from: `${py}-${pad(pm)}-01`,
    to: `${py}-${pad(pm)}-${pad(mode === "previous_full_month" ? previousEnd : Math.min(date.getUTCDate(), previousEnd))}`,
  };
  return { current, baseline };
}

export function gradeExecutedComparison({ tool_calls = [], today, mode = "same_days" } = {}) {
  const expected = expectedComparisonWindows(today, mode);
  if (!expected) return { verdict: "UNVERIFIED", why: "data de referência inválida" };
  const comparisons = (Array.isArray(tool_calls) ? tool_calls : [])
    .filter((call) => call?.tool_name === "compare_periods" && call?.ok === true);
  if (!comparisons.length) return { verdict: "UNVERIFIED", why: "não há execução compare_periods comprovada" };
  const expectedSet = [windowKey(expected.current), windowKey(expected.baseline)].sort();
  const allMatch = comparisons.every((call) => {
    const observed = [windowKey(call.args?.period_a), windowKey(call.args?.period_b)];
    return observed.every(Boolean) && observed.sort().every((key, index) => key === expectedSet[index]);
  });
  if (allMatch) {
    return { verdict: "CORRECT", why: "todas as janelas executadas conferem com o gabarito independente" };
  }
  const observed = comparisons.map((call) => [
    windowKey(call.args?.period_a) ?? "ausente",
    windowKey(call.args?.period_b) ?? "ausente",
  ].join(" vs ")).join("; ");
  return {
    verdict: "WRONG",
    why: `janelas executadas divergentes: ${observed}; esperado: ${expectedSet.join(" vs ")}`,
  };
}
