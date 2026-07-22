import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";

type Props = {
  projectedMonthEndAvailable: number;
  monthToDateAverageConsumption: number;
  daysRemainingInMonth: number;
  projectedRemainingConsumption: number;
};

/**
 * Projeção fim de mês — mostra o saldo projetado (disponível hoje + entradas
 * confirmadas − compromissos − fatura − consumo projetado). Números vêm do
 * FinancialSnapshot, nunca recalculados aqui.
 */
export function PrevisaoFechamentoCard({
  projectedMonthEndAvailable,
  monthToDateAverageConsumption,
  daysRemainingInMonth,
  projectedRemainingConsumption,
}: Props) {
  const positive = projectedMonthEndAvailable >= 0;
  return (
    <section
      aria-label="Projeção fim de mês"
      className="rounded-[20px] bg-[color:var(--home-surface)] px-4 py-4"
      style={{ border: "1px solid var(--home-hairline)" }}
    >
      <p
        className="text-[10px] font-bold uppercase"
        style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}
      >
        Projeção fim de mês
      </p>
      <p className="mt-1 text-[12px]" style={{ color: "var(--home-text-2)" }}>
        Seu mês deve encerrar com
      </p>
      <p
        className="mt-0.5 font-display font-extrabold tabular-nums"
        style={{
          fontSize: 26,
          lineHeight: 1.1,
          letterSpacing: "-0.03em",
          color: positive ? "var(--home-pos)" : "var(--home-neg)",
        }}
      >
        {formatBRL(projectedMonthEndAvailable)}
      </p>
      <p className="mt-1.5 text-[11px] tabular-nums" style={{ color: "var(--home-text-2)" }}>
        Ritmo atual {formatBRL(monthToDateAverageConsumption)}/dia · {daysRemainingInMonth} dia(s) restantes · projeção de consumo {formatBRL(projectedRemainingConsumption)}
      </p>
      <div className="mt-2.5">
        <Link
          to="/app/relatorios"
          className="inline-flex items-center gap-1 text-[12px] font-bold hover:underline"
          style={{ color: "var(--home-brand-violet)" }}
        >
          Ver Ponte de Caixa <ArrowRight size={12} />
        </Link>
      </div>
    </section>
  );
}
