import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { computeMonthlyTotals, type TransactionRow } from "@/lib/engine/facts";

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
  evidence: Record<string, unknown> | null;
};

const SEEN_KEY = "noc:insights-seen";

function isRenderable(i: Pick<Insight, "title" | "body"> | null | undefined): boolean {
  return !!i && typeof i.title === "string" && !!i.title.trim() && typeof i.body === "string" && !!i.body.trim();
}

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}
function saveSeen(set: Set<string>) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set).slice(-50))); } catch { /* noop */ }
}

function deepLinkForInsight(i: Insight): string | null {
  const txId = (i.evidence as any)?.transaction_id;
  if (typeof txId === "string" && /^[0-9a-f-]{36}$/i.test(txId)) {
    const focus = i.type === "categorize_transaction" ? "&focus=category" : "";
    return `/app/lancamentos/${txId}?edit=1${focus}`;
  }
  return null;
}

export function buildAssistantFacts(
  txs: TransactionRow[],
  goals: Array<{ name?: string | null }>,
  ym = new Date().toISOString().slice(0, 7),
): InsightFacts {
  const arr = txs ?? [];
  const totals = computeMonthlyTotals(arr, ym);
  let uncategorized: InsightFacts["uncategorized_tx"] = null;
  let bestAmt = 0;
  for (const t of arr) {
    if (!t.occurred_at?.startsWith(ym)) continue;
    if (t.status !== "confirmed") continue;
    if (t.type !== "expense") continue;
    if (t.category_id) continue;
    const mk = (t.movement_kind ?? "transaction").toString();
    if (mk !== "transaction") continue;
    const amt = Number(t.amount || 0);
    if (amt > bestAmt) {
      bestAmt = amt;
      uncategorized = { id: t.id, description: t.description ?? null, amount: amt, occurred_at: t.occurred_at };
    }
  }
  return {
    total_tx_ever: arr.length,
    month: ym,
    income_month: totals.income,
    expense_month: totals.expense,
    balance_month: totals.net,
    active_goals: (goals ?? []).length,
    goal_names: (goals ?? []).slice(0, 3).map((g) => g?.name ?? "").filter(Boolean) as string[],
    uncategorized_tx: uncategorized,
  };
}

export function AssistantTipCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [seenVersion, setSeenVersion] = useState(0);

  const { data: txs } = useAllTransactions();
  const { data: goals } = useGoals();

  const facts: InsightFacts = useMemo(
    () => buildAssistantFacts((txs ?? []) as TransactionRow[], (goals ?? []) as Array<{ name?: string | null }>),
    [txs, goals],
  );

  const { data: insights, isLoading } = useQuery<Insight[]>({
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
      return ((data as Insight[] | null) ?? []).filter(isRenderable);
    },
  });

  const activeList = insights ?? [];
  const seen = useMemo(() => loadSeen(), [seenVersion]);
  const current: Insight | null = useMemo(() => {
    const unseen = activeList.find((i) => !seen.has(i.id));
    return unseen ?? activeList[0] ?? null;
  }, [activeList, seen]);

  useEffect(() => {
    if (!current) return;
    if (seen.has(current.id)) return;
    const next = new Set(seen); next.add(current.id);
    saveSeen(next);
  }, [current, seen]);

  const generate = async (force = false) => {
    if (generating) return;
    setGenerating(true);
    if (force) { setNonce((n) => n + 1); }
    try {
      const { data: generated, error } = await supabase.functions.invoke("insights-generate", { body: force ? { force: true } : {} });
      if (error) throw error;
      if (generated?.insight && isRenderable(generated.insight)) {
        qc.setQueryData<Insight[]>(["assistant-tip", user?.id], (prev) => {
          const list = prev ?? [];
          const withoutDup = list.filter((i) => i.id !== generated.insight.id);
          return [generated.insight, ...withoutDup].slice(0, 5);
        });
      }
    } catch (e) {
      console.warn("[insights-generate]", (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (isLoading || generating || (activeList.length > 0) || !user) return;
    void generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, activeList.length, user]);

  const dismiss = async () => {
    if (!current) {
      // Local fallback dismiss → rotate
      setNonce((n) => n + 1);
      return;
    }
    await (supabase.from("user_insights" as never) as any).update({ feedback: "not_useful", status: "dismissed" }).eq("id", current.id);
    const next = new Set(seen); next.add(current.id); saveSeen(next); setSeenVersion((v) => v + 1);
    const remaining = activeList.filter((i) => i.id !== current.id && !next.has(i.id));
    if (remaining.length === 0) void generate(true);
    toast.success(copy.tip.thanks);
    qc.invalidateQueries({ queryKey: ["assistant-tip"] });
  };

  const localFallback: InsightPayload = useMemo(() => {
    const lastKey = typeof window !== "undefined" ? sessionStorage.getItem("noc:last-tip") : null;
    const p = pickFallback(facts, { skipKey: lastKey ?? undefined });
    if (typeof window !== "undefined") sessionStorage.setItem("noc:last-tip", `${p.type}:${p.title}`);
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts, nonce]);

  const usingLocal = !current;
  const title = usingLocal ? localFallback.title : current!.title;
  const body = usingLocal ? localFallback.body : current!.body;
  const ctaLabel = usingLocal
    ? localFallback.cta_label
    : (current!.cta_label && current!.cta_label.trim()) || localFallback.cta_label;
  const rawRoute = usingLocal ? localFallback.cta_route : current!.cta_route ?? localFallback.cta_route;
  const linkFromEvidence = !usingLocal && current ? deepLinkForInsight(current) : null;
  const ctaRoute = linkFromEvidence ?? (rawRoute && CTA_ROUTE_RX.test(rawRoute) ? rawRoute : "/app/lancamentos");

  if (isLoading && activeList.length === 0) {
    return (
      <section
        aria-label={copy.tip.header}
        className="rounded-[18px] bg-[color:var(--home-surface)] p-4"
        style={{ border: "1px solid var(--home-hairline)", minHeight: 108 }}
      >
        <div className="h-3 w-32 animate-pulse rounded bg-[color:var(--home-surface-neutral)]" />
        <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-[color:var(--home-surface-neutral)]" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-[color:var(--home-surface-neutral)]" />
      </section>
    );
  }

  return (
    <section
      aria-label={copy.tip.header}
      className="rounded-[18px] bg-[color:var(--home-surface)] p-4"
      style={{ border: "1px solid var(--home-hairline)" }}
    >
      <p
        className="text-[10px] font-bold uppercase"
        style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}
      >
        {copy.tip.header}
      </p>
      <h3
        className="mt-1.5 text-[14px] font-bold leading-snug"
        style={{ color: "var(--home-text-1)", letterSpacing: "-0.01em" }}
      >
        {title}
      </h3>
      <p
        className="mt-1 text-[12px] leading-snug line-clamp-2"
        style={{ color: "var(--home-text-2)" }}
      >
        {body}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Link
          to={ctaRoute}
          className="inline-flex items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold text-white transition hover:opacity-95"
          style={{ background: "var(--home-brand-ink)", height: 36 }}
        >
          {ctaLabel}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="text-[12px] font-semibold hover:underline"
          style={{ color: "var(--home-text-2)" }}
        >
          Agora não
        </button>
        {generating && <Loader2 className="h-3 w-3 animate-spin" style={{ color: "var(--home-text-3)" }} />}
      </div>
    </section>
  );
}
