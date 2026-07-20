import { ArrowRight } from "lucide-react";
import { formatBRL, round2 } from "@/lib/engine/facts";

type Props = {
  income: number;
  expense: number;
  closing: number;
  periodLabel: string;
};

/**
 * Ponte de Caixa — Saldo Início + Entradas − Saídas = Saldo Final.
 * Fluxo bancário literal (bruto): inclui aplicações, resgates, estornos e pagamentos
 * de fatura. Não deve ser interpretado como renda ou consumo.
 */
export function PonteCaixaCard({ income, expense, closing, periodLabel }: Props) {
  const opening = round2(closing - income + expense);
  const delta = round2(income - expense);

  return (
    <section
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      aria-label="Ponte de caixa"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">Ponte de caixa</h3>
        <span className="text-[11px] text-muted-foreground">{periodLabel}</span>
      </header>

      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
        <Cell label="Saldo início" value={formatBRL(opening)} tone="neutral" />
        <ArrowRight size={14} className="text-muted-foreground" aria-hidden />
        <Cell
          label="Entradas − Saídas"
          value={`${delta >= 0 ? "+" : "−"} ${formatBRL(Math.abs(delta))}`}
          tone={delta >= 0 ? "positive" : "negative"}
        />
        <ArrowRight size={14} className="text-muted-foreground" aria-hidden />
        <Cell label="Saldo final" value={formatBRL(closing)} tone="neutral" strong />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <dt className="text-muted-foreground">Entradas brutas</dt>
          <dd className="font-semibold text-success">{formatBRL(income)}</dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-2 py-1.5">
          <dt className="text-muted-foreground">Saídas brutas</dt>
          <dd className="font-semibold text-destructive">{formatBRL(expense)}</dd>
        </div>
      </dl>

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Fluxo bancário literal. Inclui aplicações, resgates, estornos e pagamentos
        de fatura. Consumo e renda são acompanhados separadamente.
      </p>
    </section>
  );
}

function Cell({
  label, value, tone, strong,
}: { label: string; value: string; tone: "neutral" | "positive" | "negative"; strong?: boolean }) {
  const color = tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <div className="min-w-0 text-center">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`truncate ${strong ? "text-base font-bold" : "text-sm font-semibold"} ${color}`}>{value}</div>
    </div>
  );
}
