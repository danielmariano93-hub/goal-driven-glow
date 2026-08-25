import { useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronRight, Info, Lightbulb, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportHighlightRow } from "@/lib/reports/intelligent/client";
import { presentReportHighlight } from "@/lib/reports/intelligent/presentation";
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
  const [primary, ...secondary] = highlights;
  const primaryTone = TONE[(primary.type as keyof typeof TONE)] ?? TONE.info;
  const PrimaryIcon = primaryTone.icon;
  const primaryText = presentReportHighlight(primary);
  return (
    <div className="space-y-3">
      <article className="rounded-2xl border border-primary/20 bg-card p-4 shadow-card">
        <div className="flex items-start gap-3">
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", primaryTone.chip)}>
            <PrimaryIcon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", primaryTone.chip)}>
              Atenção principal
            </span>
            <p className="mt-1.5 text-sm font-semibold leading-snug">{primaryText.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{primaryText.body}</p>
            {primary.cta_route && (
              <button
                onClick={() => navigate(safeRoute({ route: primary.cta_route }))}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary print:hidden"
              >
                {primary.cta_label ?? "Ver detalhe"} <ChevronRight size={13} />
              </button>
            )}
          </div>
        </div>
      </article>

      {secondary.length > 0 && <p className="px-1 text-[11px] font-semibold text-muted-foreground">Também vale olhar</p>}
      <ul className="space-y-2">
      {secondary.map((h) => {
        const tone = TONE[(h.type as keyof typeof TONE)] ?? TONE.info;
        const Icon = tone.icon;
        const text = presentReportHighlight(h);
        return (
          <li key={h.id} className="rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="flex items-start gap-3">
              <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", tone.chip)}>
                <Icon size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold leading-snug">{text.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{text.body}</p>

                {h.cta_route && (
                  <button
                    onClick={() => navigate(safeRoute({ route: h.cta_route }))}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary print:hidden"
                  >
                    {h.cta_label ?? "Abrir"} <ChevronRight size={12} />
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
    </div>
  );
}
