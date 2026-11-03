import { Link } from "react-router-dom";
import { ForkKnife } from "@phosphor-icons/react";
import { formatBRL, todayISO } from "@/lib/engine/facts";
import { computeBenefitState } from "@/lib/engine/benefitWallet";
import { useBenefitEnabled, useBenefitEntries, useBenefitWallet } from "@/lib/db/benefitWallet";

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Ticket Alimentação na Home. Contexto separado do livro-razão: o saldo do Ticket NÃO entra no
 * "Disponível" nem no patrimônio. Fail-closed: sem acesso liberado, sem carteira ou sem leitura de saldo,
 * o card não aparece (e nada além da checagem de acesso, em cache de 5 min, é consultado).
 */
export function HomeTicketCard() {
  const enabled = useBenefitEnabled();
  const wallet = useBenefitWallet(enabled.data === true);
  const entries = useBenefitEntries(wallet.data?.id);
  if (enabled.data !== true || !wallet.data || !entries.data) return null;

  const state = computeBenefitState(wallet.data, entries.data, todayISO());
  if (state.balance === null) return null;
  const p = state.projection;
  const tone = p?.status === "short" ? "text-destructive" : p?.status === "tight" ? "text-warning" : "text-success";
  const line = !p || p.status === "unknown"
    ? `Próximo crédito em ${dm(state.cycle.next)}.`
    : p.depletion_date
      ? `No seu ritmo, acaba em ${dm(p.depletion_date)}; o crédito vem em ${dm(state.cycle.next)}.`
      : `No seu ritmo, cobre até o próximo crédito (${dm(state.cycle.next)}).`;

  return (
    <Link to="/app/ticket" className="surface-card flex items-center gap-3 p-4 active:bg-secondary/50" aria-label="Abrir Ticket Alimentação">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><ForkKnife size={20} weight="duotone" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ticket Alimentação</span>
        <span className="block text-xl font-bold">{formatBRL(state.balance)}{state.estimated ? <span className="ml-1 text-xs font-medium text-muted-foreground">estimado</span> : null}</span>
        <span className={`block text-xs ${tone}`}>{line}</span>
      </span>
    </Link>
  );
}
