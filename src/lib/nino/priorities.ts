// nino_priority_feed.v1 — "o que importa agora" na Home.
// A Home não decide o que é importante: lê a MESMA fila que o chat usa em
// "o que importa agora?" e que o WhatsApp usa para decidir quem interrompe.
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const ninoPrioritySchema = z.object({
  rank: z.number(),
  fingerprint: z.string(),
  kind: z.string(),
  severity: z.enum(["info", "attention", "critical"]),
  title: z.string(),
  body: z.string().nullable().optional().transform((value) => value ?? ""),
  route: z.string().nullable().optional().transform((value) => value ?? null),
  impact_amount: z.coerce.number().optional().default(0),
  as_of: z.string().optional().default(""),
  computed_at: z.string().optional().default(""),
});

export type NinoPriority = z.infer<typeof ninoPrioritySchema>;

export function parseNinoPriorities(raw: unknown): NinoPriority[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ninoPrioritySchema.safeParse(item))
    .filter((result): result is { success: true; data: NinoPriority } => result.success)
    .map((result) => result.data)
    .sort((a, b) => a.rank - b.rank);
}

async function fetchNinoPriorities(): Promise<NinoPriority[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any).call(supabase, "my_nino_priorities", { _limit: 3 });
  if (error) throw error;
  return parseNinoPriorities(data);
}

/** Falha na fila nunca derruba a Home: o diagnóstico continua como reserva. */
export function useNinoPriorities() {
  const { user } = useAuth();
  return useQuery<NinoPriority[]>({
    queryKey: ["nino-priorities", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: "always",
    retry: 1,
    queryFn: fetchNinoPriorities,
  });
}
