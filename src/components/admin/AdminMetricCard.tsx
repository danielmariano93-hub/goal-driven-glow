import type { ReactNode } from "react";

export function AdminMetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "critical" | "brand";
}) {
  const toneClass = {
    neutral: "border-border",
    positive: "border-[#2FC99A]/35",
    warning: "border-[#FF6B5F]/25",
    critical: "border-[#FF6B5F]/55",
    brand: "border-[#6D4AFF]/35",
  }[tone];

  return (
    <div className={`rounded-2xl border bg-card p-4 shadow-sm ${toneClass}`}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      {detail ? <div className="mt-2 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}
