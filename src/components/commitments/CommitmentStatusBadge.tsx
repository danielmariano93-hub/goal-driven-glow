import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import type { CommitmentItem } from "@/lib/engine/commitmentAgenda";
import { commitmentStatus } from "@/lib/engine/commitmentView";

/** Selo de estado: Pago (verde, com check) · Em atraso há N dias (vermelho) · Vence hoje/amanhã/em N dias. */
export function CommitmentStatusBadge({ item, today }: { item: Pick<CommitmentItem, "date" | "payment_status" | "type">; today: string }) {
  const s = commitmentStatus(item, today);
  const tone =
    s.kind === "paid" ? "bg-emerald-50 text-emerald-700"
    : s.kind === "overdue" ? "bg-destructive/10 text-destructive"
    : s.kind === "today" ? "bg-warning/15 text-warning"
    : "bg-secondary text-muted-foreground";
  const Icon = s.kind === "paid" ? CheckCircle2 : s.kind === "overdue" ? AlertTriangle : Clock;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      <Icon size={11} aria-hidden /> {s.label}
    </span>
  );
}
