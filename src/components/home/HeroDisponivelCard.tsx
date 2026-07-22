import { useMemo, useState } from "react";
import {
  formatBRL,
  computeAvailableUntil,
  type TransactionRow,
  type AccountRow,
  type RecurringRow,
  type AccountBalanceSnapshotRow,
} from "@/lib/engine/facts";
import { PatrimonioSheet } from "./PatrimonioSheet";

type Props = {
  accounts: AccountRow[];
  txs: TransactionRow[];
  recurring: RecurringRow[];
  snapshots: AccountBalanceSnapshotRow[];
  endDate: string;
  periodLabel: string;
  netWorth: number;
  cash: number;
  cardsOwed: number;
  invested: number;
  otherDebts: number;
  loading?: boolean;
};

export function HeroDisponivelCard(p: Props) {
  const [openSheet, setOpenSheet] = useState(false);
  const res = useMemo(
    () => computeAvailableUntil({ accounts: p.accounts, txs: p.txs, recurring: p.recurring, snapshots: p.snapshots, endDate: p.endDate }),
    [p.accounts, p.txs, p.recurring, p.snapshots, p.endDate],
  );
  const negative = res.available < 0;
  return (
    <>
      <section
        aria-label="Disponível até o fim do período"
        className="relative overflow-hidden rounded-[24px] bg-gradient-hero p-5 text-white shadow-hero"
      >
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-white/15 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/75">
            {p.periodLabel.toUpperCase()}
          </p>
          <p
            className={`mt-2 font-display text-[clamp(1.9rem,9vw,2.25rem)] font-extrabold tabular-nums tracking-tight ${negative ? "text-white" : "text-white"}`}
          >
            {p.loading ? "—" : formatBRL(res.available)}
          </p>
          <p className="mt-1 max-w-[26ch] text-[12px] leading-snug text-white/80">
            Depois da fatura e dos compromissos já conhecidos.
          </p>

          <div className="mt-5 flex items-end justify-between gap-3 border-t border-white/20 pt-4">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-white/60">Patrimônio total</p>
              <p className="mt-0.5 truncate font-display text-lg font-bold tabular-nums text-white">
                {p.loading ? "—" : formatBRL(p.netWorth)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenSheet(true)}
              className="shrink-0 rounded-full border border-white/30 bg-white/15 px-3.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              Ver composição
            </button>
          </div>
        </div>
      </section>

      <PatrimonioSheet
        open={openSheet}
        onOpenChange={setOpenSheet}
        cash={p.cash}
        cardsOwed={p.cardsOwed}
        invested={p.invested}
        otherDebts={p.otherDebts}
        net={p.netWorth}
      />
    </>
  );
}
