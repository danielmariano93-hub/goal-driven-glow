import { Link } from "react-router-dom";
import { CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { buildCommunicationIntent } from "@/lib/copy/commIntent";
import { diagnosisActionLabel, diagnosisRouteForSituation } from "@/lib/nino/actions";
import type { FinancialSituation } from "@/lib/nino/diagnosis";

/**
 * Sinal secundário (`nino_comm.v1`): linha compacta, subordinada ao card
 * principal. Uma conclusão, sem parágrafo, sem CTA próprio, tom neutro —
 * nada é removido da leitura, apenas rebaixado na hierarquia de atenção.
 */
export function NinoSupportingSignalRow({ situation }: { situation: FinancialSituation }) {
  const intent = buildCommunicationIntent(
    {
      headline: situation.headline,
      one_line_summary: situation.one_line_summary,
      summary: situation.cause_summary,
      impact_amount: situation.impact_amount,
      severity: situation.severity,
      confidence: situation.confidence,
    },
    "card",
  );
  const route = diagnosisRouteForSituation(situation, null);
  const hasAction = Boolean(diagnosisActionLabel(situation, null));

  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
          situation.severity === "critical"
            ? "bg-destructive"
            : situation.severity === "attention"
              ? "bg-warning"
              : situation.severity === "positive"
                ? "bg-success"
                : "bg-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-foreground">{intent.conclusion}</span>
        {intent.impact_label ? (
          <span className="block text-[11px] tabular-nums text-muted-foreground">{intent.impact_label}</span>
        ) : null}
      </span>
      {hasAction ? <CaretRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
    </>
  );

  const className = "flex w-full items-start gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left";
  return hasAction ? (
    <Link to={route} className={cn(className, "transition active:scale-[0.99]")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
