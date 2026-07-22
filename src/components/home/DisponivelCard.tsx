import { useMemo, useState } from "react";
import { ChevronDown, Wallet, Info } from "lucide-react";
import { formatBRL, computeAvailableUntil, type TransactionRow, type AccountRow, type RecurringRow, type AccountBalanceSnapshotRow } from "@/lib/engine/facts";

/**
 * Card principal da Home: "Disponível até o fim do período".
 * Mostra saldo projetado conservadoramente e permite abrir composição.
 */
export function DisponivelCard({
  accounts,
  txs,
  recurring,
  snapshots,
  endDate,
  periodLabel,
  loading,
}: {
  accounts: AccountRow[];
  txs: TransactionRow[];
  recurring: RecurringRow[];
  snapshots: AccountBalanceSnapshotRow[];
  endDate: string;
  periodLabel: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const result = useMemo(
    () => computeAvailableUntil({ accounts, txs, recurring, snapshots, endDate }),
    [accounts, txs, recurring, snapshots, endDate],
  );
  const negative = result.available < 0;
  return (
    <section
      aria-label="Disponível até o fim do período"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/10 via-card to-accent/10 p-5 shadow-card ring-1 ring-border/60"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
        <Wallet className="h-3.5 w-3.5" /> Disponível {periodLabel}
      </div>
      <p
        className={`mt-2 font-display text-3xl font-bold tabular-nums ${negative ? "text-destructive" : "text-foreground"}`}
      >
        {loading ? "—" : formatBRL(result.available)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Estimativa conservadora: saldo em conta + entradas previstas − contas do período − fatura em aberto.
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        aria-expanded={open}
      >
        Como cheguei nesse número
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-background/60 p-3 text-xs">
          <Row label="Saldo hoje" value={result.currentCash} />
          <Row label="+ Entradas previstas" value={result.plannedIncome + result.recurringIn} />
          <Row label="− Contas a pagar" value={-(result.plannedExpense + result.recurringOut)} />
          <Row label="− Fatura em aberto" value={-result.cardsOwed} />
          <div className="col-span-2 mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Info className="h-3 w-3" /> Não considera projeção linear nem médias históricas.
          </div>
        </dl>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{formatBRL(value)}</dd>
    </>
  );
}
