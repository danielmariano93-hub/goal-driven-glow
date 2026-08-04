import { Link } from "react-router-dom";
import { ArrowRight, Info } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { SpendingProjection } from "@/lib/engine/metrics";

type Props = {
  projection: SpendingProjection | null;
};

const CONFIDENCE_NOTE: Record<SpendingProjection["confidence"], string | null> = {
  insufficient: "Projeção preliminar: ainda são poucos dias de dados neste mês.",
  low: "Projeção preliminar: menos de uma semana de dados neste mês.",
  medium: null,
  high: null,
};

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 tabular-nums">
      <span className="text-[11px]" style={{ color: "var(--home-text-2)" }}>{label}</span>
      <span
        className={strong ? "text-[13px] font-extrabold" : "text-[12px] font-semibold"}
        style={{ color: "var(--home-text-1)" }}
      >
        {formatBRL(value)}
      </span>
    </div>
  );
}

/**
 * Projeção fim de mês — separa explicitamente GASTO PROJETADO de SALDO
 * PROJETADO. Todos os números vêm de `snapshot.projection`
 * (`financial_snapshot_contract.v5`); nada é recalculado aqui.
 */
export function PrevisaoFechamentoCard({ projection }: Props) {
  if (!projection) return null;
  const positive = projection.projectedEndBalance >= 0;
  const note = CONFIDENCE_NOTE[projection.confidence];

  return (
    <section
      aria-label="Projeção fim de mês"
      className="rounded-[20px] bg-[color:var(--home-surface)] px-4 py-4"
      style={{ border: "1px solid var(--home-hairline)" }}
    >
      <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.14em", color: "var(--home-text-3)" }}>
        Projeção fim de mês
      </p>
      <p className="mt-1 text-[11px]" style={{ color: "var(--home-text-2)" }}>
        {projection.daysElapsed} dia(s) observados · {projection.daysRemaining} dia(s) restantes
      </p>

      {/* Bloco 1 — GASTO projetado */}
      <div className="mt-3 space-y-1 rounded-xl p-3" style={{ background: "var(--home-neutral-bg)" }}>
        <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.1em", color: "var(--home-text-3)" }}>
          Gasto projetado no mês
        </p>
        <Row label="Já gastei até hoje" value={projection.realizedConsumption} />
        <Row label="Gasto variável ainda esperado" value={projection.projectedVariableSpending} />
        <Row label="Compromissos já conhecidos" value={projection.upcomingConfirmedCommitments} />
        <div className="mt-1 pt-1" style={{ borderTop: "1px solid var(--home-hairline)" }}>
          <Row label="Total esperado do mês" value={projection.projectedTotalSpending} strong />
        </div>
      </div>

      {/* Bloco 2 — SALDO projetado (conceito diferente, bloco separado) */}
      <div className="mt-3">
        <p className="text-[10px] font-bold uppercase" style={{ letterSpacing: "0.1em", color: "var(--home-text-3)" }}>
          Saldo projetado no fim do mês
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
          {formatBRL(projection.projectedEndBalance)}
        </p>
        <p className="mt-1 text-[11px] tabular-nums" style={{ color: "var(--home-text-2)" }}>
          Disponível hoje {formatBRL(projection.currentAvailableBalance)} + entradas confirmadas{" "}
          {formatBRL(projection.confirmedFutureInflows)} − compromissos{" "}
          {formatBRL(projection.upcomingConfirmedCommitments)} − fatura do mês{" "}
          {formatBRL(projection.cardDueThisMonth)} − gasto variável{" "}
          {formatBRL(projection.projectedVariableSpending)}
        </p>
      </div>

      {note ? (
        <p
          className="mt-2 flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-[11px]"
          style={{ background: "var(--home-neutral-bg)", color: "var(--home-text-2)" }}
        >
          <Info size={12} className="mt-0.5 shrink-0" />
          {note}
        </p>
      ) : null}

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
