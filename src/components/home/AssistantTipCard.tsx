import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, ThumbsUp, ThumbsDown, ArrowRight, Loader2, RefreshCw, X } from "lucide-react";
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
  const [lastForceAt, setLastForceAt] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [seenVersion, setSeenVersion] = useState(0); // força re-render quando marcamos como visto
  const [exhausted, setExhausted] = useState(false);

  const { data: txs } = useAllTransactions();
  const { data: goals } = useGoals();

  const facts: InsightFacts = useMemo(
    () => buildAssistantFacts((txs ?? []) as TransactionRow[], (goals ?? []) as Array<{ name?: string | null }>),
    [txs, goals],
  );

  // Puxamos até 5 insights ativos e rotacionamos entre eles no cliente,
  // pulando os já vistos nesta sessão.
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

  // Marca como "visto" ao exibir, para que a próxima abertura rotacione.
  useEffect(() => {
    if (!current) return;
    if (seen.has(current.id)) return;
    const next = new Set(seen); next.add(current.id);
    saveSeen(next);
    // não força re-render aqui — só na próxima interação
  }, [current, seen]);

  const generate = async (force = false) => {
    if (generating) return;
    if (force && Date.now() - lastForceAt < 3_000) {
      toast.message("A nova dica já está sendo preparada.");
      return;
    }
    setGenerating(true);
    if (force) { setLastForceAt(Date.now()); setNonce((n) => n + 1); setExhausted(false); }
    try {
      const { data: generated, error } = await supabase.functions.invoke("insights-generate", { body: force ? { force: true } : {} });
      if (error) throw error;
      if (generated?.insight && isRenderable(generated.insight)) {
        // Adiciona o novo insight ao topo e mantém rotação
        qc.setQueryData<Insight[]>(["assistant-tip", user?.id], (prev) => {
          const list = prev ?? [];
          const withoutDup = list.filter((i) => i.id !== generated.insight.id);
          return [generated.insight, ...withoutDup].slice(0, 5);
        });
      } else {
        throw new Error("insight_not_returned");
      }
    } catch (e) {
      if (force) toast.message("Aqui vai outra ideia pra você.");
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

  const sendFeedback = async (value: "useful" | "not_useful") => {
    if (!current) return;
    const patch: Record<string, unknown> = { feedback: value };
    if (value === "not_useful") patch.status = "dismissed";
    await (supabase.from("user_insights" as never) as any).update(patch).eq("id", current.id);
    toast.success(copy.tip.thanks);
    if (value === "not_useful") {
      // Marca como visto, rotaciona para o próximo, e se acabou tenta gerar outro.
      const next = new Set(seen); next.add(current.id); saveSeen(next); setSeenVersion((v) => v + 1);
      const remaining = activeList.filter((i) => i.id !== current.id && !next.has(i.id));
      if (remaining.length === 0) void generate(true);
    }
    qc.invalidateQueries({ queryKey: ["assistant-tip"] });
  };

  const rotateNext = () => {
    if (!current) return;
    const next = new Set(seen); next.add(current.id); saveSeen(next); setSeenVersion((v) => v + 1);
    const remaining = activeList.filter((i) => !next.has(i.id));
    if (remaining.length === 0) {
      setExhausted(true);
      void generate(true);
    } else {
      setNonce((n) => n + 1);
    }
  };

  // Fallback local (mesmas regras do backend). Usado quando não há insights no servidor
  // ou como base quando o usuário exauriu todas as dicas ativas.
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
  const showFeedback = !usingLocal && current && !current.feedback;

  if (isLoading && activeList.length === 0) {
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

  // Estado "exauriu tudo por hoje" — mensagem amigável + botão pra tentar gerar mais.
  if (exhausted && activeList.every((i) => seen.has(i.id))) {
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
        </div>
        <h3 className="mt-2 font-display text-base font-bold leading-snug">Você já viu tudo por aqui hoje 🎉</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Continue registrando gastos e entradas — assim eu consigo trazer leituras novas e mais úteis pra você amanhã.
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Link
            to="/app/lancamentos"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-95"
          >
            Anotar agora <ArrowRight size={12} />
          </Link>
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={generating}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] text-muted-foreground hover:text-primary disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            <span>Tentar mais uma</span>
          </button>
        </div>
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
        <div className="flex items-center gap-1">
          {activeList.length > 1 && !usingLocal && (
            <button
              type="button"
              onClick={rotateNext}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:text-primary"
              aria-label="Próxima dica"
              title="Próxima dica"
            >
              Próxima
            </button>
          )}
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={generating}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:text-primary disabled:opacity-50"
            aria-label="Gerar nova dica"
            title="Gerar nova dica"
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            <span>Nova</span>
          </button>
        </div>
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

        {showFeedback && (
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
            <button
              onClick={rotateNext}
              aria-label="Dispensar"
              className="rounded-full p-1.5 hover:text-muted-foreground"
              title="Dispensar"
            >
              <X size={13} />
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
