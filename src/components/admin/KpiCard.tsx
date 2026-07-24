import type { Envelope } from "@/lib/admin/adminRpc";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type Props = {
  label: string;
  envelope?: Envelope | null;
  format?: (v: number | null) => string;
  suffix?: string;
};

function defaultFormat(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (Number.isInteger(v)) return v.toLocaleString("pt-BR");
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function KpiCard({ label, envelope, format = defaultFormat, suffix }: Props) {
  const v = envelope?.value ?? null;
  const delta = envelope?.delta_pct ?? null;
  const polarity = envelope?.polarity ?? "neutral";
  const isGood =
    delta === null
      ? null
      : polarity === "higher_is_better"
      ? delta >= 0
      : polarity === "lower_is_better"
      ? delta <= 0
      : null;

  const Icon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const tone =
    isGood === null ? "text-muted-foreground" : isGood ? "text-emerald-600" : "text-rose-600";

  return (
    <div className="surface-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-display text-xl md:text-2xl font-bold tabular-nums">
          {format(v)}
        </span>
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
      <div className={`mt-1 flex items-center gap-1 text-xs ${tone}`}>
        <Icon size={12} aria-hidden />
        <span>
          {delta === null
            ? "sem histórico"
            : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% vs período anterior`}
        </span>
      </div>
      {envelope && !envelope.sufficient_sample && (
        <div className="mt-1 text-[10px] text-amber-600">
          amostra {envelope.data_quality} (n={envelope.sample_size})
        </div>
      )}
    </div>
  );
}
