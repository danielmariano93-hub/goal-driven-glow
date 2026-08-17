import type { ReactNode } from "react";

export type PillTone = "success" | "warn" | "danger" | "info" | "neutral";

const TONE: Record<PillTone, string> = {
  success: "bg-success/10 text-success border-success/25",
  warn: "bg-warning/15 text-warning-foreground border-warning/40",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
  info: "bg-primary/10 text-primary border-primary/25",
  neutral: "bg-secondary text-muted-foreground border-border",
};

export function HealthPill({
  tone = "neutral",
  children,
}: {
  tone?: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
