import { Link } from "react-router-dom";
import { ArrowRight, Footprints } from "lucide-react";
import { nextStepCopy, type NextStepFallback } from "@/lib/behavioral/nextStep";
import type { OpenWeekendCommitment } from "@/lib/behavioral/weekendCommitment";

export function NextStepCard({ commitment, fallback }: { commitment: OpenWeekendCommitment | null; fallback: NextStepFallback }) {
  const copy = nextStepCopy(commitment, fallback);
  if (!copy) return null;
  const action = copy.action;
  return (
    <section aria-label={copy.title} className="rounded-[26px] border border-primary/20 bg-primary/5 p-5 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary"><Footprints size={13} aria-hidden /> Uma mudança possível</p>
      <h2 className="mt-1 font-display text-xl font-bold tracking-tight">{copy.title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
      {action ? (
        action.to.startsWith("#")
          ? <a href={action.to} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">{action.label} <ArrowRight size={14} aria-hidden /></a>
          : <Link to={action.to} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">{action.label} <ArrowRight size={14} aria-hidden /></Link>
      ) : null}
    </section>
  );
}
