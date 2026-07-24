// Validação Zod para os parâmetros dos templates determinísticos.
// Mantém tipos puros de TS/Zod para permitir import direto pelo vitest
// (usamos o mesmo `zod` já resolvido pelo bundler do projeto).
import { z } from "npm:zod@3.23.8";
import { TEMPLATE_KEYS, type TemplateKey } from "./reportTemplates.ts";

const yyyymmdd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const SpendingTrendParams = z
  .object({
    from: yyyymmdd.optional(),
    to: yyyymmdd.optional(),
  })
  .strict();

export const MonthlyComparisonParams = z
  .object({
    metric: z.enum(["expense", "income"]).default("expense"),
  })
  .strict();

export const WeeklyOnePageParams = z
  .object({
    weeks_back: z.number().int().min(0).max(52).default(0),
  })
  .strict();

const SCHEMAS = {
  spending_trend: SpendingTrendParams,
  monthly_comparison: MonthlyComparisonParams,
  weekly_one_page: WeeklyOnePageParams,
} as const satisfies Record<TemplateKey, z.ZodTypeAny>;

export type ParsedTemplateParams =
  | { template_key: "spending_trend"; params: z.infer<typeof SpendingTrendParams> }
  | { template_key: "monthly_comparison"; params: z.infer<typeof MonthlyComparisonParams> }
  | { template_key: "weekly_one_page"; params: z.infer<typeof WeeklyOnePageParams> };

export type ParseResult =
  | { ok: true; value: ParsedTemplateParams }
  | { ok: false; error: string; details?: unknown };

export function parseTemplateArgs(
  template_key: string,
  params: unknown,
): ParseResult {
  if (!TEMPLATE_KEYS.includes(template_key as TemplateKey)) {
    return { ok: false, error: "unknown_template" };
  }
  const key = template_key as TemplateKey;
  const schema = SCHEMAS[key];
  const raw = params ?? {};
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid_template_params",
      details: parsed.error.flatten(),
    };
  }
  return { ok: true, value: { template_key: key, params: parsed.data } as ParsedTemplateParams };
}
