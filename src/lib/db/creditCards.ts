import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { CreditCardInput } from "@/lib/validation/creditCards";
import { computeCompetenceDateISO } from "@/lib/validation/creditCards";

export type CreditCardRow = {
  id: string;
  user_id: string;
  name: string;
  brand: string | null;
  last_four: string | null;
  total_limit: number;
  closing_day: number;
  due_day: number;
  color: string | null;
  statement_goal: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export function useCreditCards() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["credit_cards", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_cards" as never)
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as unknown as CreditCardRow[]) ?? [];
    },
  });
}

export function useSaveCreditCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreditCardInput & { id?: string }) => {
      if (!user) throw new Error("not authenticated");
      const payload = {
        user_id: user.id,
        name: input.name,
        brand: input.brand || null,
        last_four: input.last_four || null,
        total_limit: input.total_limit,
        closing_day: input.closing_day,
        due_day: input.due_day,
        color: input.color || null,
        statement_goal: input.statement_goal ?? null,
        active: input.active,
      };
      if (input.id) {
        const { error } = await supabase.from("credit_cards" as never).update(payload as never).eq("id" as never, input.id as never);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("credit_cards" as never).insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit_cards"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteCreditCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("credit_cards" as never).delete().eq("id" as never, id as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["credit_cards"] }),
  });
}

/** Cria uma compra no cartão gerando N linhas de transactions (uma por parcela). */
export function useCreateCardPurchase() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      credit_card_id: string;
      closing_day: number;
      amount: number;
      installments: number;
      purchase_date: string; // YYYY-MM-DD
      description?: string | null;
      category_id?: string | null;
    }) => {
      if (!user) throw new Error("not authenticated");
      const installments = Math.max(1, Math.min(48, input.installments || 1));
      const cents = Math.round(input.amount * 100);
      const base = Math.floor(cents / installments);
      const remainder = cents - base * installments;
      const firstCompetence = computeCompetenceDateISO(input.purchase_date, input.closing_day);
      const [fy, fm] = firstCompetence.split("-").map(Number);

      const rows = Array.from({ length: installments }, (_, i) => {
        const y = fy;
        const m0 = fm - 1 + i;
        const yy = y + Math.floor(m0 / 12);
        const mm = ((m0 % 12) + 12) % 12;
        const competence = `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
        const parcelCents = base + (i === 0 ? remainder : 0);
        return {
          user_id: user.id,
          account_id: null,
          category_id: input.category_id || null,
          type: "expense" as const,
          status: "confirmed" as const,
          amount: parcelCents / 100,
          occurred_at: input.purchase_date,
          description:
            (input.description || "Compra no cartão") +
            (installments > 1 ? ` (${i + 1}/${installments})` : ""),
          payment_method: "credit_card",
          credit_card_id: input.credit_card_id,
          installment_number: i + 1,
          installments_total: installments,
          purchase_date: input.purchase_date,
          competence_date: competence,
        };
      });

      const { error } = await supabase.from("transactions").insert(rows as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["credit_cards"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
