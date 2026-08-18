import type { ReactNode } from "react";
import { Pencil, Trash2, Pause, Play, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { CategoryGoalEvaluation, CategoryGoalStatus } from "@/lib/engine/metrics";
import { formatBRL } from "@/lib/engine/facts";

type Props = {
  evaluation: CategoryGoalEvaluation;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
  /** Conteúdo extra (ex.: Plano do Nino) renderizado dentro do card. */
  children?: ReactNode;
  /** Quando falso, o card não navega (usado na própria tela de detalhe). */
  clickable?: boolean;
};

const STATUS_STYLES: Record<CategoryGoalStatus, { label: string; pill: string; bar: string }> = {
  on_track: { label: "No ritmo", pill: "text-emerald-700 bg-emerald-500/15", bar: "bg-emerald-500" },
  attention: { label: "Atenção", pill: "text-amber-700 bg-amber-500/15", bar: "bg-amber-500" },
  at_risk: { label: "Em risco", pill: "text-red-700 bg-red-500/15", bar: "bg-red-500" },
  exceeded: { label: "Ultrapassada", pill: "text-red-700 bg-red-500/15", bar: "bg-red-500" },
  limit_reached: { label: "Limite atingido", pill: "text-amber-700 bg-amber-500/15", bar: "bg-amber-500" },
  scheduled: { label: "Agendada", pill: "text-slate-700 bg-slate-500/10", bar: "bg-slate-400" },
  completed_ok: { label: "Meta atingida", pill: "text-emerald-700 bg-emerald-500/15", bar: "bg-emerald-500" },
  completed_over: { label: "Encerrada acima", pill: "text-red-700 bg-red-500/15", bar: "bg-red-500" },
  paused: { label: "Pausada", pill: "text-slate-700 bg-slate-500/10", bar: "bg-slate-400" },
  cancelled: { label: "Cancelada", pill: "text-slate-700 bg-slate-500/10", bar: "bg-slate-400" },
};

function fmtPeriod(startIso: string, endIso: string): string {
  const s = new Date(startIso + "T00:00:00");
  const e = new Date(endIso + "T00:00:00");
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const month = e.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return sameMonth
    ? `${s.getDate()}–${e.getDate()} ${month}`
    : `${s.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${e.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
}

function fmtRule(ev: CategoryGoalEvaluation): string {
  if (ev.goal.mode === "fixed_limit") return `Limite ${formatBRL(ev.goal.computed_limit)}`;
  return `Redução de ${Number(ev.goal.reduction_pct ?? 0)}%`;
}

export function CategoryGoalCard({ evaluation, onEdit, onDelete, onToggleStatus, children, clickable = true }: Props) {
  const navigate = useNavigate();
  const s = STATUS_STYLES[evaluation.status];
  const paused = evaluation.status === "paused";
  const barPct = Math.min(1, Math.max(0, evaluation.percentageUsed));
  const overLimit = evaluation.actualSpend > evaluation.targetAmount;
  const open = () => { if (clickable) navigate(`/app/metas/categoria/${evaluation.goal.id}`); };
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <li
      onClick={open}
      onKeyDown={(e) => { if (clickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `Abrir meta de ${evaluation.categoryName ?? "categoria"}` : undefined}
      className={`rounded-[18px] border border-border bg-card p-4 shadow-card ${paused ? "opacity-70" : ""} ${clickable ? "cursor-pointer transition-colors hover:border-primary/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold leading-tight">{evaluation.categoryName ?? "Categoria"}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {fmtPeriod(evaluation.period.start, evaluation.period.end)} · {fmtRule(evaluation)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.pill}`}>{s.label}</span>
          {clickable ? <ChevronRight size={14} className="text-muted-foreground" /> : null}
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full transition-all ${s.bar}`} style={{ width: `${Math.round(barPct * 100)}%` }} />
      </div>
      <p className="mt-1.5 text-[13px]">
        <span className="font-bold tabular-nums">{formatBRL(evaluation.actualSpend)}</span>{" "}
        <span className="text-muted-foreground">de {formatBRL(evaluation.targetAmount)}</span>
        {overLimit && (
          <span className="ml-2 text-[11px] font-semibold text-red-600">
            {Math.round(evaluation.percentageUsed * 100)}%
          </span>
        )}
      </p>

      {evaluation.status !== "scheduled" && evaluation.status !== "paused" ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Projeção do período:{" "}
          <span className={`font-semibold tabular-nums ${evaluation.projectedOverage > 0 ? "text-red-600" : "text-foreground"}`}>
            {formatBRL(evaluation.projectedFinalSpend)}
          </span>
          {evaluation.projectedOverage > 0
            ? ` · ${formatBRL(evaluation.projectedOverage)} acima do teto`
            : ` · ${formatBRL(Math.max(0, evaluation.projectedDifference))} de folga`}
        </p>
      ) : null}

      {overLimit ? (
        <p className="mt-0.5 text-[11px] font-semibold text-red-600">
          Excesso atual: {formatBRL(evaluation.currentOverage)}
        </p>
      ) : null}

      <p className="mt-2 text-[12px] text-foreground">{evaluation.message}</p>
      {evaluation.remainingDays > 0 && !overLimit && evaluation.status !== "scheduled" && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Você pode gastar até{" "}
          <span className="font-medium tabular-nums text-foreground">{formatBRL(evaluation.dailyAllowance)}/dia</span>{" "}
          nos próximos {evaluation.remainingDays} dia(s).
        </p>
      )}
      {overLimit && evaluation.remainingDays > 0 && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {evaluation.remainingDays} dia(s) restantes · novos gastos aumentarão o excesso.
        </p>
      )}

      {children ? <div onClick={(e) => e.stopPropagation()}>{children}</div> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={stop(onEdit)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium">
          <Pencil size={12} /> Editar
        </button>
        <button onClick={stop(onToggleStatus)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium">
          {paused ? <><Play size={12} /> Reativar</> : <><Pause size={12} /> Pausar</>}
        </button>
        <button onClick={stop(onDelete)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-destructive">
          <Trash2 size={12} /> Excluir
        </button>
      </div>
    </li>
  );
}
