import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Combinado do fim de semana (tabela `weekend_commitments`): o limite que o Nino
// propôs na sexta e, se a pessoa aceitou pelo WhatsApp ("topo"), o acompanhamento.
// A tabela nasceu depois da geração dos tipos; leitura direta, só do próprio usuário (RLS).

export type OpenWeekendCommitment = {
  friday: string;
  category: string;
  status: "offered" | "accepted";
  target_amount: number;
  projected_if_met: number | null;
  anchor_kind: "goal" | "average" | null;
  anchor_amount: number | null;
};

/** Sexta → segunda: depois disso a oferta já não vale. */
export const WEEKEND_COMMITMENT_WINDOW_DAYS = 4;

export function weekendWindowStart(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - WEEKEND_COMMITMENT_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

export function useOpenWeekendCommitment(userId: string | undefined, today: string) {
  return useQuery<OpenWeekendCommitment | null>({
    queryKey: ["weekend-commitment", userId, today],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as unknown as (n: string) => any)("weekend_commitments")
        .select("friday,category,status,target_amount,projected_if_met,anchor_kind,anchor_amount")
        .eq("user_id", userId)
        .gte("friday", weekendWindowStart(today))
        .in("status", ["offered", "accepted"])
        .not("target_amount", "is", null)
        .order("friday", { ascending: false })
        .limit(5);
      if (error) throw error;
      const rows = ((data ?? []) as OpenWeekendCommitment[]).map((row) => ({ ...row, target_amount: Number(row.target_amount), projected_if_met: row.projected_if_met == null ? null : Number(row.projected_if_met), anchor_amount: row.anchor_amount == null ? null : Number(row.anchor_amount) }));
      return rows.find((row) => row.status === "accepted") ?? rows[0] ?? null;
    },
  });
}
