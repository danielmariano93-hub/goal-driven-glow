import type { ReactNode } from "react";
import type { PillTone } from "@/components/admin/kit/HealthPill";

export type TimelineStep = {
  id: string;
  label: string;
  at?: string | null;
  detail?: ReactNode;
  tone?: PillTone;
};

const DOT: Record<PillTone, string> = {
  success: "bg-success",
  warn: "bg-warning",
  danger: "bg-destructive",
  info: "bg-primary",
  neutral: "bg-muted-foreground/40",
};

function when(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  if (!steps.length) {
    return <p className="text-xs text-muted-foreground">Nenhum evento registrado.</p>;
  }
  return (
    <ol className="relative space-y-4 pl-5">
      <span
        aria-hidden
        className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-border"
      />
      {steps.map((step) => (
        <li key={step.id} className="relative">
          <span
            aria-hidden
            className={`absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card ${DOT[step.tone ?? "neutral"]}`}
          />
          <p className="text-sm font-medium">{step.label}</p>
          <p className="text-[11px] text-muted-foreground">{when(step.at)}</p>
          {step.detail && <div className="mt-1 text-xs text-muted-foreground">{step.detail}</div>}
        </li>
      ))}
    </ol>
  );
}
