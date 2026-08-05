import { useState } from "react";
import { ArrowRight, Wallet } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { formatBRL } from "@/lib/engine/facts";
import { Button } from "@/components/ui/button";
import { AvailableBalanceDetails } from "./AvailableBalanceDetails";

type Props = {
  available: number;
  confirmedFutureInflows: number;
  upcomingCommitments: number;
  cardDueThisMonth: number;
  projectedEndBalance: number;
  periodLabel: string;
  loading?: boolean;
  hasAccount?: boolean;
  error?: unknown;
  partial?: boolean;
  onRetry?: () => void;
};

export function HeroDisponivelCard(p: Props) {
  const [openSheet, setOpenSheet] = useState(false);
  return (
    <>
      <section
        aria-label="Disponível hoje"
        className={`relative overflow-hidden rounded-2xl bg-gradient-brand-dark p-5 text-primary-foreground shadow-hero animate-fade-in ${p.error || p.partial ? "min-h-[124px]" : "min-h-[168px]"}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase text-primary-foreground/70">{p.periodLabel}</p>
             {p.loading ? <div className="mt-2 h-9 w-48 animate-pulse rounded-md bg-primary-foreground/15" /> : p.error ? <p className="mt-2 text-lg font-bold text-primary-foreground">Não foi possível atualizar seu saldo</p> : <p className="mt-2 truncate font-display text-[36px] font-extrabold leading-none tabular-nums text-primary-foreground">{formatBRL(p.available)}</p>}
          </div>
          <Wallet className="h-5 w-5 shrink-0 text-primary-foreground/60" weight="duotone" aria-hidden="true" />
        </div>

        {!p.loading && p.error ? (
          <div className="mt-2">
            <p className="text-xs leading-relaxed text-primary-foreground/75">Seus outros dados continuam disponíveis.</p>
            {p.onRetry ? <Button type="button" variant="ghost" onClick={p.onRetry} className="mt-2 min-h-11 rounded-full px-3 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">Tentar novamente</Button> : null}
          </div>
        ) : !p.loading && p.partial ? (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-primary-foreground/15 pt-3">
            <p className="text-xs leading-relaxed text-primary-foreground/75">Algumas informações ainda não foram atualizadas.</p>
            {p.onRetry ? <Button type="button" variant="ghost" onClick={p.onRetry} className="min-h-11 shrink-0 rounded-full px-3 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">Atualizar</Button> : null}
          </div>
        ) : !p.loading && p.hasAccount === false ? (
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
             <div className="min-w-0 space-y-1 text-[11px] text-primary-foreground/70">
               {p.confirmedFutureInflows > 0 ? <p>+ {formatBRL(p.confirmedFutureInflows)} em entradas confirmadas</p> : null}
               {p.upcomingCommitments > 0 ? <p>− {formatBRL(p.upcomingCommitments)} em compromissos conhecidos</p> : null}
               {p.confirmedFutureInflows <= 0 && p.upcomingCommitments <= 0 ? <p>Sem movimentos futuros confirmados neste mês</p> : null}
             </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpenSheet(true)} className="min-h-11 shrink-0 rounded-full px-3 text-[11px] text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
              Ver composição <ArrowRight />
            </Button>
          </div>
        )}
      </section>

      <AvailableBalanceDetails
        open={openSheet}
        onOpenChange={setOpenSheet}
        availableToday={p.available}
        confirmedFutureInflows={p.confirmedFutureInflows}
        upcomingCommitments={p.upcomingCommitments}
        cardDueThisMonth={p.cardDueThisMonth}
        projectedEndBalance={p.projectedEndBalance}
      />
    </>
  );
}
