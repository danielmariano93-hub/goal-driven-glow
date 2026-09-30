import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// Contrato do "Antes de gastar" mês a mês (`nino_purchase_plan.v1`).
const verdictSchema = z.enum(["fits", "tight", "deficit", "worsens_deficit"]);

export const purchasePlanSchema = z.object({
  version: z.literal("nino_purchase_plan.v1"),
  verdict: z.union([verdictSchema, z.literal("unknown")]),
  headline: z.string(),
  explanation: z.string(),
  months: z.array(z.object({
    month: z.string(),
    label: z.string(),
    purchase: z.number(),
    income: z.number(),
    income_basis: z.enum(["typical", "realized"]),
    outflow: z.number(),
    outflow_basis: z.enum(["typical", "committed", "realized_plus_pace"]),
    fixed_commitments: z.number(),
    contracted_installments: z.number(),
    margin_before: z.number(),
    margin_after: z.number(),
    verdict: verdictSchema,
    summary: z.string(),
    category: z.object({
      name: z.string(),
      typical: z.number(),
      after: z.number(),
      limit: z.number().nullable(),
      exceeds_limit: z.boolean(),
      times_typical: z.number().nullable(),
      text: z.string(),
    }).nullable(),
  })),
  fixed_commitments: z.array(z.object({ label: z.string(), amount: z.number() })),
  notes: z.array(z.string()),
  basis: z.object({
    months_of_history: z.number(),
    income_reliable: z.boolean(),
    typical_income: z.number(),
    typical_spend: z.number(),
    weakest_income: z.number().nullable(),
  }),
});

export type PurchasePlan = z.infer<typeof purchasePlanSchema>;
export type PurchasePlanVerdict = PurchasePlan["verdict"];

export type PurchasePlanRequest = {
  amount: number;
  category_id: string | null;
  category_name: string;
  months: Array<{ month: string; amount: number }>;
  category_limits: Record<string, number | null>;
};

export function usePurchasePlan(request: PurchasePlanRequest | null) {
  const { user } = useAuth();
  return useQuery<PurchasePlan>({
    queryKey: ["purchase-plan", user?.id, request],
    enabled: !!user && !!request,
    staleTime: 2 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("nino-insights", { body: { action: "simulate", purchase: request } });
      if (error) throw error;
      const parsed = purchasePlanSchema.safeParse((data as { plan?: unknown } | null)?.plan);
      if (!parsed.success) throw new Error("Projeção em formato inesperado.");
      return parsed.data;
    },
  });
}

/** Competência (YYYY-MM) de cada parcela: a 1ª na fatura do ciclo, as demais nos meses seguintes. */
export function purchaseMonths(args: {
  method: "cash" | "card";
  plannedDate: string;
  cardCompetence: string | null;
  installments: number;
  installmentAmount: number;
  amount: number;
}): Array<{ month: string; amount: number }> {
  if (args.method !== "card") return [{ month: args.plannedDate.slice(0, 7), amount: args.amount }];
  const first = (args.cardCompetence ?? args.plannedDate).slice(0, 7);
  const [year, month] = first.split("-").map(Number);
  return Array.from({ length: Math.max(1, args.installments) }, (_, index) => {
    const d = new Date(Date.UTC(year, month - 1 + index, 1));
    return { month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, amount: args.installmentAmount };
  });
}

/** Limite da meta da categoria em cada mês: recorrente vale todo mês; senão só dentro do período. */
export function categoryLimitsFor(
  months: string[],
  goal: { targetAmount: number; periodType: string; period: { start: string; end: string }; goal: { start_date: string } } | null | undefined,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const month of months) {
    if (!goal) { out[month] = null; continue; }
    if (goal.periodType === "monthly_recurring") {
      out[month] = month >= goal.goal.start_date.slice(0, 7) ? goal.targetAmount : null;
    } else {
      out[month] = month >= goal.period.start.slice(0, 7) && month <= goal.period.end.slice(0, 7) ? goal.targetAmount : null;
    }
  }
  return out;
}
