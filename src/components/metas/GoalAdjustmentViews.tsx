import { formatBRL } from "@/lib/engine/facts";
import type { AdjustmentReview, AdjustmentVerdict } from "@/lib/engine/goalAdjustment";

const TONE: Record<Exclude<AdjustmentVerdict, "pending">, { chip: string; label: string }> = {
  necessary: { chip: "bg-emerald-500/15 text-emerald-700", label: "Foi necessário" },
  worked: { chip: "bg-emerald-500/15 text-emerald-700", label: "Funcionou" },
  unnecessary: { chip: "bg-amber-500/15 text-amber-700", label: "Não precisava" },
  too_tight: { chip: "bg-amber-500/15 text-amber-700", label: "Ficou apertado" },
  insufficient: { chip: "bg-red-500/15 text-red-700", label: "Não bastou" },
  neutral: { chip: "bg-slate-500/10 text-slate-700", label: "Registrado" },
};

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function verdictChip(r: AdjustmentReview) {
  const key = (r.closed ? r.verdict : r.leaning) as Exclude<AdjustmentVerdict, "pending"> | null;
  if (!key) return null;
  const tone = TONE[key];
  return { ...tone, label: r.closed ? tone.label : `Até agora: ${tone.label.toLowerCase()}` };
}

/** Selo no card da meta: houve ajuste, de quanto para quanto e o que o Nino acha até agora. */
export function AdjustedBadge({ review }: { review: AdjustmentReview }) {
  const chip = verdictChip(review);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="goal-adjusted-badge">
      <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">Ajustada em {day(review.adjusted_on)}</span>
      <span className="tabular-nums">{formatBRL(review.old_limit)} → {formatBRL(review.new_limit)}</span>
      {chip ? <span className={`rounded-full px-2 py-0.5 font-medium ${chip.chip}`}>{chip.label}</span> : null}
    </div>
  );
}

/** Leitura do Nino sobre cada ajuste: foi inteligente ajustar naquele momento? */
export function GoalAdjustmentsPanel({ reviews }: { reviews: AdjustmentReview[] }) {
  if (!reviews.length) return null;
  return (
    <section className="mt-5 rounded-2xl border border-border bg-card p-4" data-testid="goal-adjustments-panel">
      <p className="text-sm font-semibold">Ajustes desta meta</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">O Nino compara o que você gastou com o limite antigo e com o novo.</p>
      <ul className="mt-3 space-y-3">
        {reviews.map((r) => {
          const chip = verdictChip(r);
          return (
            <li key={r.id} className="rounded-xl bg-secondary/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-semibold">{r.headline}</p>
                {chip ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.chip}`}>{chip.label}</span> : null}
              </div>
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {day(r.adjusted_on)} · {formatBRL(r.old_limit)} → {formatBRL(r.new_limit)}
                {r.delta_pct != null && r.delta !== 0 ? ` (${r.delta > 0 ? "+" : ""}${r.delta_pct}%)` : ""}
                {r.reason ? ` · “${r.reason}”` : ""}
              </p>
              <p className="mt-1.5 text-[12px] leading-snug">{r.explanation}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
