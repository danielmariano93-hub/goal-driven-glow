import type { ElementType, ReactNode } from "react";

type Tone = "default" | "primary" | "success" | "warning" | "destructive";

const TONE: Record<Tone, string> = {
  default: "text-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning-foreground",
  destructive: "text-destructive",
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  suffix,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ElementType;
  tone?: Tone;
  suffix?: string;
}) {
  return (
    <div className="surface-card p-4 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon size={12} aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-1.5 font-display text-xl md:text-2xl font-bold font-numeric tabular-nums truncate ${TONE[tone]}`}>
        {value}
        {suffix ? <span className="ml-0.5 text-base font-semibold opacity-70">{suffix}</span> : null}
      </p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 6 }) {
  const cls =
    cols === 6
      ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6"
      : cols === 3
      ? "grid grid-cols-2 gap-3 md:grid-cols-3"
      : cols === 2
      ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
      : "grid grid-cols-2 gap-3 md:grid-cols-4";
  return <div className={cls}>{children}</div>;
}
