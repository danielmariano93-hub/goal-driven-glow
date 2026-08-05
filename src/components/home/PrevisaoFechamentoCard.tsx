import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, Info } from "lucide-react";
import { useState } from "react";
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
  const [open, setOpen] = useState(false);
  if (!projection) return null;
  const positive = projection.projectedEndBalance >= 0;
  const note = CONFIDENCE_NOTE[projection.confidence];

  return (
    <section
      aria-label="Projeção fim de mês"
      className="rounded-[20px] border border-border/70 bg-card px-4 py-4"
    >
      <p className="text-[10px] font-bold uppercase text-muted-foreground">
        Projeção fim de mês
      </p>
      <div className="mt-2">
        <p className="text-[11px] font-medium text-muted-foreground">Saldo estimado no fim do mês</p>
        <p
          className={`mt-1 font-display text-[28px] font-extrabold leading-none tabular-nums ${positive ? "text-success" : "text-destructive"}`}
        >
          {formatBRL(projection.projectedEndBalance)}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Disponível hoje + entradas confirmadas − compromissos − fatura do mês − gasto variável esperado.
        </p>
      </div>

      {note ? (
        <p
          className="mt-3 flex items-start gap-1.5 rounded-lg bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground"
        >
          <Info size={12} className="mt-0.5 shrink-0" />
          {note}
        </p>
      ) : null}

      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="mt-3 inline-flex min-h-9 items-center gap-1 text-[11px] font-semibold text-muted-foreground">
        {open ? "Ocultar composição" : "Ver composição"}
        <ChevronDown size={12} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open ? (
        <div className="mt-1 space-y-1 rounded-xl bg-secondary p-3">
          <Row label="Disponível hoje" value={projection.currentAvailableBalance} />
          <Row label="Entradas confirmadas" value={projection.confirmedFutureInflows} />
          <Row label="Compromissos conhecidos" value={-projection.upcomingConfirmedCommitments} />
          <Row label="Fatura deste mês" value={-projection.cardDueThisMonth} />
          <Row label="Gasto variável esperado" value={-projection.projectedVariableSpending} />
          <div className="mt-2 border-t border-border pt-2">
            <Row label="Gasto total esperado no mês" value={projection.projectedTotalSpending} strong />
          </div>
          <p className="pt-1 text-[10px] text-muted-foreground">
            Base: {projection.daysElapsed} dia(s) observado(s) · {projection.daysRemaining} restante(s) · confiança {projection.confidence === "high" ? "alta" : projection.confidence === "medium" ? "média" : "preliminar"}.
          </p>
        </div>
      ) : null}

      <div className="mt-2.5">
        <Link
          to="/app/relatorios"
          className="inline-flex items-center gap-1 text-[12px] font-bold text-primary hover:underline"
        >
          Ver Ponte de Caixa <ArrowRight size={12} />
        </Link>
      </div>
    </section>
  );
}
