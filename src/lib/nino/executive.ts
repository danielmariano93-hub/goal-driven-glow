import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// Contrato do motor executivo (`nino_executive_insights.v1`).
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ask"), label: z.string(), prompt: z.string(), detail: z.string().nullable() }),
  z.object({ type: z.literal("route"), label: z.string(), route: z.string(), detail: z.string().nullable() }),
]);

export const executiveInsightSchema = z.object({
  key: z.string(),
  kind: z.string(),
  direction: z.enum(["worse", "better", "neutral"]),
  severity: z.enum(["critical", "attention", "positive", "info"]),
  section: z.enum(["agora", "mudancas", "aprendizados"]),
  headline: z.string(),
  why: z.string(),
  evidence: z.array(z.string()).default([]),
  action: actionSchema.nullable(),
  impact_monthly: z.number(),
  score: z.number(),
});

export const executiveBriefingSchema = z.object({
  version: z.literal("nino_executive_insights.v1"),
  as_of: z.string(),
  reference_month: z.string(),
  kpis: z.array(z.object({
    label: z.string(),
    value: z.string(),
    hint: z.string().nullable(),
    tone: z.enum(["good", "bad", "neutral"]),
  })).default([]),
  insights: z.array(executiveInsightSchema).default([]),
  coverage: z.object({ months_of_history: z.number(), income_reliable: z.boolean(), learning: z.boolean() }),
});

export type ExecutiveInsight = z.infer<typeof executiveInsightSchema>;
export type ExecutiveBriefing = z.infer<typeof executiveBriefingSchema>;
export type ExecutiveSection = "agora" | "mudancas" | "aprendizados";

const KEY = ["nino-executive-insights"] as const;

async function call(action: "get" | "refresh"): Promise<ExecutiveBriefing> {
  const { data, error } = await supabase.functions.invoke("nino-insights", { body: { action } });
  if (error) throw error;
  const parsed = executiveBriefingSchema.safeParse((data as { briefing?: unknown } | null)?.briefing);
  if (!parsed.success) throw new Error("Leitura executiva em formato inesperado.");
  return parsed.data;
}

export function useExecutiveInsights() {
  const { user } = useAuth();
  return useQuery<ExecutiveBriefing>({
    queryKey: [...KEY, user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: () => call("get"),
  });
}

export function useExecutiveRefresh() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: () => call("refresh"),
    onSuccess: (briefing) => qc.setQueryData([...KEY, user?.id], briefing),
  });
}

export function useExecutiveFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { insight: ExecutiveInsight; feedback: "useful" | "not_useful" | "acted" }) => {
      const { error } = await supabase.functions.invoke("nino-insights", {
        body: { action: "feedback", key: args.insight.key, kind: args.insight.kind, feedback: args.feedback },
      });
      if (error) throw error;
    },
    onSuccess: (_data, args) => {
      // "Não ajudou" tira a leitura da tela na hora (o servidor silencia por 30 dias).
      if (args.feedback !== "not_useful") return;
      qc.setQueriesData<ExecutiveBriefing>({ queryKey: KEY }, (current) =>
        current ? { ...current, insights: current.insights.filter((i) => i.key !== args.insight.key) } : current);
    },
  });
}

/** "Agora": a pauta — o que mais pesa, com um contraponto positivo quando existe. */
export function executiveForSection(briefing: ExecutiveBriefing | undefined, section: ExecutiveSection): ExecutiveInsight[] {
  const all = briefing?.insights ?? [];
  if (section === "agora") {
    const top = all.slice(0, 5);
    const positive = all.find((i) => i.direction === "better");
    if (positive && !top.includes(positive) && top.length) top[top.length - 1] = positive;
    return top;
  }
  return all.filter((i) => i.section === section);
}
