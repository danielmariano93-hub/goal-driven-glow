import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { formatBRL, round2 } from "@/lib/engine/facts";

type Props = {
  income: number;
  expense: number;
  closing: number;
  periodLabel: string;
};

/**
 * Previsão de fechamento: mostra primeiro a conclusão (saldo final).
 * Reaproveita exatamente os totais já calculados em Index.tsx — sem recálculo.
 */
export function PrevisaoFechamentoCard({ income, expense, closing }: Props) {
  const delta = round2(income - expense);
  const positive = delta >= 0;
  return (
    <section
      aria-label="Previsão de fechamento"
      className="rounded-[20px] bg-[color:var(--home-surface)] px-4 py-4"
      style={{ border: "1px solid var(--home-hairline)" }}
    >
      <p
        className="text-[10px] font-bold uppercase"
        style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}
      >
        Previsão de fechamento
      </p>
      <p className="mt-1 text-[12px]" style={{ color: "var(--home-text-2)" }}>
        Seu mês deve fechar em
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
        {formatBRL(closing)}
      </p>
      <p className="mt-1.5 text-[11px] tabular-nums" style={{ color: "var(--home-text-2)" }}>
        {formatBRL(income)} entraram · {formatBRL(expense)} saíram
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
