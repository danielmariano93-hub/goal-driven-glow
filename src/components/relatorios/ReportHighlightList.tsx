import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronRight, Info, Lightbulb, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportHighlightRow } from "@/lib/reports/intelligent/client";
import { safeRoute } from "@/lib/nino/intelligence";

const TONE = {
  risk: { icon: AlertTriangle, chip: "bg-rose-500/10 text-rose-600", label: "Risco" },
  win: { icon: Trophy, chip: "bg-emerald-500/10 text-emerald-600", label: "Conquista" },
  opportunity: { icon: Lightbulb, chip: "bg-amber-500/10 text-amber-600", label: "Oportunidade" },
  info: { icon: Info, chip: "bg-primary/10 text-primary", label: "Leitura" },
} as const;

export default function ReportHighlightList({ highlights }: { highlights: ReportHighlightRow[] }) {
  const navigate = useNavigate();
  if (highlights.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
        Sem destaques neste período. Registrar os lançamentos deixa a próxima leitura mais rica.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {highlights.map((h) => {
        const tone = TONE[(h.type as keyof typeof TONE)] ?? TONE.info;
        const Icon = tone.icon;
        return (
          <li key={h.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-start gap-3">
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", tone.chip)}>
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", tone.chip)}>
                    {tone.label}
                  </span>
                  {(h.evidence as Record<string, unknown> | null)?.insight_source === "insights_catalog.v1" && (
                    <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Situação atual
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm font-semibold leading-snug">{h.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{h.body}</p>

                {h.cta_route && (
                  <button
                    onClick={() => navigate(safeRoute({ route: h.cta_route }))}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary print:hidden"
                  >
                    {h.cta_label ?? "Abrir"} <ChevronRight size={13} />
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
