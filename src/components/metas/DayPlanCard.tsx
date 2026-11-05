import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { formatBRL, todayISO } from "@/lib/engine/facts";
import { useHabitsV2Enabled } from "@/lib/behavioral/habitsV2Flag";
import {
  dayMonth, gradedPlans, openPlan, resolvePlans, useCancelDayPlan, useDayPlans, weekdayName,
  type DayPlanBand, type DayPlanRow,
} from "@/lib/behavioral/dayPlan";
import { StatusPill, type PillTone } from "./StatusPill";
import { CreateDayPlanSheet, type PlanCategoryOption } from "./CreateDayPlanSheet";

// "Planos e experimentos": um acordeão discreto abaixo das metas de gasto. Meta é o objeto principal da tela;
// o plano é apoio (um por semana, no máximo). Fechado: uma linha leve com o resumo. Aberto: plano em andamento,
// resultados medidos e o botão de criar o seu. Abre sozinho quando há um plano ativo, que é quando ele pede atenção.

const BAND: Record<DayPlanBand, { tone: PillTone; label: string }> = {
  met: { tone: "success", label: "Dentro do plano" },
  partial: { tone: "warning", label: "Abaixo do seu padrão" },
  missed: { tone: "muted", label: "Acima do plano" },
};

/** Quantos resultados medidos antes de mostrar a média (menos que isso é anedota, não padrão). */
export const MIN_PLANS_FOR_AVERAGE = 3;

export function summaryLine(rows: DayPlanRow[], today: string): string {
  const open = openPlan(rows, today);
  const graded = gradedPlans(rows);
  if (open) {
    return `Plano de ${weekdayName(open.friday)} ${open.status === "accepted" ? "combinado" : "proposto"} · ${open.category}, teto de ${formatBRL(open.target_amount!)}`;
  }
  if (graded.length === 0) return "Nenhum plano ainda. Crie um ou espere a sugestão do Nino.";
  const last = graded[0]!.grade;
  const n = `${graded.length} ${graded.length === 1 ? "plano medido" : "planos medidos"}`;
  const tail = last.band === "met" ? "dentro do plano"
    : last.vs_typical_pct != null && last.vs_typical_pct > 0 ? `${last.vs_typical_pct}% abaixo do seu padrão`
    : "acima do plano";
  return `${n} · último: ${tail}`;
}

type ViewProps = {
  rows: DayPlanRow[];
  today: string;
  canCreate?: boolean;
  onCreate?: () => void;
  onCancel?: (plan: DayPlanRow) => void;
  cancelling?: boolean;
};

export function DayPlansAccordionView({ rows, today, canCreate = false, onCreate, onCancel, cancelling = false }: ViewProps) {
  const open = openPlan(rows, today);
  const graded = gradedPlans(rows);
  const hasActive = !!open;
  const [expanded, setExpanded] = useState(false);
  // Plano ativo pede atenção: abre uma vez quando ele aparece. Depois a pessoa manda.
  useEffect(() => { if (hasActive) setExpanded(true); }, [hasActive]);

  if (!open && graded.length === 0 && !canCreate) return null;

  const withTypical = graded.filter((g) => g.expected_amount != null && g.realized_amount != null);
  const avgReal = withTypical.length ? withTypical.reduce((s, g) => s + g.realized_amount!, 0) / withTypical.length : 0;
  const avgTypical = withTypical.length ? withTypical.reduce((s, g) => s + g.expected_amount!, 0) / withTypical.length : 0;
  const last = graded[0];

  return (
    <section aria-label="Planos e experimentos" data-testid="day-plans" className="mb-3 overflow-hidden rounded-[14px] border border-border">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold leading-5">Planos e experimentos</span>
          <span data-testid="day-plans-summary" className="block text-[12px] leading-4 text-muted-foreground">{summaryLine(rows, today)}</span>
        </span>
        <ChevronDown size={16} aria-hidden className={`shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded ? (
        <div className="bg-card">
          {open ? (
            <div data-testid="day-plan-open" className="border-t border-border px-4 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-[22px]">Plano de {weekdayName(open.friday)}</p>
                  <p className="text-[12px] leading-4 text-muted-foreground">{open.category} · {dayMonth(open.friday)}</p>
                </div>
                <StatusPill tone={open.status === "accepted" ? "success" : "muted"}>{open.status === "accepted" ? "Combinado" : "Proposto"}</StatusPill>
              </div>
              <p className="mt-2.5 text-[13px] leading-5 text-muted-foreground">
                {open.status === "accepted"
                  ? `Até ${formatBRL(open.target_amount!)} em ${open.category}. Depois eu te conto como foi.`
                  : `Até ${formatBRL(open.target_amount!)} em ${open.category}${open.expected_amount ? `, contra os ${formatBRL(open.expected_amount)} que você costuma gastar` : ""}. Responda “topo” no WhatsApp para combinar.`}
              </p>
              {open.status === "accepted" && onCancel ? (
                <button type="button" disabled={cancelling} onClick={() => onCancel(open)} className="mt-2 min-h-9 text-[12px] font-medium text-muted-foreground underline underline-offset-2 disabled:opacity-60">
                  Cancelar este plano
                </button>
              ) : null}
            </div>
          ) : null}

          {last ? (
            <div className="border-t border-border px-4 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold leading-[22px]">Plano de {weekdayName(last.friday)}</p>
                  <p className="text-[12px] leading-4 text-muted-foreground">{last.category} · {dayMonth(last.friday)} · último resultado</p>
                </div>
                <StatusPill tone={BAND[last.grade.band].tone}>{BAND[last.grade.band].label}</StatusPill>
              </div>
              <p data-testid="day-plan-last" className="mt-2.5 text-[13px] leading-5 text-muted-foreground">{last.grade.reading}</p>
              <ul data-testid="day-plan-history" className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Resultados anteriores">
                {graded.slice(0, 4).map((g) => (
                  <li key={`${g.friday}-${g.category}`} className="rounded-full bg-muted px-2.5 py-1 text-[11px] tabular-nums text-muted-foreground">
                    {dayMonth(g.friday)} · {g.grade.vs_typical_pct == null ? formatBRL(g.realized_amount!) : `${g.grade.vs_typical_pct >= 0 ? "−" : "+"}${Math.abs(g.grade.vs_typical_pct)}% do padrão`}
                  </li>
                ))}
              </ul>
              {withTypical.length >= MIN_PLANS_FOR_AVERAGE ? (
                <p data-testid="day-plan-average" className="mt-2.5 text-[12px] leading-4 text-muted-foreground">
                  Nos {withTypical.length} planos medidos você gastou em média {formatBRL(avgReal)}, contra um padrão de {formatBRL(avgTypical)}.
                  Isso descreve o que aconteceu; não prova que foi o plano que fez a diferença.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="max-w-[210px] text-[12px] leading-4 text-muted-foreground">
              O Nino propõe um plano quando acha o seu dia mais forte. {canCreate ? "Você também pode criar o seu." : ""}
            </p>
            {canCreate && onCreate ? (
              <button type="button" onClick={onCreate} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-[10px] border border-primary bg-card px-3.5 text-[13px] font-semibold text-primary">
                <Plus size={13} aria-hidden /> Criar um plano
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

type SectionProps = {
  txs: Array<Record<string, unknown>>;
  categoryOptions: PlanCategoryOption[];
  categoryIdByName: Record<string, string>;
};

/** Versão ligada aos dados do usuário, para a tela de Metas. */
export function DayPlansSection({ txs, categoryOptions, categoryIdByName }: SectionProps) {
  const { user } = useAuth();
  const plans = useDayPlans(user?.id);
  const v2 = useHabitsV2Enabled();
  const cancel = useCancelDayPlan();
  const [sheet, setSheet] = useState(false);
  const today = todayISO();
  const rows = useMemo(() => resolvePlans(plans.data ?? [], { today, txs, categoryIdByName }), [plans.data, today, txs, categoryIdByName]);
  if (!plans.data) return null;
  const canCreate = v2.data === true && categoryOptions.length > 0;
  return (
    <>
      <DayPlansAccordionView
        rows={rows}
        today={today}
        canCreate={canCreate}
        onCreate={() => setSheet(true)}
        onCancel={(plan) => cancel.mutate({ category: plan.category, date: plan.friday })}
        cancelling={cancel.isPending}
      />
      {canCreate ? (
        <CreateDayPlanSheet
          open={sheet}
          onOpenChange={setSheet}
          today={today}
          txs={txs}
          options={categoryOptions}
          activePlan={openPlan(rows, today)}
        />
      ) : null}
    </>
  );
}
