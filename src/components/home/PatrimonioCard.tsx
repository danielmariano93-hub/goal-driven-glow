import { Wallet, CreditCard, LineChart, AlertCircle } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";

interface Props {
  cash: number;
  cardsOwed: number;
  invested: number;
  otherDebts: number;
  net: number;
  loading?: boolean;
}

export function PatrimonioCard({ cash, cardsOwed, invested, otherDebts, net, loading }: Props) {
  const fmt = (n: number) => (loading ? "…" : formatBRL(n));

  return (
    <section className="rounded-3xl bg-card p-5 shadow-card ring-1 ring-border">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Seu patrimônio hoje
      </p>
      <p className={`mt-1 font-display text-3xl font-bold tabular-nums md:text-4xl ${net < 0 ? "text-destructive" : "text-foreground"}`}>
        {fmt(net)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Soma o que você tem em conta e investimentos e desconta fatura do cartão e outras dívidas.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Cell icon={<Wallet size={14} />} label="Em conta" value={fmt(cash)} tone={cash < 0 ? "negative" : "neutral"} />
        <Cell icon={<CreditCard size={14} />} label="Fatura do cartão" value={fmt(cardsOwed)} tone={cardsOwed > 0 ? "warning" : "neutral"} sub="em aberto (estimativa)" />
        <Cell icon={<LineChart size={14} />} label="Investido" value={fmt(invested)} tone="positive" />
        <Cell icon={<AlertCircle size={14} />} label="Outras dívidas" value={fmt(otherDebts)} tone={otherDebts > 0 ? "warning" : "neutral"} />
      </div>
    </section>
  );
}

function Cell({
  icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "positive" | "negative" | "warning" | "neutral";
  sub?: string;
}) {
  const color =
    tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : tone === "warning" ? "text-amber-600" : "text-foreground";
  return (
    <div className="rounded-2xl bg-muted/40 p-3 min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={color}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-1 truncate text-base font-semibold tabular-nums ${color}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
