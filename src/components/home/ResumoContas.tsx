import { Link } from "react-router-dom";
import { Wallet, CreditCard, LineChart, AlertCircle, ChevronRight } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";

interface Props {
  cash: number;
  cardsOwed: number;
  invested: number;
  otherDebts: number;
}

export function ResumoContas({ cash, cardsOwed, invested, otherDebts }: Props) {
  const rows = [
    { icon: <Wallet size={14} />, label: "Contas", value: cash, to: "/app/contas", tone: cash < 0 ? "negative" : "neutral" },
    { icon: <CreditCard size={14} />, label: "Fatura do cartão", value: cardsOwed, to: "/app/cartoes", tone: cardsOwed > 0 ? "warning" : "neutral", sub: "em aberto (estimativa)" },
    { icon: <LineChart size={14} />, label: "Investimentos", value: invested, to: "/app/investimentos", tone: "positive" },
    { icon: <AlertCircle size={14} />, label: "Outras dívidas", value: otherDebts, to: "/app/dividas", tone: otherDebts > 0 ? "warning" : "neutral" },
  ] as const;

  return (
    <section className="rounded-3xl bg-card shadow-card ring-1 ring-border">
      <div className="border-b border-border px-5 py-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Resumo</p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const color =
            r.tone === "positive"
              ? "text-success"
              : r.tone === "negative"
                ? "text-destructive"
                : r.tone === "warning"
                  ? "text-amber-600"
                  : "text-foreground";
          return (
            <li key={r.label}>
              <Link to={r.to} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-muted/60 ${color}`}>{r.icon}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.label}</p>
                    {"sub" in r && r.sub ? <p className="text-[10px] text-muted-foreground">{r.sub}</p> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className={`text-sm font-semibold tabular-nums ${color}`}>{formatBRL(r.value)}</span>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
