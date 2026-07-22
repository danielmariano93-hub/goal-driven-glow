import { Pencil, Trash2, Pause, Play } from "lucide-react";
import type { CategoryGoalEvaluation } from "@/lib/engine/metrics";
import { formatBRL } from "@/lib/engine/facts";

type Props = {
  evaluation: CategoryGoalEvaluation;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
};

const STATUS_STYLES: Record<CategoryGoalEvaluation["status"], { label: string; color: string; bar: string }> = {
  on_track: { label: "No ritmo", color: "text-emerald-600 bg-emerald-500/10", bar: "bg-emerald-500" },
  attention: { label: "Atenção", color: "text-amber-600 bg-amber-500/10", bar: "bg-amber-500" },
  at_risk: { label: "Em risco", color: "text-orange-600 bg-orange-500/10", bar: "bg-orange-500" },
  exceeded: { label: "Estourou", color: "text-red-600 bg-red-500/10", bar: "bg-red-500" },
};

export function CategoryGoalCard({ evaluation, onEdit, onDelete, onToggleStatus }: Props) {
  const s = STATUS_STYLES[evaluation.status];
  const paused = evaluation.goal.status === "paused";
  const utilPct = Math.min(1, Math.max(0, evaluation.utilizationPct));
  return (
    <li className={`rounded-2xl border border-border bg-card p-4 shadow-card ${paused ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{evaluation.categoryName ?? "Categoria"}</p>
          <p className="text-xs text-muted-foreground">
            Limite {formatBRL(evaluation.limit)} · {evaluation.daysRemaining} dia(s) restantes
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.color}`}>{paused ? "Pausada" : s.label}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full transition-all ${s.bar}`} style={{ width: `${Math.round(utilPct * 100)}%` }} />
      </div>
      <p className="mt-1.5 text-xs">
        <span className="font-semibold tabular-nums">{formatBRL(evaluation.spent)}</span>{" "}
        <span className="text-muted-foreground">de {formatBRL(evaluation.limit)} · projeção {formatBRL(evaluation.projectedSpend)}</span>
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{evaluation.message}</p>
      {evaluation.dailyAllowance > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Você tem <span className="font-medium tabular-nums text-foreground">{formatBRL(evaluation.dailyAllowance)}/dia</span> restantes até o fim do período.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium">
          <Pencil size={12} /> Editar
        </button>
        <button onClick={onToggleStatus} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium">
          {paused ? <><Play size={12} /> Reativar</> : <><Pause size={12} /> Pausar</>}
        </button>
        <button onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-destructive">
          <Trash2 size={12} /> Excluir
        </button>
      </div>
    </li>
  );
}
