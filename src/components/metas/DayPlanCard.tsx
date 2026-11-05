import { useAuth } from "@/context/AuthContext";
import { todayISO, formatBRL } from "@/lib/engine/facts";
import { dayMonth, gradedPlans, openPlan, useDayPlans, weekdayName, type DayPlanBand, type DayPlanRow } from "@/lib/behavioral/dayPlan";
import { StatusPill, type PillTone } from "./StatusPill";

// "Seu plano de {dia}": o limite que o Nino propôs para o dia em que você mais gasta, o que foi combinado e como foi.
// Mesmo desenho dos demais cartões de Metas (superfície própria, uma etiqueta de estado, texto simples).
// Sem plano nenhum, não aparece: um cartão vazio seria só ruído.

const BAND: Record<DayPlanBand, { tone: PillTone; label: string }> = {
  met: { tone: "success", label: "Dentro do plano" },
  partial: { tone: "warning", label: "Abaixo do seu padrão" },
  missed: { tone: "muted", label: "Acima do plano" },
};

/** Quantos resultados medidos antes de mostrar a média (menos que isso é anedota, não padrão). */
export const MIN_PLANS_FOR_AVERAGE = 3;

export function DayPlanCardView({ rows, today }: { rows: DayPlanRow[]; today: string }) {
  const open = openPlan(rows, today);
  const graded = gradedPlans(rows);
  if (!open && graded.length === 0) return null;

  const last = graded[0];
  const title = open ? `Seu plano de ${weekdayName(open.friday)}` : `Seu plano de ${weekdayName(last!.friday)}`;
  const withTypical = graded.filter((g) => g.expected_amount != null && g.realized_amount != null);
  const avgReal = withTypical.length ? withTypical.reduce((s, g) => s + g.realized_amount!, 0) / withTypical.length : 0;
  const avgTypical = withTypical.length ? withTypical.reduce((s, g) => s + g.expected_amount!, 0) / withTypical.length : 0;

  return (
    <section aria-label={title} data-testid="day-plan-card" className="surface-card mb-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-[22px]">{title}</h2>
          <p className="text-[12px] leading-4 text-muted-foreground">
            {open ? `${open.category} · teto de ${formatBRL(open.target_amount!)}` : `${last!.category} · último resultado`}
          </p>
        </div>
        {!open && last ? <StatusPill tone={BAND[last.grade.band].tone}>{BAND[last.grade.band].label}</StatusPill> : null}
      </div>

      {open ? (
        <p data-testid="day-plan-open" className="mt-3 text-[13px] leading-5">
          <span className="font-semibold">{open.status === "accepted" ? "Combinado." : "Proposto."}</span>{" "}
          <span className="text-muted-foreground">
            {open.status === "accepted"
              ? `Até ${formatBRL(open.target_amount!)} em ${open.category}. Depois eu te conto como foi.`
              : `Até ${formatBRL(open.target_amount!)} em ${open.category}${open.expected_amount ? `, contra os ${formatBRL(open.expected_amount)} que você costuma gastar` : ""}. Responda “topo” no WhatsApp para combinar.`}
          </span>
        </p>
      ) : last ? (
        <p data-testid="day-plan-last" className="mt-3 text-[13px] leading-5 text-muted-foreground">{last.grade.reading}</p>
      ) : null}

      {graded.length > 0 ? (
        <ul data-testid="day-plan-history" className="mt-3 flex flex-wrap gap-1.5" aria-label="Resultados anteriores">
          {graded.slice(0, 4).map((g) => (
            <li key={`${g.friday}-${g.category}`} className="rounded-full bg-muted px-2.5 py-1 text-[11px] tabular-nums text-muted-foreground">
              {dayMonth(g.friday)} · {g.grade.vs_typical_pct == null ? formatBRL(g.realized_amount!) : `${g.grade.vs_typical_pct >= 0 ? "−" : "+"}${Math.abs(g.grade.vs_typical_pct)}% do padrão`}
            </li>
          ))}
        </ul>
      ) : null}

      {withTypical.length >= MIN_PLANS_FOR_AVERAGE ? (
        <p data-testid="day-plan-average" className="mt-3 text-[12px] leading-4 text-muted-foreground">
          Nos {withTypical.length} planos medidos você gastou em média {formatBRL(avgReal)}, contra um padrão de {formatBRL(avgTypical)}.
          Isso descreve o que aconteceu; não prova que foi o plano que fez a diferença.
        </p>
      ) : null}
    </section>
  );
}

/** Versão ligada aos dados do usuário, para a tela de Metas. */
export function DayPlanSection() {
  const { user } = useAuth();
  const plans = useDayPlans(user?.id);
  if (!plans.data) return null;
  return <DayPlanCardView rows={plans.data} today={todayISO()} />;
}
