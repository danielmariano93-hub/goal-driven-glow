import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, XCircle } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Suggestion = {
  id: string;
  kind: string;
  title: string;
  body: string;
  dedup_key: string;
  evidence: Record<string, unknown>;
  created_at: string;
};

type Detail = { suggestion: Suggestion; deliveries: Array<Record<string, unknown>> };

type TransactionEvidence = {
  id: string;
  description?: string;
  amount?: number;
  occurred_at?: string;
};

const rpc = (supabase as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
}).rpc.bind(supabase);

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

async function loadSuggestion(dedupKey: string): Promise<Detail> {
  const { data, error } = await rpc("my_proactive_suggestion", { _dedup_key: dedupKey });
  if (error) throw new Error(error.message || "Não foi possível carregar o alerta.");
  return data as Detail;
}

async function sendFeedback(dedupKey: string, feedback: string): Promise<void> {
  const { error } = await rpc("my_proactive_suggestion_feedback", {
    _dedup_key: dedupKey,
    _feedback: feedback,
  });
  if (error) throw new Error(error.message || "Não foi possível registrar sua resposta.");
}

export default function ProactiveAlertDetail() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams();
  const dedupKey = decodeURIComponent(params.dedupKey ?? "");
  const query = useQuery({
    queryKey: ["proactive-alert", dedupKey],
    queryFn: () => loadSuggestion(dedupKey),
    enabled: Boolean(dedupKey),
  });
  const feedback = useMutation({
    mutationFn: (value: string) => sendFeedback(dedupKey, value),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["proactive-alert", dedupKey] }),
        queryClient.invalidateQueries({ queryKey: ["nino-context"] }),
      ]);
      toast.success("Resposta registrada. O Nino vai considerar isso nos próximos alertas.");
      navigate("/app/notificacoes");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const transactions = useMemo(() => {
    const raw = query.data?.suggestion?.evidence?.transactions;
    return Array.isArray(raw) ? raw as TransactionEvidence[] : [];
  }, [query.data]);

  if (query.isLoading) return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (query.isError || !query.data) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-card p-6">
        <p className="text-sm font-semibold">Este alerta não está mais disponível.</p>
        <p className="mt-1 text-xs text-muted-foreground">{(query.error as Error)?.message}</p>
        <Link to="/app/notificacoes" className="mt-4 inline-flex text-xs font-semibold text-primary">Voltar às notificações</Link>
      </div>
    );
  }

  const suggestion = query.data.suggestion;
  const isDuplicate = suggestion.kind === "duplicate_expense";

  return (
    <div className="space-y-5 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Alerta do Nino</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">{suggestion.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{suggestion.body}</p>
      </header>

      {transactions.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h2 className="text-sm font-semibold">Lançamentos comparados</h2>
          </div>
          <div className="mt-3 space-y-2">
            {transactions.map((transaction) => (
              <Link
                key={transaction.id}
                to={`/app/lancamentos/${transaction.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{transaction.description || "Lançamento"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {transaction.occurred_at ? new Date(`${transaction.occurred_at}T12:00:00`).toLocaleDateString("pt-BR") : "Data não informada"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-bold">{BRL.format(Number(transaction.amount ?? 0))}</span>
                  <ChevronRight size={15} className="text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <h2 className="text-sm font-semibold">Isso ajudou?</h2>
        <p className="mt-1 text-xs text-muted-foreground">Sua resposta reduz falsos positivos e repetições.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {isDuplicate ? (
            <>
              <button
                type="button"
                disabled={feedback.isPending}
                onClick={() => feedback.mutate("duplicate_confirmed")}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                <CheckCircle2 size={14} /> É uma duplicidade
              </button>
              <button
                type="button"
                disabled={feedback.isPending}
                onClick={() => feedback.mutate("not_duplicate")}
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold disabled:opacity-60"
              >
                <XCircle size={14} /> São lançamentos diferentes
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={feedback.isPending} onClick={() => feedback.mutate("useful")} className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">Foi útil</button>
              <button type="button" disabled={feedback.isPending} onClick={() => feedback.mutate("not_useful")} className="rounded-full border border-border px-4 py-2 text-xs font-semibold disabled:opacity-60">Não foi útil</button>
            </>
          )}
          <button type="button" disabled={feedback.isPending} onClick={() => feedback.mutate("dismissed")} className="rounded-full border border-border px-4 py-2 text-xs text-muted-foreground disabled:opacity-60">Agora não</button>
        </div>
      </section>
    </div>
  );
}
