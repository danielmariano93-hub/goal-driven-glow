import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, ThumbsUp, ThumbsDown, ArrowRight, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { copy } from "@/lib/copy/strings";

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

const CTA_ALLOW = /^\/app\//;

export function AssistantTipCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

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
        .limit(1)
        .maybeSingle();
      return (data as Insight | null) ?? null;
    },
  });

  useEffect(() => {
    if (isLoading || generating || data || !user) return;
    setGenerating(true);
    supabase.functions
      .invoke("insights-generate", { body: {} })
      .then(() => refetch())
      .catch(() => {
        // Fallback silencioso: mostra card fallback estático
      })
      .finally(() => setGenerating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, data, user]);

  const sendFeedback = async (value: "useful" | "not_useful") => {
    if (!data) return;
    await supabase
      .from("user_insights" as never)
      .update({ feedback: value })
      .eq("id", data.id);
    toast.success(copy.tip.thanks);
    qc.invalidateQueries({ queryKey: ["assistant-tip"] });
  };

  const isFallback = !data && !generating && !isLoading;
  const title = data?.title ?? copy.tip.fallbackTitle;
  const body = data?.body ?? copy.tip.fallbackBody;
  const ctaLabel = data?.cta_label ?? copy.tip.fallbackCta;
  const rawRoute = data?.cta_route ?? "/app/lancamentos";
  const ctaRoute = CTA_ALLOW.test(rawRoute) ? rawRoute : "/app/lancamentos";

  return (
    <section
      aria-label={copy.tip.header}
      className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/8 via-card to-accent/10 p-5 shadow-card"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        {copy.tip.header}
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

        {!isFallback && data && !data.feedback && (
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
