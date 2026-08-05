import { Link } from "react-router-dom";
import { PlusCircle, UsersThree, Calculator, SquaresFour } from "@phosphor-icons/react";

/**
 * Ações rápidas — quatro colunas nativas, sem minicards.
 */
export function QuickActions() {
  return (
    <section aria-labelledby="quick-actions-title">
      <h2 id="quick-actions-title" className="mb-2 text-[13px] font-bold text-foreground">Ações rápidas</h2>
      <nav aria-label="Ações rápidas" className="grid grid-cols-4 gap-2">
        <Action to="/app/lancamentos" label="Anotar" icon={<PlusCircle weight="duotone" />} />
        <Action to="/app/divisao-do-role" label="Dividir rolê" icon={<UsersThree weight="duotone" />} />
        <Action to="/app/planejamento" label="Antes de comprar" icon={<Calculator weight="duotone" />} />
        <Action to="/app/mais" label="Mais" icon={<SquaresFour weight="duotone" />} />
      </nav>
    </section>
  );
}

function Action({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="group flex min-h-[78px] flex-col items-center justify-start gap-1.5 px-1 pt-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
       <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary [&>svg]:h-5 [&>svg]:w-5">
        {icon}
      </span>
      <span
        className="line-clamp-2 text-[11px] font-medium leading-tight text-foreground"
      >
        {label}
      </span>
    </Link>
  );
}
