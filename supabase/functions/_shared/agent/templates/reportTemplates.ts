// Templates de relatório determinísticos.
// Fatia E parte 2: casamento de texto → template_key registrado em
// public.financial_report_templates. NÃO substitui o roteamento pelo LLM;
// é usado como pré-classificador determinístico (bypass sem custo).
// Nota: mantemos tipos puros de TS para permitir import direto pelo vitest
// (sem resolver especifiers HTTPS estilo Deno). A validação estrita fica
// nos parameters JSON Schema da tool.

export const TEMPLATE_KEYS = ["spending_trend", "monthly_comparison", "weekly_one_page"] as const;
export type TemplateKey = typeof TEMPLATE_KEYS[number];

export type TemplateParams =
  | { template_key: "spending_trend"; from?: string; to?: string }
  | { template_key: "monthly_comparison"; metric?: "expense" | "income" }
  | { template_key: "weekly_one_page"; weeks_back?: number };

export type TemplateMatch = {
  template_key: TemplateKey;
  params: Record<string, unknown>;
};

// Regexes desenhados para altíssima precisão: negam frases genéricas
// como "quanto gastei" ou "onde gasto mais" (essas seguem por analyze_spending).
const RX = {
  spending_trend: [
    /\b(evolu[cç][aã]o|tend[eê]ncia|hist[oó]rico)\s+(dos?\s+)?(meus?\s+)?gastos?\b/i,
    /\bgasto\s+(m[eé]dio|di[aá]rio|dia\s+a\s+dia)\b/i,
    /\bestou\s+(reduzindo|gastando\s+menos)\b/i,
    /\bandando\s+de\s+lado\b/i,
  ],
  monthly_comparison: [
    /\bcompar[ae]r?\s+(com\s+)?(o\s+)?m[eê]s\s+(passado|anterior)\b/i,
    /\bvs\.?\s*m[eê]s\s+(passado|anterior)\b/i,
    /\bm[eê]s\s+atual\s+(vs|contra|comparado)\b/i,
    /\bo\s+que\s+mudou\s+(de\s+um\s+m[eê]s\s+pra?\s+outro|do\s+m[eê]s\s+passado)\b/i,
  ],
  weekly_one_page: [
    /\bone\s*[- ]?\s*page\b/i,
    /\bresumo\s+semanal\b/i,
    /\brelat[oó]rio\s+(da\s+)?semana\b/i,
    /\b(minha|a)\s+semana\s+(em\s+um|numa)\s+p[aá]gina\b/i,
  ],
} as const;

export function matchTemplate(text: string): TemplateMatch | null {
  const t = (text ?? "").toString();
  if (!t.trim()) return null;
  // Ordem: templates mais específicos primeiro (one_page > monthly_comparison > spending_trend).
  const order: TemplateKey[] = ["weekly_one_page", "monthly_comparison", "spending_trend"];
  for (const key of order) {
    for (const rx of RX[key]) {
      if (rx.test(t)) {
        return { template_key: key, params: defaultParams(key) };
      }
    }
  }
  return null;
}

function defaultParams(key: TemplateKey): Record<string, unknown> {
  if (key === "monthly_comparison") return { metric: "expense" };
  if (key === "weekly_one_page") return { weeks_back: 0 };
  return {};
}

// Mapeia template → (kind do ChartArtifact, args para generate_chart_artifact).
// Aceita tanto o formato bruto (TemplateMatch) quanto o validado por Zod.
export function templateToArtifactArgs(m: {
  template_key: TemplateKey;
  params?: Record<string, unknown>;
}): {
  kind: "compare" | "timeseries" | "average_daily_trend";
  args: Record<string, unknown>;
} {
  const params = m.params ?? {};
  if (m.template_key === "monthly_comparison") {
    return {
      kind: "compare",
      args: { metric: (params as any).metric ?? "expense" },
    };
  }
  if (m.template_key === "weekly_one_page") {
    const weeksBack = Number((params as any).weeks_back ?? 0);
    if (!weeksBack || weeksBack <= 0) {
      return { kind: "timeseries", args: { metric: "expense", days: 7 } };
    }
    // Semana N atrás: janela de 7 dias terminando (weeksBack*7) dias antes de hoje.
    const today = new Date();
    const to = new Date(today);
    to.setUTCDate(to.getUTCDate() - weeksBack * 7);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 6);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return {
      kind: "timeseries",
      args: { metric: "expense", from: iso(from), to: iso(to) },
    };
  }
  // spending_trend: passa from/to quando informado.
  const args: Record<string, unknown> = {};
  if ((params as any).from) args.from = (params as any).from;
  if ((params as any).to) args.to = (params as any).to;
  return { kind: "average_daily_trend", args };
}
