import { ArrowDown, ArrowUp, CreditCard, Wallet } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatBRL } from "@/lib/engine/facts";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableToday: number;
  confirmedFutureInflows: number;
  upcomingCommitments: number;
  cardDueThisMonth: number;
  projectedEndBalance: number;
};

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-border py-3 last:border-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">{icon}</span>
      <span className="min-w-0 flex-1 text-sm text-muted-foreground">{label}</span>
      <strong className="shrink-0 text-sm font-bold tabular-nums text-foreground">{formatBRL(value)}</strong>
    </div>
  );
}

export function AvailableBalanceDetails(props: Props) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Composição do disponível</SheetTitle>
          <SheetDescription>Caixa de hoje e movimentos já conhecidos até o fim do mês.</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <Row icon={<Wallet weight="duotone" />} label="Disponível hoje" value={props.availableToday} />
          {props.confirmedFutureInflows > 0 ? <Row icon={<ArrowUp weight="bold" />} label="Entradas confirmadas" value={props.confirmedFutureInflows} /> : null}
          {props.upcomingCommitments > 0 ? <Row icon={<ArrowDown weight="bold" />} label="Compromissos conhecidos" value={-props.upcomingCommitments} /> : null}
          {props.cardDueThisMonth > 0 ? <Row icon={<CreditCard weight="duotone" />} label="Fatura deste mês" value={-props.cardDueThisMonth} /> : null}
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-secondary p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Saldo estimado no fim do mês</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Inclui também o gasto variável esperado.</p>
          </div>
          <strong className="text-base font-bold tabular-nums text-foreground">{formatBRL(props.projectedEndBalance)}</strong>
        </div>
      </SheetContent>
    </Sheet>
  );
}