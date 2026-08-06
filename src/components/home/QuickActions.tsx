import { Link } from "react-router-dom";
import { Plus, UsersThree, Calculator, SquaresFour } from "@phosphor-icons/react";

/**
 * Ações rápidas — quatro colunas nativas, sem minicards.
 */
export function QuickActions() {
  return (
    <section aria-labelledby="quick-actions-title">
      <h2 id="quick-actions-title" className="mb-1.5 text-xs font-bold text-muted-foreground">Ações rápidas</h2>
      <nav aria-label="Ações rápidas" className="grid grid-cols-4 gap-2">
        <Action to="/app/lancamentos" label="Anotar" icon={<Plus weight="bold" />} />
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
      className="group flex min-h-[66px] flex-col items-center justify-start gap-1 px-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
       <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary [&>svg]:h-[18px] [&>svg]:w-[18px]">
        {icon}
      </span>
      <span
         className="line-clamp-2 text-[11px] font-medium leading-4 text-foreground"
      >
        {label}
      </span>
    </Link>
  );
}
