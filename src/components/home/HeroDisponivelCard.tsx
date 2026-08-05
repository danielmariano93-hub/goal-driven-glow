import { useState } from "react";
import { ArrowRight, Wallet } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
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
        className="relative overflow-hidden rounded-[20px] bg-gradient-brand-dark p-5 text-primary-foreground shadow-hero animate-fade-in"
      >
        <span className="absolute inset-x-0 top-0 h-1 bg-gradient-brand" aria-hidden="true" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase text-primary-foreground/70">{p.periodLabel}</p>
            {p.loading ? <div className="mt-2 h-9 w-48 animate-pulse rounded-md bg-primary-foreground/15" /> : <p className="mt-2 font-display text-[36px] font-extrabold leading-none tabular-nums text-primary-foreground">{formatBRL(p.available)}</p>}
          </div>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-foreground/10 text-primary-foreground">
            <Wallet className="h-5 w-5" weight="duotone" aria-hidden="true" />
          </span>
        </div>

        {!p.loading && p.hasAccount === false ? (
          <div className="mt-4 border-t border-primary-foreground/15 pt-4">
            <p className="text-[12px] leading-relaxed text-primary-foreground/75">
              Cadastre sua primeira conta para o Nino mostrar o dinheiro realmente disponível.
            </p>
            <Button asChild size="sm" variant="secondary" className="mt-3 rounded-full">
              <Link to="/app/contas">Cadastrar conta <ArrowRight /></Link>
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex items-end justify-between gap-3 border-t border-primary-foreground/15 pt-4">
            <div className="min-w-0">
              <p className="text-[11px] text-primary-foreground/65">Composição detalhada de caixa e patrimônio</p>
              <p className="mt-1 truncate text-[12px] font-semibold text-primary-foreground/90">
                Veja o que compõe este valor
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpenSheet(true)} className="shrink-0 rounded-full px-3 text-[11px] text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
              Ver composição <ArrowRight />
            </Button>
          </div>
        )}
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
