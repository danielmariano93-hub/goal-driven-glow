import { CheckCircle2, AlertTriangle, XCircle, Clock, HelpCircle, type LucideIcon } from "lucide-react";
import type { StatusView, Tone } from "@/lib/admin/statusMapper";

// Semantic tokens only — safe for dark mode and consistent contrast.
const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/25",
  warn: "bg-warning/15 text-warning-foreground border-warning/40",
  danger: "bg-destructive/10 text-destructive border-destructive/25",
  info: "bg-primary/10 text-primary border-primary/25",
  neutral: "bg-secondary text-muted-foreground border-border",
};

const TONE_ICON: Record<Tone, LucideIcon> = {
  success: CheckCircle2,
  warn: AlertTriangle,
  danger: XCircle,
  info: Clock,
  neutral: HelpCircle,
};

export function StatusChip({ view, size = "md" }: { view: StatusView; size?: "sm" | "md" }) {
  const Icon = TONE_ICON[view.tone];
  const px = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${px} ${TONE_CLASS[view.tone]}`}
      role="status"
      aria-label={view.label}
    >
      <Icon size={12} aria-hidden />
      {view.label}
    </span>
  );
}
