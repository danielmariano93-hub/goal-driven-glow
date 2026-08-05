import { useState } from "react";
import { ArrowRight, WalletCards } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import { Button } from "@/components/ui/button";
import { PatrimonioSheet } from "./PatrimonioSheet";

type Props = {
  available: number;
  assets: number;
  netWorth: number;
  cash: number;
  accountOverdraft: number;
  cardsOwed: number;
  invested: number;
  otherDebts: number;
  periodLabel: string;
  loading?: boolean;
  hasAccount?: boolean;
  cardFutureInstallments?: number;
  cardDebtIsEstimated?: boolean;
};

export function HeroDisponivelCard(p: Props) {
  const [openSheet, setOpenSheet] = useState(false);
  return (
    <>
      <section
        aria-label="Disponível hoje"
        className="rounded-[20px] border border-border/70 bg-card p-5 shadow-sm"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">{p.periodLabel}</p>
            <p className="mt-2 font-display text-[34px] font-extrabold leading-none tabular-nums text-foreground">
              {p.loading ? "—" : formatBRL(p.available)}
            </p>
          </div>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
            <WalletCards className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>

        {!p.loading && p.hasAccount === false ? (
          <div className="mt-4 border-t border-border/70 pt-4">
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Cadastre sua primeira conta para o Nino mostrar o dinheiro realmente disponível.
            </p>
            <Button asChild size="sm" className="mt-3 rounded-full">
              <a href="/app/contas">Cadastrar conta <ArrowRight /></a>
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex items-end justify-between gap-3 border-t border-border/70 pt-4">
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">Em conta agora, antes de faturas futuras</p>
              <p className="mt-1 truncate text-[12px] font-semibold tabular-nums text-foreground">
                Recursos hoje: {p.loading ? "—" : formatBRL(p.assets)}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpenSheet(true)} className="shrink-0 rounded-full px-3 text-[11px]">
              Ver composição <ArrowRight />
            </Button>
          </div>
        </div>
      </section>

      <PatrimonioSheet
        open={openSheet}
        onOpenChange={setOpenSheet}
        cash={p.cash}
        accountOverdraft={p.accountOverdraft}
        cardsOwed={p.cardsOwed}
        invested={p.invested}
        assets={p.assets}
        otherDebts={p.otherDebts}
        net={p.netWorth}
        cardFutureInstallments={p.cardFutureInstallments ?? 0}
        cardDebtIsEstimated={p.cardDebtIsEstimated ?? false}
      />
    </>
  );
}
