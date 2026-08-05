import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

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

export const ninoDiagnosisContextSchema = z.object({
  ok: z.literal(true),
  contract: z.literal("nino_diagnosis_contract.v1"),
  snapshot_id: z.string().uuid().nullable(),
  as_of: z.string(),
  overall_state: z.enum(["stable", "positive", "attention", "critical", "insufficient_data"]),
  primary_situation: financialSituationSchema.nullable(),
  primary_action: financialSituationActionSchema.nullable(),
  supporting_situations: z.array(financialSituationSchema),
  patterns: z.array(financialSituationSchema),
  anticipations: z.array(financialSituationSchema),
  operational_tasks: z.array(financialSituationSchema),
  forecast: z.record(z.unknown()).default({}),
  data_quality: z.record(z.unknown()).default({}),
  confidence: confidenceNumber,
  rationale: z.record(z.unknown()).default({}),
  snapshot_payload: z.record(z.unknown()).default({}),
});

export type FinancialSituation = z.infer<typeof financialSituationSchema>;
export type FinancialSituationAction = z.infer<typeof financialSituationActionSchema>;
export type NinoDiagnosisContext = z.infer<typeof ninoDiagnosisContextSchema>;

export class NinoDiagnosisContractError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "NinoDiagnosisContractError";
  }
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
    throw new NinoDiagnosisContractError(
      error instanceof Error ? error.message : "Não foi possível carregar o diagnóstico do Nino.",
      error,
    );
  }
}

/** Fonte canônica para superfícies que precisam do diagnóstico completo. */
export function useNinoDiagnosisContext() {
  const { user } = useAuth();
  return useQuery<NinoDiagnosisContext>({
    queryKey: ["nino-diagnosis", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    retry: 1,
    queryFn: fetchDiagnosis,
  });
}
