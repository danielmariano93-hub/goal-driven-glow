import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Receipt, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { formatBRL } from "@/lib/engine/facts";
import { copy } from "@/lib/copy/strings";

export function ParaPagarResumo() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["my-shared-charges-summary", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await (supabase.from("my_shared_charges" as never) as any)
        .select("participant_id, amount_due, amount_paid, status")
        .neq("status", "paid");
      const rows = (data ?? []) as any[];
      const total = rows.reduce((s, r) => s + (Number(r.amount_due) - Number(r.amount_paid)), 0);
      return { count: rows.length, total };
    },
  });

  if (!data || data.count === 0) return null;

  return (
    <Link
      to="/app/cobrancas"
      className="flex items-center gap-3 rounded-2xl border border-brand-coral/25 bg-brand-coral/5 p-4 shadow-card hover:border-brand-coral/50"
    >
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-coral/15 text-brand-coral">
        <Receipt size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{copy.charges.title}</p>
        <p className="text-xs text-muted-foreground">
          {data.count} cobrança(s) · {formatBRL(data.total)} pendente(s)
        </p>
      </div>
      <ArrowRight size={16} className="text-muted-foreground" />
    </Link>
  );
}
