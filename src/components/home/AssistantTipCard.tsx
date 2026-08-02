import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { copy } from "@/lib/copy/strings";
import { CTA_ROUTE_RX, type InsightFacts } from "@/lib/insights/fallbacks";
import { useAllTransactions, useGoals } from "@/lib/db/finance";
import { sendTipFeedback } from "@/lib/nino/client";
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

/** Chave de assunto (usada por testes e telemetria de rotação). */
export function tipSubjectKey(p: { type: string; title: string }): string {
  return `${p.type}:${(p.title ?? "").trim().toLowerCase()}`;
}

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
  const txId = (i.evidence as Record<string, unknown> | null)?.transaction_id;
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
  const [index, setIndex] = useState(0);
  const [seenVersion, setSeenVersion] = useState(0);

  // Fatos locais seguem disponíveis para telemetria/derivações, mas o texto
  // exibido vem SEMPRE do motor único (insights_catalog.v1 no backend).
  const { data: txs } = useAllTransactions();
  const { data: goals } = useGoals();
  useMemo(
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

  const activeList = useMemo(() => insights ?? [], [insights]);
  const seen = useMemo(() => loadSeen(), [seenVersion]);
  const safeIndex = activeList.length === 0 ? 0 : Math.min(index, activeList.length - 1);
  const current: Insight | null = activeList[safeIndex] ?? null;

  useEffect(() => {
    if (!current || seen.has(current.id)) return;
    const next = new Set(seen); next.add(current.id);
    saveSeen(next);
  }, [current, seen]);

  const generate = async (force = false) => {
    if (generating) return;
    setGenerating(true);
    try {
      const { data: generated, error } = await supabase.functions.invoke("insights-generate", {
        body: force ? { force: true } : {},
      });
      if (error) throw error;
      const batch = (Array.isArray(generated?.insights) ? generated.insights : [generated?.insight])
        .filter((i: Insight | null | undefined) => isRenderable(i)) as Insight[];
      if (batch.length > 0) {
        qc.setQueryData<Insight[]>(["assistant-tip", user?.id], (prev) => {
          const ids = new Set(batch.map((i) => i.id));
          return [...batch, ...(prev ?? []).filter((i) => !ids.has(i.id))].slice(0, 5);
        });
      }
    } catch (e) {
      console.warn("[insights-generate]", (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (isLoading || generating || activeList.length > 0 || !user) return;
    void generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, activeList.length, user]);

  const removeCurrent = (id: string) => {
    qc.setQueryData<Insight[]>(["assistant-tip", user?.id], (prev) => (prev ?? []).filter((i) => i.id !== id));
    setIndex(0);
  };

  const dismiss = async () => {
    if (!current) return;
    const id = current.id;
    try {
      await sendTipFeedback(id, "dismissed");
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    const next = new Set(seen); next.add(id); saveSeen(next); setSeenVersion((v) => v + 1);
    removeCurrent(id);
    toast.success(copy.tip.thanks);
    const remaining = activeList.filter((i) => i.id !== id).length;
    if (remaining === 0) await generate(true);
    qc.invalidateQueries({ queryKey: ["assistant-tip"] });
  };

  const markUseful = async () => {
    if (!current) return;
    const id = current.id;
    try {
      await sendTipFeedback(id, "acted");
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    const next = new Set(seen); next.add(id); saveSeen(next); setSeenVersion((v) => v + 1);
    removeCurrent(id);
    toast.success(copy.tip.thanks);
    qc.invalidateQueries({ queryKey: ["assistant-tip"] });
  };

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

  if (!current) {
    return (
      <section
        aria-label={copy.tip.header}
        className="rounded-[18px] bg-[color:var(--home-surface)] p-4"
        style={{ border: "1px solid var(--home-hairline)" }}
      >
        <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
          {copy.tip.header}
        </p>
        <p className="mt-1.5 text-[13px] font-semibold" style={{ color: "var(--home-text-1)" }}>
          Sem dicas novas agora
        </p>
        <p className="mt-1 text-[12px]" style={{ color: "var(--home-text-2)" }}>
          O Nino avisa aqui assim que encontrar algo relevante nos seus lançamentos.
        </p>
        <button
          type="button"
          onClick={() => void generate(true)}
          disabled={generating}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold text-white transition hover:opacity-95 disabled:opacity-60"
          style={{ background: "var(--home-brand-ink)", height: 36 }}
        >
          {generating && <Loader2 className="h-3 w-3 animate-spin" />}
          Buscar dica
        </button>
      </section>
    );
  }

  const ctaLabel = (current.cta_label && current.cta_label.trim()) || "Abrir";
  const rawRoute = current.cta_route;
  const linkFromEvidence = deepLinkForInsight(current);
  const ctaRoute = linkFromEvidence ?? (rawRoute && CTA_ROUTE_RX.test(rawRoute) ? rawRoute : "/app/lancamentos");
  const total = activeList.length;

  return (
    <section
      aria-label={copy.tip.header}
      className="rounded-[18px] bg-[color:var(--home-surface)] p-4"
      style={{ border: "1px solid var(--home-hairline)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
          {copy.tip.header}
        </p>
        {total > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Dica anterior"
              onClick={() => setIndex((i) => (i - 1 + total) % total)}
              className="grid h-7 w-7 place-items-center rounded-full transition hover:opacity-80"
              style={{ border: "1px solid var(--home-hairline)", color: "var(--home-text-2)" }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] font-semibold tabular-nums" style={{ color: "var(--home-text-3)" }}>
              {safeIndex + 1}/{total}
            </span>
            <button
              type="button"
              aria-label="Próxima dica"
              onClick={() => setIndex((i) => (i + 1) % total)}
              className="grid h-7 w-7 place-items-center rounded-full transition hover:opacity-80"
              style={{ border: "1px solid var(--home-hairline)", color: "var(--home-text-2)" }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <h3
        className="mt-1.5 text-[14px] font-bold leading-snug"
        style={{ color: "var(--home-text-1)", letterSpacing: "-0.01em" }}
      >
        {current.title}
      </h3>
      <p className="mt-1 text-[12px] leading-snug line-clamp-3" style={{ color: "var(--home-text-2)" }}>
        {current.body}
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
          onClick={markUseful}
          className="text-[12px] font-semibold hover:underline"
          style={{ color: "var(--home-text-2)" }}
        >
          Útil
        </button>
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
      {total > 1 && (
        <div className="mt-3 flex items-center gap-1.5">
          {activeList.map((i, idx) => (
            <button
              key={i.id}
              type="button"
              aria-label={`Ver dica ${idx + 1}`}
              onClick={() => setIndex(idx)}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: idx === safeIndex ? 18 : 6,
                background: idx === safeIndex ? "var(--home-brand-ink)" : "var(--home-hairline)",
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
