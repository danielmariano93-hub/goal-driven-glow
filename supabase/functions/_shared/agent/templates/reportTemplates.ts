// Templates de relatório determinísticos.
// Fatia E parte 2: casamento de texto → template_key registrado em
// public.financial_report_templates. NÃO substitui o roteamento pelo LLM;
// é usado como pré-classificador determinístico (bypass sem custo).
import { z } from "https://esm.sh/zod@3.23.8";

export const TEMPLATE_KEYS = ["spending_trend", "monthly_comparison", "weekly_one_page"] as const;
export type TemplateKey = typeof TEMPLATE_KEYS[number];

export const templateParamsSchema = {
  spending_trend: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  monthly_comparison: z.object({
    metric: z.enum(["expense", "income"]).default("expense"),
  }),
  weekly_one_page: z.object({
    weeks_back: z.number().int().min(0).max(12).default(0),
  }),
} as const;

export type TemplateMatch = {
  template_key: TemplateKey;
  params: Record<string, unknown>;
};

// Regexes desenhados para altíssima precisão: negam frases genéricas
// como "quanto gastei" ou "onde gasto mais" (essas seguem por analyze_spending).
const RX = {
  spending_trend: [
    /\b(evolu[cç][aã]o|tend[eê]ncia|hist[oó]rico)\s+(dos?\s+)?(meus\s+)?gastos?\b/i,
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
// A resolução real do artefato reaproveita as tools existentes,
// evitando duplicar a fundação analítica.
export function templateToArtifactArgs(m: TemplateMatch): {
  kind: "compare" | "timeseries" | "average_daily_trend";
  args: Record<string, unknown>;
} {
  if (m.template_key === "monthly_comparison") {
    return { kind: "compare", args: { metric: (m.params as any).metric ?? "expense" } };
  }
  if (m.template_key === "weekly_one_page") {
    // one_page semanal = série diária dos últimos 7 dias
    return { kind: "timeseries", args: { metric: "expense", days: 7 } };
  }
  // spending_trend = média diária acumulada
  return { kind: "average_daily_trend", args: {} };
}
