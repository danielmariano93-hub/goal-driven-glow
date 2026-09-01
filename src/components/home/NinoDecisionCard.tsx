// Card editorial único do Nino (nino_decision_narrative.v1).
// Uma decisão → uma história: situação, significado, recomendação e ação.
// Nenhum número é calculado aqui: tudo vem da narrativa canônica.
import { ArrowRight, CheckCircle, SpinnerGap, Target, TrendUp, Warning } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/engine/facts";
import type { NinoDecisionNarrative, NinoDecisionTone } from "@/lib/copy/decisionNarrative";

const TONE: Record<NinoDecisionTone, { accent: string; text: string; Icon: typeof Warning; label: string }> = {
  risk: { accent: "bg-destructive", text: "text-destructive", Icon: Warning, label: "Risco" },
  attention: { accent: "bg-warning", text: "text-warning", Icon: Target, label: "Decisão" },
  opportunity: { accent: "bg-primary", text: "text-primary", Icon: TrendUp, label: "Oportunidade" },
  progress: { accent: "bg-success", text: "text-success", Icon: CheckCircle, label: "Progresso" },
};

type Props = {
  narrative: NinoDecisionNarrative;
  accepting?: boolean;
  onAccept?: () => void;
  acceptedMessage?: string | null;
};

export function NinoDecisionCard({ narrative, accepting, onAccept, acceptedMessage }: Props) {
  const tone = TONE[narrative.tone];
  const primary = narrative.primaryCta;
  const secondary = narrative.secondaryCta;

  return (
    <section
      aria-label="Orientação do Nino"
      aria-live="polite"
      className="relative flex h-full flex-col overflow-hidden rounded-[20px] border border-border bg-card p-4 pl-5 animate-fade-in"
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${tone.accent}`} aria-hidden="true" />
      <div className="flex items-center gap-2">
        <tone.Icon size={16} weight="duotone" className={tone.text} />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{narrative.eyebrow}</p>
        <span className="sr-only">{tone.label}</span>
      </div>

      <h2 className="mt-1.5 font-display text-[16px] font-bold leading-[21px] text-foreground">{narrative.headline}</h2>

      {narrative.context ? (
        <p className="mt-1 text-[12.5px] leading-[18px] text-muted-foreground">{narrative.context}</p>
      ) : null}

      {narrative.recommendation ? (
        <p className="mt-2 text-[12.5px] font-medium leading-[18px] text-foreground">{narrative.recommendation}</p>
      ) : null}

      {narrative.primaryAmount ? (
        <p className="mt-2.5 font-display text-[22px] font-bold leading-none tabular-nums text-foreground">
          {formatBRL(narrative.primaryAmount.value)}
          {narrative.primaryAmount.caption ? (
            <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">{narrative.primaryAmount.caption}</span>
          ) : null}
        </p>
      ) : null}

      {acceptedMessage ? (
        <p className="mt-auto pt-3 text-[12.5px] font-medium leading-[18px] text-success">{acceptedMessage}</p>
      ) : primary ? (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {primary.kind === "accept" ? (
            <Button type="button" size="sm" className="rounded-full" disabled={accepting} onClick={onAccept}>
              {accepting ? <SpinnerGap className="mr-1 animate-spin" /> : null}
              {primary.label}
            </Button>
          ) : (
            <Button asChild size="sm" className="rounded-full">
              <Link to={primary.route}>
                {primary.label}
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          )}
          {secondary ? (
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-[12px] text-muted-foreground">
              <Link to={secondary.kind === "link" ? secondary.route : "/app/metas"}>{secondary.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
