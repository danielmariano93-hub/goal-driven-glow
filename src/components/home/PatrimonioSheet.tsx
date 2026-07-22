import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBRL } from "@/lib/engine/facts";
import { Wallet, CreditCard, LineChart, TrendingDown } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cash: number;
  cardsOwed: number;
  invested: number;
  otherDebts: number;
  net: number;
};

export function PatrimonioSheet({ open, onOpenChange, cash, cardsOwed, invested, otherDebts, net }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader>
          <SheetTitle>Composição do patrimônio</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          <Row icon={<Wallet size={14} />} label="Em conta" value={cash} tone="positive" />
          <Row icon={<LineChart size={14} />} label="Investido" value={invested} tone="positive" />
          <Row icon={<CreditCard size={14} />} label="Na fatura" value={-cardsOwed} tone="negative" />
          <Row icon={<TrendingDown size={14} />} label="Outras dívidas" value={-otherDebts} tone="negative" />
        </div>
        <div className="mt-4 flex items-center justify-between rounded-[18px] bg-muted px-4 py-3">
          <span className="text-sm font-semibold text-foreground">Patrimônio líquido</span>
          <span className="font-display text-lg font-bold tabular-nums text-foreground">{formatBRL(net)}</span>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "positive" | "negative" }) {
  const color = tone === "positive" ? "text-foreground" : "text-destructive";
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-3 py-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-primary">{icon}</span>
      <span className="flex-1 text-sm text-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>{formatBRL(value)}</span>
    </div>
  );
}
