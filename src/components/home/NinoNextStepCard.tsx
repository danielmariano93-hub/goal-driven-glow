// Próximo passo do Nino na Home (nino_change_agent.v1).
// Apenas apresenta a recomendação canônica vigente. Sem recomendação, o card
// não aparece — a Home nunca cria um passo por conta própria.
import { Link } from "react-router-dom";
import { ArrowRight, Target } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/engine/facts";
import { useNinoNextStep } from "@/lib/nino/nextStep";

export function NinoNextStepCard() {
  const { data, isLoading } = useNinoNextStep();
  if (isLoading || !data) return null;

  return (
    <section
      className="rounded-[20px] p-4"
      style={{ border: "1px solid var(--home-hairline)", background: "var(--home-surface-neutral)" }}
      aria-label="Próximo passo do Nino"
    >
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Target className="h-3.5 w-3.5 text-primary" weight="bold" />
        Próximo passo
      </p>
      <h2 className="mt-1.5 text-sm font-semibold leading-snug">{data.title}</h2>
      {data.detail ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{data.detail}</p>
      ) : null}
      {typeof data.amount === "number" && data.amount > 0 ? (
        <p className="mt-2 text-sm font-bold tabular-nums">{formatBRL(data.amount)}</p>
      ) : null}
      {data.route ? (
        <Button asChild variant="outline" size="sm" className="mt-3 rounded-full">
          <Link to={data.route}>
            Ver como fazer
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      ) : null}
    </section>
  );
}
