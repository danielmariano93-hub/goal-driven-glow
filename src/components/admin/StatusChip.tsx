import { CheckCircle2, AlertTriangle, XCircle, Clock, HelpCircle } from "lucide-react";
import type { StatusView, Tone } from "@/lib/admin/statusMapper";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-800 border-red-200",
  info: "bg-blue-50 text-blue-800 border-blue-200",
  neutral: "bg-slate-50 text-slate-700 border-slate-200",
};

const TONE_ICON: Record<Tone, React.ComponentType<{ className?: string; size?: number }>> = {
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
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${px} ${TONE_CLASS[view.tone]}`}>
      <Icon size={12} />
      {view.label}
    </span>
  );
}
