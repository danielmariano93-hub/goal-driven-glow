import { useState } from "react";
import { ArrowRight, Wallet } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { formatBRL } from "@/lib/engine/facts";
import { Button } from "@/components/ui/button";
import { AvailableBalanceDetails } from "./AvailableBalanceDetails";

type Props = {
  available: number;
  confirmedFutureInflows: number;
  estimatedFixedInflows: number;
  estimatedIncomeEvents: Array<{ date: string; source: "configured" | "inferred" }>;
  upcomingCommitments: number;
  cardDueThisMonth: number;
  projectedEndBalance: number;
  freeAfterKnownCommitments: number | null;
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
        className={`relative overflow-hidden rounded-[24px] bg-gradient-hero p-5 text-primary-foreground shadow-hero animate-fade-in ${p.error || p.partial ? "min-h-[140px]" : "min-h-[176px]"}`}
      >
        <span className="pointer-events-none absolute -right-12 -top-20 h-44 w-44 rounded-full bg-white/15 blur-3xl" aria-hidden="true" />
        <span className="pointer-events-none absolute -bottom-24 left-8 h-40 w-52 rounded-full bg-fuchsia-400/20 blur-3xl" aria-hidden="true" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
             <p className="text-xs font-semibold uppercase leading-4 text-primary-foreground/80">Disponível hoje</p>
               {p.loading ? <div className="mt-2 h-8 w-44 animate-pulse rounded-md bg-primary-foreground/15" /> : p.error ? <p className="mt-2 text-base font-bold text-primary-foreground">Não foi possível atualizar seu saldo</p> : <p className="mt-2 break-words font-display text-[28px] font-bold leading-8 tabular-nums text-primary-foreground">{formatBRL(p.available)}</p>}
               <p className="mt-1 text-xs leading-[18px] text-primary-foreground/80">Posição de hoje · não muda com o período escolhido</p>
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
             <div><p className="text-xs font-semibold text-primary-foreground">Dados incompletos</p><p className="mt-0.5 text-xs leading-[18px] text-primary-foreground/80">O saldo disponível está preservado; projeções podem mudar.</p></div>
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
           <div className="mt-4 flex items-end justify-between gap-3 border-t border-primary-foreground/20 pt-3">
             <div className="min-w-0">
               <p className="text-xs leading-4 text-primary-foreground/80">Livre após compromissos conhecidos</p>
                <p className="mt-0.5 font-display text-base font-bold leading-5 tabular-nums text-primary-foreground">{p.freeAfterKnownCommitments == null ? "Ainda calculando" : formatBRL(p.freeAfterKnownCommitments)}</p>
             </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpenSheet(true)} className="min-h-11 shrink-0 rounded-full px-3 text-xs text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
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
        estimatedFixedInflows={p.estimatedFixedInflows}
        estimatedIncomeEvents={p.estimatedIncomeEvents}
        upcomingCommitments={p.upcomingCommitments}
        cardDueThisMonth={p.cardDueThisMonth}
        projectedEndBalance={p.projectedEndBalance}
        freeAfterKnownCommitments={p.freeAfterKnownCommitments}
      />
    </>
  );
}
