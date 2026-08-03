import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBRL } from "@/lib/engine/facts";
import { Wallet, CreditCard, LineChart, TrendingDown, CalendarClock } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cash: number;
  accountOverdraft: number;
  cardsOwed: number;
  invested: number;
  assets: number;
  otherDebts: number;
  net: number;
  /** Parcelas de competências futuras — compromisso, nunca dívida de hoje. */
  cardFutureInstallments?: number;
  /** true quando algum valor de cartão veio de estimativa (sem fatura oficial). */
  cardDebtIsEstimated?: boolean;
};

export function PatrimonioSheet({
  open,
  onOpenChange,
  cash,
  accountOverdraft,
  cardsOwed,
  invested,
  assets,
  otherDebts,
  net,
  cardFutureInstallments = 0,
  cardDebtIsEstimated = false,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>Composição do patrimônio</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          <Row icon={<Wallet size={14} />} label="Em conta" value={Math.max(0, cash)} tone="positive" />
          <Row icon={<LineChart size={14} />} label="Investido" value={invested} tone="positive" />
          <div className="flex items-center justify-between rounded-[18px] bg-primary/8 px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Seus recursos hoje</span>
            <span className="font-display text-lg font-bold tabular-nums text-foreground">{formatBRL(assets)}</span>
          </div>
          <p className="px-1 pt-2 text-[11px] leading-relaxed text-muted-foreground">
            "Seus recursos hoje" é o dinheiro em conta somado ao investido, <strong className="font-semibold text-foreground">antes</strong> de
            descontar as obrigações. Elas aparecem abaixo e entram no cálculo do patrimônio líquido.
          </p>

          {accountOverdraft > 0 && <Row icon={<TrendingDown size={14} />} label="Saldo negativo em conta" value={-accountOverdraft} tone="negative" />}
          <Row
            icon={<CreditCard size={14} />}
            label="Em aberto na fatura"
            hint={cardDebtIsEstimated ? "Estimativa: falta a fatura oficial" : "Fatura oficial"}
            value={-cardsOwed}
            tone="negative"
          />
          <Row icon={<TrendingDown size={14} />} label="Outras dívidas" value={-otherDebts} tone="negative" />
          {cardFutureInstallments > 0 && (
            <Row
              icon={<CalendarClock size={14} />}
              label="Parcelas futuras"
              hint="Compromisso de meses seguintes — não entra no patrimônio de hoje"
              value={cardFutureInstallments}
              tone="neutral"
            />
          )}
        </div>
        <div className="mt-4 rounded-[18px] bg-muted px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">Patrimônio líquido</span>
            <span className="font-display text-lg font-bold tabular-nums text-foreground">{formatBRL(net)}</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {formatBRL(assets)} de recursos − {formatBRL(accountOverdraft + cardsOwed + otherDebts)} de obrigações
            (fatura em aberto e dívidas já descontadas).
          </p>
          {cardFutureInstallments > 0 && (
            <p className="mt-2 border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Considerando também as {formatBRL(cardFutureInstallments)} de parcelas já comprometidas em meses
              futuros, sobrariam{" "}
              <strong className="font-semibold text-foreground">{formatBRL(net - cardFutureInstallments)}</strong>.
            </p>
          )}
        </div>

      </SheetContent>
    </Sheet>
  );
}

function Row({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "positive" | "negative" | "neutral";
  hint?: string;
}) {
  const color = tone === "negative" ? "text-destructive" : tone === "neutral" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground">{label}</span>
        {hint ? <span className="block text-[10px] leading-tight text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${color}`}>{formatBRL(value)}</span>
    </div>
  );
}
