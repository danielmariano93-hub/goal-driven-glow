import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { NinoRpcError } from "@/lib/nino/intelligence";

const finiteNumber = z.coerce.number().finite();
const confidenceNumber = finiteNumber.min(0).max(1);
const scoreNumber = finiteNumber.int().min(0).max(100);
const nullableNumber = finiteNumber.nullable().optional();

export const financialSituationSchema = z.object({
  id: z.string().uuid(),
  situation_type: z.string(),
  situation_key: z.string(),
  status: z.enum(["observed", "confirmed", "active", "improving", "worsening", "resolved", "expired", "suppressed"]),
  temporal_scope: z.enum(["now", "historical", "future"]),
  severity: z.enum(["info", "positive", "attention", "critical"]),
  confidence: confidenceNumber,
  relevance_score: scoreNumber,
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
  current_value: nullableNumber,
  baseline_value: nullableNumber,
  absolute_delta: nullableNumber,
  percentage_delta: nullableNumber,
  impact_amount: nullableNumber,
  headline: z.string(),
  narrative_role: z.enum(["primary", "support", "counterpoint", "operational"]).default("support"),
  one_line_summary: z.string().nullable().optional(),
  cause_summary: z.string().nullable().optional(),
  consequence_summary: z.string().nullable().optional(),
  forecast_summary: z.string().nullable().optional(),
  evaluation: z.record(z.unknown()).default({}),
  valid_from: z.string(),
  valid_until: z.string().nullable().optional(),
}).passthrough();

export const financialSituationActionSchema = z.object({
  id: z.string().uuid(),
  situation_id: z.string().uuid(),
  action_type: z.string(),
  title: z.string(),
  explanation: z.string().nullable().optional(),
  estimated_impact: nullableNumber,
  route: z.string(),
  priority: finiteNumber.int(),
  status: z.enum(["proposed", "accepted", "in_progress", "done", "dismissed", "expired"]),
}).passthrough();

export const financialSituationEventSchema = z.object({
  id: z.string().uuid(),
  situation_id: z.string().uuid(),
  event_type: z.string(),
  from_status: z.string().nullable().optional(),
  to_status: z.string().nullable().optional(),
  delta_amount: nullableNumber,
  narrative: z.string(),
  occurred_at: z.string(),
}).passthrough();

export const timelineEntrySchema = z.object({
  situation_id: z.string().uuid(),
  situation_key: z.string(),
  headline: z.string(),
  last_event_at: z.string(),
  events: z.array(financialSituationEventSchema),
});

export const closingSchema = z.object({
  id: z.string().uuid(),
  report_type: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  summary: z.unknown().nullable().optional(),
  closing_text: z.string().nullable().optional(),
  created_at: z.string(),
}).passthrough();

export const ninoDiagnosisContextSchema = z.object({
  ok: z.literal(true),
  contract: z.enum(["nino_diagnosis_contract.v1", "nino_diagnosis_contract.v1.1"]),
  snapshot_id: z.string().uuid().nullable(),
  as_of: z.string(),
  overall_state: z.enum(["stable", "positive", "attention", "critical", "insufficient_data"]),
  primary_situation: financialSituationSchema.nullable(),
  primary_action: financialSituationActionSchema.nullable(),
  supporting_situations: z.array(financialSituationSchema),
  patterns: z.array(financialSituationSchema),
  anticipations: z.array(financialSituationSchema),
  operational_tasks: z.array(financialSituationSchema),
  timeline: z.array(timelineEntrySchema).default([]),
  closings: z.array(closingSchema).default([]),
  narrative: z.record(z.unknown()).default({}),
  forecast: z.record(z.unknown()).default({}),
  data_quality: z.record(z.unknown()).default({}),
  confidence: confidenceNumber,
  rationale: z.record(z.unknown()).default({}),
  snapshot_payload: z.record(z.unknown()).default({}),
});

export type FinancialSituation = z.infer<typeof financialSituationSchema>;
export type FinancialSituationAction = z.infer<typeof financialSituationActionSchema>;
export type FinancialSituationEvent = z.infer<typeof financialSituationEventSchema>;
export type NinoTimelineEntry = z.infer<typeof timelineEntrySchema>;
export type NinoDiagnosisContext = z.infer<typeof ninoDiagnosisContextSchema>;

export class NinoDiagnosisContractError extends NinoRpcError {
  constructor(message: string, readonly cause?: unknown) {
    super(message, "contract", "my_nino_diagnosis_context");
    this.name = "NinoDiagnosisContractError";
  }
}

function diagnosisRpcError(error: unknown): NinoRpcError {
  const value = error as { message?: string; code?: string } | null;
  const message = value?.message ?? (error instanceof Error ? error.message : "Não foi possível carregar o diagnóstico do Nino.");
  const lower = message.toLowerCase();
  const kind = value?.code === "PGRST301" || lower.includes("jwt") || lower.includes("authenticated")
    ? "auth"
    : lower.includes("fetch") || lower.includes("network") || lower.includes("timeout")
      ? "network"
      : "rpc";
  return new NinoRpcError(message, kind, "my_nino_diagnosis_context", value?.code);
}

async function fetchDiagnosis(): Promise<NinoDiagnosisContext> {
  try {
    // supabase.rpc depende da instância do cliente; preservar o bind evita o bug
    // já observado anteriormente no núcleo do Nino.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any).call(supabase, "my_nino_diagnosis_context", {});
    if (error) throw error;
    const parsed = ninoDiagnosisContextSchema.safeParse(data);
    if (!parsed.success) {
      throw new NinoDiagnosisContractError("O diagnóstico retornou um contrato inválido.", parsed.error);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof NinoDiagnosisContractError) throw error;
    throw diagnosisRpcError(error);
  }
}

/** Fonte canônica para superfícies que precisam do diagnóstico completo. */
export function useNinoDiagnosisContext() {
  const { user } = useAuth();
  return useQuery<NinoDiagnosisContext>({
    queryKey: ["nino-diagnosis", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    retry: (count, error) => error instanceof NinoRpcError && error.kind === "network" && count < 2,
    queryFn: fetchDiagnosis,
  });
}

export function useNinoSituationFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ situationId, feedback, surface }: { situationId: string; feedback: "useful" | "not_useful" | "dismiss" | "acted"; surface: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any).call(supabase, "my_nino_situation_feedback", {
        _situation_id: situationId,
        _feedback: feedback,
        _surface: surface,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Não foi possível registrar seu feedback.");
      return data as { ok: true };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["nino-diagnosis"] }),
  });
}
