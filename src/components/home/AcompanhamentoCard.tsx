import { useState } from "react";
import { ArrowRight, ChartLineUp, Info, TrendDown, TrendUp, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAssessor } from "@/context/AssessorContext";
import { registerTopicSignal } from "@/lib/nino/performanceSnapshots";
import type { AdvisorRankedItem } from "@/lib/engine/advisorRelevance";
import type { PerformanceSnapshot } from "@/lib/nino/performanceSnapshots";

type Props = {
  snapshot: PerformanceSnapshot | null;
  loading?: boolean;
};

const TONE = {
  positive: { chip: "bg-emerald-500/10 text-emerald-600", Icon: TrendUp, label: "Melhora" },
  negative: { chip: "bg-rose-500/10 text-rose-600", Icon: TrendDown, label: "Atenção" },
  neutral: { chip: "bg-primary/10 text-primary", Icon: Info, label: "Leitura" },
} as const;

/**
 * Acompanhamento discreto na Home: 2–4 highlights já rankeados pelo Advisor.
 * Nenhum número é calculado aqui — tudo vem de `financial_performance.v1`.
 */
export function AcompanhamentoCard({ snapshot, loading }: Props) {
  const { openAssessor } = useAssessor();
  const [open, setOpen] = useState<string | null>(null);
  const items = (snapshot?.highlights ?? []).slice(0, 4);

  if (loading) {
    return <div className="h-32 animate-pulse rounded-[18px] bg-muted" aria-hidden />;
  }
  if (!snapshot || items.length === 0) return null;

  function toggle(item: AdvisorRankedItem) {
    const next = open === item.id ? null : item.id;
    setOpen(next);
    if (next) void registerTopicSignal(item.topic_key, "opened").catch(() => undefined);
  }

  return (
    <section aria-labelledby="acompanhamento-title" className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-4 px-3.5 pb-2.5 pt-3.5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-primary">Acompanhamento</p>
          <h2 id="acompanhamento-title" className="mt-0.5 text-base font-bold text-foreground">Como você está</h2>
          {snapshot.headline ? (
            <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">{snapshot.headline}</p>
          ) : null}
        </div>
        <ChartLineUp className="h-5 w-5 shrink-0 text-muted-foreground" weight="duotone" />
      </div>

      <ul className="border-t border-border">
        {items.map((item) => {
          const tone = TONE[item.sentiment] ?? TONE.neutral;
          const Icon = item.severity === "critical" ? Warning : tone.Icon;
          const expanded = open === item.id;
          return (
            <li key={item.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => toggle(item)}
                aria-expanded={expanded}
                className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
              >
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", tone.chip)}>
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", tone.chip)}>
                      {item.severity === "critical" ? "Crítico" : tone.label}
                    </span>
                    {item.nature === "timing" ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Efeito de calendário
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1.5 block text-sm font-semibold leading-snug text-foreground">{item.title}</span>
                  <span className={cn("mt-1 block text-[12px] leading-[18px] text-muted-foreground", expanded ? "" : "line-clamp-2")}>
                    {item.body}
                  </span>
                </span>
                <span className="mt-1 shrink-0 text-[11px] font-semibold text-primary">{expanded ? "Fechar" : "Entender"}</span>
              </button>
              {expanded ? (
                <div className="px-3.5 pb-3">
                  {snapshot.methodology ? (
                    <p className="rounded-xl bg-muted/40 p-2.5 text-[11px] leading-[17px] text-muted-foreground">
                      {snapshot.methodology}
                    </p>
                  ) : null}
                  {item.recommended_action ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2 min-h-10 px-1.5 text-[12px] text-primary"
                      onClick={() => {
                        void registerTopicSignal(item.topic_key, "acted").catch(() => undefined);
                        openAssessor("fab");
                      }}
                    >
                      {item.recommended_action} <ArrowRight />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {snapshot.next_action ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
          <p className="min-w-0 text-[11px] text-muted-foreground">{snapshot.next_action}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-10 shrink-0 px-1.5 text-[12px] text-primary"
            onClick={() => openAssessor("fab")}
          >
            Falar com o Nino <ArrowRight />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
