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
  return (
    <>
      <section
        aria-label="Disponível até o fim do período"
        className="relative overflow-hidden rounded-[24px] bg-gradient-hero p-5 text-white"
        style={{ boxShadow: "var(--shadow-hero)", minHeight: 172 }}
      >
        <div className="relative flex h-full flex-col">
          <p
            className="text-[10px] font-bold uppercase text-white/72"
            style={{ letterSpacing: "0.14em" }}
          >
            {p.periodLabel.toUpperCase()}
          </p>
          <p
            className="mt-2 font-display font-extrabold tabular-nums text-white"
            style={{ fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.035em" }}
          >
            {p.loading ? "—" : formatBRL(res.available)}
          </p>
          <p className="mt-1 truncate text-[12px] leading-snug text-white/78">
            Depois da fatura e dos compromissos já conhecidos.
          </p>

          <div
            className="mt-auto flex items-end justify-between gap-3 pt-4"
            style={{ borderTop: "1px solid rgba(255,255,255,0.16)" }}
          >
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-white/60">Patrimônio total</p>
              <p className="mt-0.5 truncate font-display text-[15px] font-bold tabular-nums text-white">
                {p.loading ? "—" : formatBRL(p.netWorth)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenSheet(true)}
              className="shrink-0 rounded-full border border-white/28 bg-white/12 px-3.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              style={{ height: 34 }}
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
