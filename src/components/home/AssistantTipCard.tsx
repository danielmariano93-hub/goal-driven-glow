import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, ThumbsUp, ThumbsDown, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { copy } from "@/lib/copy/strings";
import {
  pickFallback,
  CTA_ROUTE_RX,
  type InsightFacts,
  type InsightPayload,
} from "@/lib/insights/fallbacks";
import { useAllTransactions, useGoals } from "@/lib/db/finance";

type Insight = {
  id: string;
  type: string;
  title: string;
  body: string;
  cta_label: string | null;
  cta_route: string | null;
  status: string;
  feedback: string | null;
  generated_at: string;
  expires_at: string;
  model: string | null;
};

function isRenderable(i: Pick<Insight, "title" | "body"> | null | undefined): boolean {
  return !!i && typeof i.title === "string" && !!i.title.trim() && typeof i.body === "string" && !!i.body.trim();
}

export function AssistantTipCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [lastForceAt, setLastForceAt] = useState(0);

  const { data: txs } = useAllTransactions();
  const { data: goals } = useGoals();

  const facts: InsightFacts = useMemo(() => {
    const ym = new Date().toISOString().slice(0, 7);
    const arr = (txs ?? []) as Array<{ type: string; amount: number | string; occurred_at: string; status?: string }>;
    const monthTxs = arr.filter(
      (t) => (t.status ?? "confirmed") === "confirmed" && t.occurred_at?.startsWith(ym),
    );
    const income = monthTxs.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
    const expense = monthTxs.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
    return {
      total_tx_ever: arr.length,
      month: ym,
      income_month: income,
      expense_month: expense,
      balance_month: income - expense,
      active_goals: (goals ?? []).length,
      goal_names: (goals ?? []).slice(0, 3).map((g: any) => g.name).filter(Boolean),
    };
  }, [txs, goals]);

  const { data, isLoading, refetch } = useQuery<Insight | null>({
    queryKey: ["assistant-tip", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_insights" as never)
        .select("*")
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .order("generated_at", { ascending: false })
        .limit(5);
      const list = ((data as Insight[] | null) ?? []).filter(isRenderable);
      return list[0] ?? null;
    },
  });

  const generate = async (force = false) => {
    if (generating) return;
    if (force && Date.now() - lastForceAt < 60_000) {
      toast.message("Aguarde alguns segundos antes de gerar outra dica.");
      return;
    }
    setGenerating(true);
    if (force) setLastForceAt(Date.now());
    try {
      await supabase.functions.invoke("insights-generate", { body: force ? { force: true } : {} });
      await refetch();
    } catch {
      /* silencioso, usaremos fallback local */
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (isLoading || generating || data || !user) return;
    void generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, data, user]);

  const sendFeedback = async (value: "useful" | "not_useful") => {
    if (!data) return;
    await (supabase.from("user_insights" as never) as any)
      .update({ feedback: value })
      .eq("id", data.id);
    toast.success(copy.tip.thanks);
    qc.invalidateQueries({ queryKey: ["assistant-tip"] });
  };

  // Determine payload: server insight, else local fallback (never empty).
  const localFallback: InsightPayload = useMemo(() => pickFallback(facts), [facts]);
  const usingLocal = !isRenderable(data);
  const title = usingLocal ? localFallback.title : data!.title;
  const body = usingLocal ? localFallback.body : data!.body;
  const ctaLabel = usingLocal
    ? localFallback.cta_label
    : (data!.cta_label && data!.cta_label.trim()) || localFallback.cta_label;
  const rawRoute = usingLocal ? localFallback.cta_route : data!.cta_route ?? localFallback.cta_route;
  const ctaRoute = rawRoute && CTA_ROUTE_RX.test(rawRoute) ? rawRoute : "/app/lancamentos";

  // Skeleton only on very first load (no data, still loading, no facts yet).
  if (isLoading && !data) {
    return (
      <section
        aria-label={copy.tip.header}
        className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/8 via-card to-accent/10 p-5 shadow-card"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          {copy.tip.header}
        </div>
        <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted" />
        <div className="mt-1.5 h-3 w-5/6 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-8 w-32 animate-pulse rounded-full bg-muted" />
      </section>
    );
  }

  return (
    <section
      aria-label={copy.tip.header}
      className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/8 via-card to-accent/10 p-5 shadow-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          {copy.tip.header}
        </div>
        <button
          type="button"
          onClick={() => generate(true)}
          disabled={generating}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:text-primary disabled:opacity-50"
          aria-label="Gerar nova dica"
          title="Gerar nova dica"
        >
          {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          <span>Nova dica</span>
        </button>
      </div>
      <h3 className="mt-2 font-display text-base font-bold leading-snug">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>

      <div className="mt-4 flex items-center justify-between gap-2">
        <Link
          to={ctaRoute}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-95"
        >
          {ctaLabel} <ArrowRight size={12} />
        </Link>

        {!usingLocal && data && !data.feedback && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <button
              onClick={() => sendFeedback("useful")}
              aria-label={copy.tip.feedbackUseful}
              className="rounded-full p-1.5 hover:text-primary"
              title={copy.tip.feedbackUseful}
            >
              <ThumbsUp size={13} />
            </button>
            <button
              onClick={() => sendFeedback("not_useful")}
              aria-label={copy.tip.feedbackNotUseful}
              className="rounded-full p-1.5 hover:text-destructive"
              title={copy.tip.feedbackNotUseful}
            >
              <ThumbsDown size={13} />
            </button>
          </div>
        )}

        {generating && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> pensando…
          </span>
        )}
      </div>
    </section>
  );
}
