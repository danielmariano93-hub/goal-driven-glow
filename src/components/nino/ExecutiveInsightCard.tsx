import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, CircleAlert, Eye, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOptionalAssessor } from "@/context/AssessorContext";
import { useExecutiveFeedback, type ExecutiveBriefing, type ExecutiveInsight } from "@/lib/nino/executive";

function compactBRL(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return `R$ ${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(abs).toLocaleString("pt-BR")}`;
}

/** Só onde o número é, de fato, variação mensal do resultado. */
const MONTHLY_IMPACT_KINDS = new Set(["cashflow", "month_vs_typical", "structural_trend", "price_increase", "new_recurring", "usage_concentration"]);

const TONE = {
  critical: { label: "Crítico", icon: TriangleAlert, text: "text-destructive", bar: "bg-destructive" },
  attention: { label: "Atenção", icon: CircleAlert, text: "text-warning", bar: "bg-warning" },
  positive: { label: "Boa notícia", icon: CheckCircle2, text: "text-success", bar: "bg-success" },
  info: { label: "Para acompanhar", icon: Eye, text: "text-primary", bar: "bg-primary" },
} as const;

/**
 * Insight executivo: conclusão com número, por que importa em reais, os números
 * que sustentam a leitura (sempre visíveis) e UMA ação.
 */
export function ExecutiveInsightCard({ insight, emphasis = false }: { insight: ExecutiveInsight; emphasis?: boolean }) {
  const navigate = useNavigate();
  const assessor = useOptionalAssessor();
  const feedback = useExecutiveFeedback();
  const tone = TONE[insight.severity];
  const Icon = tone.icon;

  const send = (value: "useful" | "not_useful" | "acted") => {
    feedback.mutate({ insight, feedback: value }, {
      onSuccess: () => {
        if (value === "useful") toast.success("Obrigado! O Nino vai priorizar leituras assim.");
        if (value === "not_useful") toast("Entendido. Essa leitura sai da sua lista por 30 dias.");
      },
      onError: () => toast.error("Não foi possível registrar agora."),
    });
  };

  const act = () => {
    const action = insight.action;
    if (!action) return;
    send("acted");
    if (action.type === "ask") {
      if (assessor) assessor.openAssessor("deep_link", { draft: action.prompt });
      else navigate("/app/assessor");
      return;
    }
    navigate(action.route);
  };

  return (
    <article className="relative w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", tone.bar)} />
      <div className={cn("pl-4 pr-3.5", emphasis ? "py-4" : "py-3.5")}>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", tone.text)}>
            <Icon className="h-3 w-3" aria-hidden />
            {tone.label}
          </span>
          {insight.impact_monthly >= 50 && MONTHLY_IMPACT_KINDS.has(insight.kind) && (
            <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
              ≈ {compactBRL(insight.impact_monthly)}/mês
            </span>
          )}
        </div>

        <h2 className={cn("mt-2 break-words font-display font-bold leading-tight text-foreground", emphasis ? "text-[18px]" : "text-[15px]")}>
          {insight.headline}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-[18px] text-muted-foreground">{insight.why}</p>

        {insight.evidence.length > 0 && (
          <ul className="mt-2.5 space-y-1 rounded-xl bg-muted/60 px-3 py-2">
            {insight.evidence.map((line) => (
              <li key={line} className="text-[11.5px] leading-[16px] tabular-nums text-foreground/80">
                {line}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
          {insight.action && (
            <Button type="button" size="sm" className="h-8 rounded-full px-3 text-[11px]" onClick={act}>
              {insight.action.label} <ArrowRight className="ml-0.5 h-3 w-3" aria-hidden />
            </Button>
          )}
          <div className="ml-auto flex items-center">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Útil" title="Útil" onClick={() => send("useful")} disabled={feedback.isPending}>
              <ThumbsUp className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Não ajudou" title="Não ajudou" onClick={() => send("not_useful")} disabled={feedback.isPending}>
              <ThumbsDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {insight.action?.detail && (
          <p className="mt-1 text-[10.5px] leading-[15px] text-muted-foreground">{insight.action.detail}</p>
        )}
      </div>
    </article>
  );
}

/** Três números do topo: gasto do mês × padrão, resultado de 3 meses, taxa de poupança. */
export function ExecutiveKpiStrip({ kpis }: { kpis: ExecutiveBriefing["kpis"] }) {
  if (!kpis.length) return null;
  return (
    <section aria-label="Resumo" className="grid grid-cols-3 gap-1.5">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="min-w-0 rounded-xl border border-border bg-card px-2.5 py-2">
          <p className="truncate text-[10px] text-muted-foreground">{kpi.label}</p>
          <p className={cn(
            "mt-0.5 truncate text-[15px] font-bold tabular-nums",
            kpi.tone === "bad" ? "text-destructive" : kpi.tone === "good" ? "text-success" : "text-foreground",
          )}>
            {kpi.value}
          </p>
          {kpi.hint && <p className="truncate text-[9.5px] text-muted-foreground">{kpi.hint}</p>}
        </div>
      ))}
    </section>
  );
}
