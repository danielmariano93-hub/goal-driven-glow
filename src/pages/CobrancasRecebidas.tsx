import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, AlertTriangle, RotateCcw, Receipt } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { formatBRL } from "@/lib/engine/facts";
import { copy } from "@/lib/copy/strings";

type Row = {
  participant_id: string;
  shared_expense_id: string;
  title: string;
  occurred_at: string;
  due_date: string | null;
  pix_key: string | null;
  amount_due: number;
  amount_paid: number;
  status: string;
  dispute_status: string;
  owner_display_name: string;
  created_at: string;
};

export default function CobrancasRecebidas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my-shared-charges", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase.from("my_shared_charges" as never) as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const act = async (id: string, action: "reported_paid" | "disputed" | "clear") => {
    setBusyId(id);
    const { error } = await supabase.rpc("split_participant_report" as never, {
      p_participant_id: id,
      p_action: action,
    } as never);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(
      action === "reported_paid"
        ? "Marcado como pago"
        : action === "disputed"
        ? "Contestação enviada"
        : "Aviso removido"
    );
    qc.invalidateQueries({ queryKey: ["my-shared-charges"] });
    qc.invalidateQueries({ queryKey: ["my-shared-charges-summary"] });
  };

  return (
    <div className="space-y-5 pt-2">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{copy.charges.title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{copy.charges.subtitle}</p>
      </header>

      {isLoading ? (
        <div className="grid place-items-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Receipt className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Tudo em dia por aqui</p>
          <p className="mt-1 text-xs text-muted-foreground">{copy.charges.empty}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((c) => {
            const remaining = Number(c.amount_due) - Number(c.amount_paid);
            const isPaid = c.status === "paid";
            const busy = busyId === c.participant_id;
            return (
              <li key={c.participant_id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{c.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {copy.charges.included(c.owner_display_name, c.title)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(c.occurred_at).toLocaleDateString("pt-BR")}
                      {c.due_date ? ` · vence ${new Date(c.due_date).toLocaleDateString("pt-BR")}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold tabular-nums">{formatBRL(remaining)}</p>
                    {c.amount_paid > 0 && !isPaid && (
                      <p className="text-[10px] text-muted-foreground">
                        já pago {formatBRL(Number(c.amount_paid))}
                      </p>
                    )}
                  </div>
                </div>

                {c.dispute_status !== "none" && (
                  <p className="mt-2 text-[11px] text-brand-coral">
                    {c.dispute_status === "reported_paid" ? copy.charges.reported : copy.charges.disputed}
                  </p>
                )}

                {c.pix_key && (
                  <p className="mt-2 rounded-lg bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
                    PIX: <span className="font-mono">{c.pix_key}</span>
                  </p>
                )}

                {!isPaid && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {c.dispute_status === "none" ? (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => act(c.participant_id, "reported_paid")}
                          className="inline-flex items-center gap-1 rounded-full bg-success/15 px-3 py-1.5 text-xs font-medium text-success disabled:opacity-40"
                        >
                          <CheckCircle2 size={12} /> {copy.charges.reportPaid}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => act(c.participant_id, "disputed")}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs disabled:opacity-40"
                        >
                          <AlertTriangle size={12} /> {copy.charges.dispute}
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => act(c.participant_id, "clear")}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-40"
                      >
                        <RotateCcw size={12} /> {copy.charges.clear}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
