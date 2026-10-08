import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export type BankBalanceGap = { bank: number; nino: number; diff: number; readAt: string };

/** Leitura mais velha que isso deixa de ser mencionada (o saldo do banco muda o dia todo). */
export const GAP_MAX_AGE_MS = 48 * 3_600_000;
/** Abaixo disso não é diferença "para analisar" (arredondamento/centavos). */
export const GAP_MIN_ABS = 1;

type Reading = { bank_balance: number | string; nino_balance: number | string; read_at: string };

/** Pura e testável: soma as leituras recentes e só devolve algo quando há diferença relevante. */
export function summarizeBankGap(rows: Reading[], now = Date.now()): BankBalanceGap | null {
  const fresh = rows.filter((r) => now - Date.parse(r.read_at) <= GAP_MAX_AGE_MS);
  if (fresh.length === 0) return null;
  const bank = fresh.reduce((a, r) => a + Number(r.bank_balance), 0);
  const nino = fresh.reduce((a, r) => a + Number(r.nino_balance), 0);
  const diff = Math.round((nino - bank) * 100) / 100;
  if (!Number.isFinite(diff) || Math.abs(diff) < GAP_MIN_ABS) return null;
  const readAt = fresh.map((r) => r.read_at).sort().at(-1) as string;
  return { bank: Math.round(bank * 100) / 100, nino: Math.round(nino * 100) / 100, diff, readAt };
}

/** Só existe para quem tem o Open Finance; para os demais a consulta volta vazia e nada aparece. */
export function useBankBalanceGap() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["bank_balance_gap", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BankBalanceGap | null> => {
      const { data, error } = await supabase.from("bank_balance_readings" as never).select("bank_balance,nino_balance,read_at");
      if (error) return null;
      return summarizeBankGap((data ?? []) as unknown as Reading[]);
    },
  });
}
