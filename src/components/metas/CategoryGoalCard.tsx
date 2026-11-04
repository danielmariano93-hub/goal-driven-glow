import { useState, type ReactNode } from "react";
import { Pencil, Trash2, Pause, Play, ChevronRight, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { CategoryGoalEvaluation, CategoryGoalStatus } from "@/lib/engine/metrics";
import { formatBRL } from "@/lib/engine/facts";
import type { AdjustmentReview } from "@/lib/engine/goalAdjustment";
import { AdjustedBadge } from "./GoalAdjustmentViews";
import { resolveRequiredLabel } from "@/lib/observability/dataContract";
import { PILL_TONE, StatusPill, type PillTone } from "./StatusPill";

type Props = {
  evaluation: CategoryGoalEvaluation;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
  /** Ajuste rápido do limite/forma de medir (registra o antes e o depois). */
  onAdjust?: () => void;
  /** Último ajuste desta meta, para o selo "Ajustada". */
  adjustment?: AdjustmentReview | null;
  /** Conteúdo extra (ex.: Plano do Nino) renderizado dentro do card. */
  children?: ReactNode;
  /** Quando falso, o card não navega (usado na própria tela de detalhe). */
  clickable?: boolean;
  /** Lista compacta: título, barra e uma linha de números; o resto (mensagem, plano e ações) abre sob demanda. */
  compact?: boolean;
};

// Mesmo visual de estado do Ticket Alimentação (etiqueta tingida com ponto).
const STATUS_STYLES: Record<CategoryGoalStatus, { label: string; tone: PillTone }> = {
  on_track: { label: "No ritmo", tone: "success" },
  attention: { label: "Atenção", tone: "warning" },
  at_risk: { label: "Em risco", tone: "danger" },
  exceeded: { label: "Ultrapassada", tone: "danger" },
  limit_reached: { label: "Limite atingido", tone: "warning" },
  scheduled: { label: "Agendada", tone: "muted" },
  completed_ok: { label: "Meta atingida", tone: "success" },
  completed_over: { label: "Encerrada acima", tone: "danger" },
  paused: { label: "Pausada", tone: "muted" },
  cancelled: { label: "Cancelada", tone: "muted" },
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

/** Passar do teto por até 5% é "No limite" (cinza): não pede ação como um estouro de verdade. */
export const AT_LIMIT_BAND = 0.05;
export function displayLabel(ev: CategoryGoalEvaluation, base: { label: string; tone: PillTone }): { text: string; tone: PillTone } {
  const nearLimit = ev.status === "attention" && ev.targetAmount > 0 && ev.projectedOverage > 0 && ev.projectedOverage / ev.targetAmount <= AT_LIMIT_BAND;
  return nearLimit ? { text: "No limite", tone: "muted" } : { text: base.label, tone: base.tone };
}

const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Frase central do card: quando passa do teto (ou que não passa) e quanto, sem inventar número novo. */
export function goalOutlook(ev: CategoryGoalEvaluation): { headline: string; detail: string } | null {
  if (ev.status === "scheduled" || ev.status === "paused" || ev.status === "cancelled") return null;
  if (ev.currentOverage > 0) {
    return { headline: `Já passou do teto em ${formatBRL(ev.currentOverage)}.`, detail: `Projeção ${formatBRL(ev.projectedFinalSpend)} · ${formatBRL(ev.projectedOverage)} acima no fim do período.` };
  }
  if (ev.projectedOverage > 0) {
    const d = ev.projectedCrossDate;
    const headline = !d ? "Deve passar do teto."
      : d >= ev.period.end ? `Encosta no teto só no fim do período, por volta de ${dayMonth(d)}.`
      : `Passa do teto por volta de ${dayMonth(d)}.`;
    return { headline, detail: `Projeção ${formatBRL(ev.projectedFinalSpend)} · ${formatBRL(ev.projectedOverage)} acima${d && d >= ev.period.end ? "" : " no fim do período"}.` };
  }
  return { headline: "Deve fechar dentro do teto.", detail: `Projeção ${formatBRL(ev.projectedFinalSpend)} · folga de ${formatBRL(Math.max(0, ev.projectedDifference))}.` };
}

export function CategoryGoalCard({ evaluation, onEdit, onDelete, onToggleStatus, onAdjust, adjustment, children, clickable = true, compact = false }: Props) {
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const s = STATUS_STYLES[evaluation.status];
  const bar = PILL_TONE[s.tone].bar;
  const paused = evaluation.status === "paused";
  const barPct = Math.min(1, Math.max(0, evaluation.percentageUsed));
  const overLimit = evaluation.actualSpend > evaluation.targetAmount;
  const open = () => { if (clickable) navigate(`/app/metas/categoria/${evaluation.goal.id}`); };
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  if (compact) {
    const title = resolveRequiredLabel({ kind: "category_name_missing", surface: "CategoryGoalCard", id: evaluation.goal.category_id, name: evaluation.categoryName, fallback: "Categoria" });
    const active = evaluation.status !== "scheduled" && evaluation.status !== "paused";
    const label = displayLabel(evaluation, s);
    const outlook = goalOutlook(evaluation);
    return (
      <li className={`border-t border-border first:border-t-0 ${paused ? "opacity-70" : ""}`}>
        <button
          type="button"
          aria-expanded={more}
          aria-label={`${title}: ${more ? "menos" : "Detalhes e ações"}`}
          onClick={() => setMore((v) => !v)}
          className="block w-full py-4 text-left"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-[16px] font-semibold leading-[22px]">{title}</span>
              <span className="block text-[12px] leading-4 text-muted-foreground">{fmtPeriod(evaluation.period.start, evaluation.period.end)} · {fmtRule(evaluation)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <StatusPill tone={label.tone}>{label.text}</StatusPill>
              <ChevronDown size={16} aria-hidden className={`text-muted-foreground transition-transform ${more ? "rotate-180" : ""}`} />
            </span>
          </span>
          <span className="mt-3 block text-[24px] font-bold leading-[30px] tracking-tight tabular-nums">
            {formatBRL(evaluation.actualSpend)}
            <span className="ml-1.5 text-[13px] font-medium tracking-normal text-muted-foreground">de {formatBRL(evaluation.targetAmount)}</span>
          </span>
          {/* Mesma barra do Ticket Alimentação: cor da marca sempre; o estado fica só na etiqueta. */}
          <span className="mt-2.5 block h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span data-testid="goal-bar-fill" className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(barPct * 100)}%` }} />
          </span>
          <span className="mt-2 flex justify-between text-[12px] leading-4 tabular-nums text-muted-foreground">
            <span>{Math.round(evaluation.percentageUsed * 100)}% do teto</span>
            <span>{evaluation.elapsedDays} de {evaluation.totalDays} dias</span>
          </span>
          {active && outlook ? (
            <span data-testid="goal-outlook" className="mt-3 block rounded-xl bg-muted/50 px-3 py-2.5 text-[13px] leading-[19px]">
              <span className="block font-semibold">{outlook.headline}</span>
              <span className="block tabular-nums text-muted-foreground">{outlook.detail}</span>
            </span>
          ) : null}
        </button>
        {more ? (
          <div className="mb-3 space-y-2 rounded-xl bg-muted/50 p-3">
            <p className="text-[13px] leading-5">{evaluation.message}</p>
            {evaluation.carriedInstallments > 0 ? (
              <p data-testid="goal-carried-installments" className="text-[12px] leading-4 text-muted-foreground">
                Fora da meta: <span className="tabular-nums text-foreground">{formatBRL(evaluation.carriedInstallments)}</span> em {evaluation.carriedInstallmentsCount} {evaluation.carriedInstallmentsCount === 1 ? "parcela" : "parcelas"} de compras anteriores (já comprometido).
              </p>
            ) : null}
            {adjustment ? <AdjustedBadge review={adjustment} /> : null}
            {children ? <div>{children}</div> : null}
            <div className="flex flex-wrap gap-2">
              <button onClick={open} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-primary">Abrir meta <ChevronRight size={12} /></button>
              {onAdjust ? <button onClick={stop(onAdjust)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-primary"><SlidersHorizontal size={12} /> Ajustar meta</button> : null}
              <button onClick={stop(onEdit)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px]"><Pencil size={12} /> Editar</button>
              <button onClick={stop(onToggleStatus)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px]">{paused ? <><Play size={12} /> Reativar</> : <><Pause size={12} /> Pausar</>}</button>
              <button onClick={stop(onDelete)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-destructive"><Trash2 size={12} /> Excluir</button>
            </div>
          </div>
        ) : null}
      </li>
    );
  }

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
          <p className="text-[16px] font-bold leading-tight">
            {resolveRequiredLabel({
              kind: "category_name_missing",
              surface: "CategoryGoalCard",
              id: evaluation.goal.category_id,
              name: evaluation.categoryName,
              fallback: "Categoria",
            })}
          </p>

          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {fmtPeriod(evaluation.period.start, evaluation.period.end)} · {fmtRule(evaluation)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <StatusPill tone={s.tone}>{s.label}</StatusPill>
          {clickable ? <ChevronRight size={14} className="text-muted-foreground" /> : null}
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full transition-all ${bar}`} style={{ width: `${Math.round(barPct * 100)}%` }} />
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

      {evaluation.carriedInstallments > 0 ? (
        <p data-testid="goal-carried-installments" className="mt-1 text-[11px] text-muted-foreground">
          Fora da meta: <span className="font-medium tabular-nums text-foreground">{formatBRL(evaluation.carriedInstallments)}</span>{" "}
          em {evaluation.carriedInstallmentsCount} {evaluation.carriedInstallmentsCount === 1 ? "parcela" : "parcelas"} de compras anteriores (já comprometido).
        </p>
      ) : null}

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
        // R$/dia só existe em categoria de consumo contínuo; em categoria de
        // compromisso (ou sem histórico) mostrar "R$ 0,00/dia" era falso.
        evaluation.supportsDailyBudget && evaluation.dailyAllowance > 0 ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Você pode gastar até{" "}
            <span className="font-medium tabular-nums text-foreground">{formatBRL(evaluation.dailyAllowance)}/dia</span>{" "}
            nos próximos {evaluation.remainingDays} {evaluation.remainingDays === 1 ? "dia" : "dias"}.
          </p>
        ) : (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Restam{" "}
            <span className="font-medium tabular-nums text-foreground">{formatBRL(Math.max(0, evaluation.remainingAmount))}</span>{" "}
            até o fim do período ({evaluation.remainingDays} {evaluation.remainingDays === 1 ? "dia" : "dias"}).
          </p>
        )
      )}
      {overLimit && evaluation.remainingDays > 0 && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {evaluation.remainingDays} dia(s) restantes · novos gastos aumentarão o excesso.
        </p>
      )}

      {adjustment ? <AdjustedBadge review={adjustment} /> : null}

      {children ? <div onClick={(e) => e.stopPropagation()}>{children}</div> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {onAdjust ? (
          <button onClick={stop(onAdjust)} className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            <SlidersHorizontal size={12} /> Ajustar meta
          </button>
        ) : null}
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
